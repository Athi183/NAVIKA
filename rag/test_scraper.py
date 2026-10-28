"""Standalone checks for extracting MITS CSE and faculty-page content."""

import re
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; NAVIKACollegeAssistant/1.0)"}
TIMEOUT = 20


def fetch_soup(url):
    response = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    response.raise_for_status()
    return BeautifulSoup(response.text, "html.parser"), response.url


def clean_soup(soup):
    for element in soup(["script", "style", "header", "footer", "nav", "noscript"]):
        element.decompose()
    return soup


def scrape_placement_tables(link):
    """Return readable row records from placement tables on the supplied page."""
    soup, final_url = fetch_soup(link)
    records = []

    for table in soup.find_all("table"):
        rows = []
        for tr in table.find_all("tr"):
            cells = [cell.get_text(" ", strip=True) for cell in tr.find_all(["th", "td"])]
            cells = [re.sub(r"\s+", " ", cell) for cell in cells if cell]
            if cells:
                rows.append(cells)
        if not rows:
            continue

        headers = rows[0]
        for row in rows[1:]:
            if len(headers) == len(row):
                records.append(dict(zip(headers, row)))
            else:
                records.append({"row": " | ".join(row)})

    return {"url": final_url, "records": records}


def scrape_cse_page(link):
    """Extract visible CSE department content and follow placement links."""
    soup, final_url = fetch_soup(link)
    soup = clean_soup(soup)
    sections = []

    # Prefer the site's department landing-page sections when available.
    section_nodes = soup.select(".departmentlandingPage .mTle")
    if section_nodes:
        for heading in section_nodes:
            title = heading.get_text(" ", strip=True)
            collected = [title] if title else []
            for sibling in heading.find_all_next():
                if sibling in section_nodes and sibling is not heading:
                    break
                if sibling.name in {"p", "li", "h1", "h2", "h3", "h4", "td", "th"}:
                    value = sibling.get_text(" ", strip=True)
                    if value and value not in collected:
                        collected.append(value)
            if collected:
                sections.append("\n".join(collected))

    if not sections:
        for node in soup.find_all(["h1", "h2", "h3", "h4", "p", "li", "td", "th"]):
            value = node.get_text(" ", strip=True)
            if value:
                sections.append(value)

    placement_links = []
    for anchor in soup.find_all("a", href=True):
        label = anchor.get_text(" ", strip=True).lower()
        href = urljoin(final_url, anchor["href"])
        if "placement" in label or "placement" in href.lower() or "recruit" in label:
            if href not in placement_links:
                placement_links.append(href)

    placement_tables = []
    for placement_url in placement_links:
        try:
            result = scrape_placement_tables(placement_url)
            if result["records"]:
                placement_tables.append(result)
        except requests.RequestException as exc:
            print(f"Could not read placement page {placement_url}: {exc}")

    return {
        "url": final_url,
        "sections": sections,
        "placement_tables": placement_tables
    }