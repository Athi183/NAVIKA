"""Crawl MITS pages and build the NAVIKA FAISS knowledge base."""

import argparse
import asyncio
import json
import pickle
import re
import time
import xml.etree.ElementTree as ET

from pathlib import Path

from collections import deque

from urllib.parse import urljoin, urlparse, urlunparse, parse_qsl, urlencode

from spatial_loader import load_spatial_documents

from college_facts_loader import load_college_facts_documents

import requests

from bs4 import BeautifulSoup, NavigableString

from langchain_core.documents import Document

from langchain_text_splitters import RecursiveCharacterTextSplitter

from langchain_huggingface import HuggingFaceEmbeddings

from langchain_community.vectorstores import FAISS

# Crawl4AI renders pages in a browser, which can expose content missed by requests.
# Keep a Requests fallback so a Crawl4AI issue does not stop the whole ingestion.
try:
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
    CRAWL4AI_AVAILABLE = True
except ImportError:
    AsyncWebCrawler = BrowserConfig = CrawlerRunConfig = CacheMode = None
    CRAWL4AI_AVAILABLE = False

# ==========================================

# CONFIG

# ==========================================

START_URL = "https://mgmits.ac.in/"

MAX_PAGES = 30
REQUEST_TIMEOUT = 20
REQUEST_DELAY_SECONDS = 0.15

BASE_DIR = Path(__file__).resolve().parent
CRAWL_REPORT_FILE = BASE_DIR / "crawl_report.json"
CACHE_FILE = BASE_DIR / "crawl_cache.pkl"
VECTORSTORE_DIR = BASE_DIR / "vectorstore"

CHUNK_SIZE = 800

CHUNK_OVERLAP = 150

# all-MiniLM-L6-v2 was too weak for this corpus: it ranked the correct

# chunk ~400th out of 567 for a query like "what are the work timings of

# the college" against a chunk literally containing "Office Hours: Monday

# - Saturday : 8.50 AM - 4.10 PM" — a plain synonym gap ("timings" vs

# "hours") a stronger retrieval-tuned model closes far more reliably.

# bge-small-en-v1.5 measured rank 0 (was 12) for a principal lookup and

# rank 1 (was 39) for a departments-listing query on the same corpus.

# Must match the model name used to load the index in app.py.

EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"

IGNORED_EXTENSIONS = (

    ".jpg", ".jpeg", ".png", ".gif", ".svg",

    ".mp4", ".mp3", ".zip",

    ".doc", ".docx", ".xls", ".xlsx",

)

# ==========================================

# URL helpers and HTTP session

# ==========================================

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; NAVIKACollegeAssistant/1.0)"}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)

def normalize_url(url):
    """Normalize URLs to avoid crawling the same page under trivial variants."""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return None
    host = (parsed.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if not host:
        return None
    # Drop common tracking parameters but preserve meaningful query parameters.
    tracking = {"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"}
    query = urlencode([(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k.lower() not in tracking])
    path = re.sub(r"/{2,}", "/", parsed.path or "/")
    if path != "/":
        path = path.rstrip("/")
    return urlunparse(("https", host, path, "", query, ""))

def clean_url(url):
    return normalize_url(url) or url.split("#", 1)[0].rstrip("/")

def is_same_domain(url, base_url):
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    base_host = (urlparse(base_url).hostname or "").lower().removeprefix("www.")
    return bool(host and base_host and host == base_host)

def is_ignored_url(url):
    path = urlparse(url).path.lower()
    return path.endswith(IGNORED_EXTENSIONS) or path.endswith((".css", ".js", ".json", ".xml", ".woff", ".woff2", ".ttf", ".eot"))

def fetch_response(url):
    response = SESSION.get(url, timeout=REQUEST_TIMEOUT, allow_redirects=True)
    response.raise_for_status()
    return response

def discover_sitemap_urls(base_url):
    """Discover URLs from common sitemap locations and sitemap indexes."""
    root = normalize_url(base_url)
    parsed = urlparse(root)
    candidates = [
        urljoin(root + "/", "sitemap.xml"),
        urljoin(root + "/", "sitemap_index.xml"),
        urljoin(root + "/", "wp-sitemap.xml"),
    ]
    # robots.txt often declares a sitemap URL that differs from the defaults.
    try:
        robots = fetch_response(urljoin(root + "/", "robots.txt"))
        for line in robots.text.splitlines():
            if line.lower().startswith("sitemap:"):
                candidates.append(line.split(":", 1)[1].strip())
    except requests.RequestException:
        pass

    found = []
    seen_sitemaps = set()
    queue = deque(candidates)
    while queue and len(seen_sitemaps) < 50:
        sitemap_url = clean_url(queue.popleft())
        if not sitemap_url or sitemap_url in seen_sitemaps:
            continue
        seen_sitemaps.add(sitemap_url)
        try:
            response = fetch_response(sitemap_url)
        except requests.RequestException:
            continue
        if "xml" not in response.headers.get("Content-Type", "").lower() and not response.text.lstrip().startswith("<"):
            continue
        try:
            xml_root = ET.fromstring(response.content)
        except ET.ParseError:
            continue
        for element in xml_root.iter():
            if element.tag.lower().endswith("sitemap"):
                loc = next((child.text.strip() for child in element if child.tag.lower().endswith("loc") and child.text), None)
                if loc:
                    queue.append(loc)
            elif element.tag.lower().endswith("url"):
                loc = next((child.text.strip() for child in element if child.tag.lower().endswith("loc") and child.text), None)
                normalized = normalize_url(loc) if loc else None
                if normalized and is_same_domain(normalized, root) and not is_ignored_url(normalized):
                    found.append(normalized)
    # Preserve order while deduplicating.
    return list(dict.fromkeys(found))

# ==========================================

# Table-aware text extraction

#

# soup.get_text() flattens everything -- including tables -- into one

# undifferentiated string. That's what usually destroys info like

# "HOD: Dr. XYZ" because the name and the role label end up far apart

# in the flattened text, and the chunker can slice right between them.

#

# Here we convert each <table> into readable "cell | cell | cell" rows

# BEFORE flattening, so the relationship between columns survives into

# plain text, and we use "\n" (not " ") as the block separator so

# paragraphs/list items/headings stay visually distinct too.

# ==========================================

def linearize_tables(soup):

    for table in soup.find_all("table"):

        rows_text = []

        for tr in table.find_all("tr"):

            cells = [c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]

            cells = [c for c in cells if c]

            if cells:

                rows_text.append(" | ".join(cells))

        table_text = "\n".join(rows_text)

        table.replace_with(NavigableString(f"\n{table_text}\n"))

    return soup

def extract_table_documents(html, source_url, page_title):
    """Create table-focused documents so row values stay tied to their headers."""
    soup = BeautifulSoup(html, "html.parser")
    table_documents = []
    for table_index, table in enumerate(soup.find_all("table"), start=1):
        rows = []
        for tr in table.find_all("tr"):
            cells = [re.sub(r"\s+", " ", cell.get_text(" ", strip=True)) for cell in tr.find_all(["th", "td"])]
            cells = [cell for cell in cells if cell]
            if cells:
                rows.append(cells)
        if len(rows) < 2:
            continue
        # Use an explicit header when present; otherwise treat the first row as a header.
        first_row = table.find("tr")
        has_header = bool(first_row and first_row.find_all("th"))
        headers = rows[0] if has_header else [f"Column {i + 1}" for i in range(len(rows[0]))]
        data_rows = rows[1:] if has_header else rows
        # Keep groups small and repeat the source/header context in each group.
        for group_start in range(0, len(data_rows), 8):
            group = data_rows[group_start:group_start + 8]
            lines = [
                f"Structured table data from MITS page: {page_title or source_url}",
                f"Source URL: {source_url}",
                f"Table number: {table_index}",
                "Column headings: " + " | ".join(headers),
            ]
            for row in group:
                pairs = []
                for index, value in enumerate(row):
                    label = headers[index] if index < len(headers) else f"Column {index + 1}"
                    pairs.append(f"{label}: {value}")
                lines.append("Record: " + " | ".join(pairs))
            table_documents.append(Document(
                page_content="\n".join(lines),
                metadata={"source": source_url, "title": page_title or "MITS table", "content_type": "table", "table_number": table_index},
            ))
    return table_documents

def extract_pdf_document(response, source_url):
    """Extract text from a PDF when pypdf is installed; report skipped PDFs otherwise."""
    try:
        from pypdf import PdfReader
        from io import BytesIO
        reader = PdfReader(BytesIO(response.content))
        pages = []
        for index, page in enumerate(reader.pages, start=1):
            page_text = (page.extract_text() or "").strip()
            if page_text:
                pages.append(f"PDF page {index}:\n{page_text}")
        text = "\n\n".join(pages).strip()
        if not text:
            return None
        title = Path(urlparse(source_url).path).name or "MITS PDF"
        return Document(page_content=f"PDF document: {title}\nSource URL: {source_url}\n\n{text}", metadata={"source": source_url, "title": title, "content_type": "pdf"})
    except ImportError:
        print(f"PDF skipped (install pypdf to extract it): {source_url}")
    except Exception as exc:
        print(f"Could not extract PDF {source_url}: {exc}")
    return None

def extract_text(html):

    soup = BeautifulSoup(html, "html.parser")

    # The site's entire mega-menu (every department/committee/link on the

    # site) lives inside <header>, not <nav> — it has no <nav> tag at all.

    # Without stripping <header> too, that same ~2.5k-char menu block gets

    # prepended to every single crawled page, flooding the corpus with

    # near-duplicate chunks that crowd out page-specific content in

    # similarity search (e.g. a query about the Principal was outranked

    # by menu-polluted chunks from unrelated pages).

    for element in soup(["script", "style", "nav", "footer", "header"]):

        element.decompose()

    soup = linearize_tables(soup)

    text = soup.get_text(separator="\n", strip=True)

    # collapse runs of blank lines

    lines = [line.strip() for line in text.split("\n")]

    lines = [line for line in lines if line]

    return "\n".join(lines)

# ==========================================

# Department directory synthesis

# ==========================================

# The site never lists all departments on one page — each has its own

# /department/<code> page describing only itself. The one place all of

# them appear together is the nav menu, which extract_text() strips out

# (correctly — keeping it would duplicate that boilerplate into every

# page and drown out page-specific content in similarity search). So

# "list all departments"-style queries have no single chunk that could

# ever answer them, no matter how retrieval is tuned.

#

# Fix: pull the canonical department names straight from the nav's own

# /department/<code> links while crawling, dedup by code, and synthesize

# one dedicated document out of them. This adds exactly the missing

# "list" without reintroducing the rest of the nav noise.

_NON_NAME_LINK_TEXT = {

    "view details", "view all", "view more", "read more",

    "learn more", "know more", "explore", "explore more",

}

def collect_department_links(soup, seen):

    for a in soup.find_all("a", href=True):

        href = a["href"]

        if "/department/" not in href:

            continue

        slug = href.rstrip("/").split("/department/")[-1]

        text = a.get_text(strip=True)

        if not text or text.lower() in _NON_NAME_LINK_TEXT:

            continue

        existing = seen.get(slug)

        is_full_form = text.lower().startswith("department of")

        if existing is None or (is_full_form and not existing.lower().startswith("department of")):

            seen[slug] = text

    # Every department name we do see should read as "Department of X" for

    # a consistent directory listing, even if only the short nav form (e.g.

    # "Artificial Intelligence & Data Science") turned up on the crawled

    # pages.

    for slug, name in seen.items():

        if not name.lower().startswith("department of"):

            seen[slug] = f"Department of {name}"

def build_department_directory_document(department_names):

    if not department_names:

        return None

    names = sorted(set(department_names.values()))

    body = "\n".join(f"- {name}" for name in names)

    content = f"Departments at Muthoot Institute of Technology and Science (MITS):\n{body}"

    return Document(

        page_content=content,

        metadata={"source": "https://mgmits.ac.in (departments directory, compiled from site navigation)"},

    )

# ==========================================

# Contact info synthesis

# ==========================================

# The /contact page's real facts (address, phone, office hours) are

# genuinely present but get buried inside one chunk mixed with contact-form

# boilerplate ("Follow Us", "Enquire Now", form-validation text). That mix

# pulls the chunk's embedding away from what someone would actually ask

# ("what are the college's timings/hours") — it ranked ~400th out of 567

# chunks even with a strong embedding model. Pulling the labeled fields out

# into their own compact, single-purpose document fixes that the same way

# the department directory does for the never-listed-in-one-place problem.

CONTACT_FIELD_LABELS = ["Address", "Phone Number", "Email", "Office Hours"]

_CONTACT_STOP_WORDS = CONTACT_FIELD_LABELS + ["Follow Us", "Enquire Now"]

def extract_contact_fields(text):

    fields = {}

    for i, label in enumerate(CONTACT_FIELD_LABELS):

        stop_words = [w for w in _CONTACT_STOP_WORDS if w != label]

        stop_pattern = "|".join(re.escape(w) for w in stop_words)

        pattern = rf"{re.escape(label)}\s*(.*?)(?:{stop_pattern}|$)"

        match = re.search(pattern, text, re.DOTALL)

        if not match:

            continue

        value = " ".join(match.group(1).split())

        if value:

            fields[label] = value

    return fields

def build_contact_info_document(contact_fields):

    if not contact_fields:

        return None

    lines = [f"{label}: {value}" for label, value in contact_fields.items()]

    content = "Contact information for Muthoot Institute of Technology and Science (MITS):\n" + "\n".join(lines)

    return Document(

        page_content=content,

        metadata={"source": "https://mgmits.ac.in/contact (contact info summary)"},

    )

# ==========================================

# Other high-value directory synthesis

# ==========================================

# Same principle as the department directory and contact info above:

# these are real facts on the site that are either compact enough to

# always include once found, or get diluted/split inside a long,

# multi-topic page. All of it is extracted verbatim from crawled text —

# nothing here is invented.

def extract_between(text, start_marker, end_marker):

    """Returns the text between two exact, unique markers (both excluded)."""

    start_idx = text.find(start_marker)

    if start_idx == -1:

        return None

    start_idx += len(start_marker)

    end_idx = text.find(end_marker, start_idx)

    if end_idx == -1:

        return None

    return text[start_idx:end_idx].strip()

def build_hostel_document(text):

    admin_section = extract_between(text, "Hostel Administration", "Matron |")

    matron_line = extract_between(text, "Matron |", "Eve")

    if not admin_section:

        return None

    lines = [line for line in admin_section.split("\n") if line.strip()]

    if matron_line:

        lines.append(f"Matron | {matron_line.strip()}")

    content = (

        "Hostel administration at Muthoot Institute of Technology and Science (MITS) "

        "(Adam's House is the Men's Hostel, Eve's House is the Ladies' Hostel):\n"

        + "\n".join(lines)

    )

    return Document(

        page_content=content,

        metadata={"source": "https://mgmits.ac.in/hostel (administration summary)"},

    )

def build_admissions_document(text):

    section = extract_between(text, "01\nEligibility Criteria", "Happenings @ MITS")

    if not section:

        return None

    content = "Admission process at Muthoot Institute of Technology and Science (MITS):\n" + section

    return Document(

        page_content=content,

        metadata={"source": "https://mgmits.ac.in (admission process, compiled from homepage)"},

    )

def build_courses_document(text):

    section = extract_between(text, "courses\ncourses\n", "departments\ndepartments\n")

    if not section:

        return None

    # The source site has a couple of inconsistent spacing typos in this

    # list ("B Tech", "B .Tech" alongside "B.Tech") — normalized here since

    # it's clearly the same "B.Tech" abbreviation, not a different naming.

    programmes = [line.strip() for line in section.split("\n") if line.strip()]

    programmes = [re.sub(r"^B\s*\.?\s*Tech\b", "B.Tech", p, flags=re.IGNORECASE) for p in programmes]

    body = "\n".join(f"- {p}" for p in programmes)

    content = f"Programmes/courses offered at Muthoot Institute of Technology and Science (MITS):\n{body}"

    return Document(

        page_content=content,

        metadata={"source": "https://mgmits.ac.in (programmes offered, compiled from homepage)"},

    )

# ==========================================

# Crawl website

# ==========================================

async def crawl_website_async(start_url, max_pages=MAX_PAGES):
    """Crawl MITS with Crawl4AI, preserving the existing extraction pipeline."""
    start_url = normalize_url(start_url) or start_url
    sitemap_urls = discover_sitemap_urls(start_url)
    seeds = [start_url, normalize_url(urljoin(start_url + "/", "cs-staff"))]
    priority_terms = (
        "placement", "career", "staff", "faculty", "department", "admission",
        "contact", "academic", "research", "hostel", "facility", "program",
    )
    sitemap_urls.sort(key=lambda item: (
        min((item.lower().find(term) for term in priority_terms if term in item.lower()), default=10**9),
        item,
    ))
    seeds.extend(sitemap_urls)
    queue = deque(url for url in seeds if url)
    queued = set(queue)
    visited = set()
    documents = []
    department_names = {}
    contact_fields = {}
    extra_documents = []
    report = {
        "start_url": start_url,
        "sitemap_urls_discovered": len(sitemap_urls),
        "pages_attempted": 0,
        "pages_fetched": 0,
        "html_pages_extracted": 0,
        "pdfs_extracted": 0,
        "empty_pages": [],
        "failed_urls": [],
        "pages": [],
        "max_pages": max_pages,
        "queue_remaining_at_limit": 0,
        "crawler": "Crawl4AI with Requests fallback" if CRAWL4AI_AVAILABLE else "Requests fallback (Crawl4AI not installed)",
        "crawl4ai_failures": [],
    }

    browser_config = BrowserConfig(headless=True, verbose=False) if CRAWL4AI_AVAILABLE else None
    crawler_context = AsyncWebCrawler(config=browser_config) if CRAWL4AI_AVAILABLE else None

    async def process_queue(crawler):
        while queue and len(visited) < max_pages:
            url = clean_url(queue.popleft())
            if not url or url in visited:
                continue
            if not is_same_domain(url, start_url) or is_ignored_url(url):
                continue
            visited.add(url)
            report["pages_attempted"] += 1
            print(f"Crawling ({len(visited)}/{max_pages}): {url}")

            final_url = url
            html = None
            response = None
            is_pdf = urlparse(url).path.lower().endswith(".pdf")

            # PDFs continue through Requests/pypdf; Crawl4AI is used for HTML pages.
            if is_pdf:
                try:
                    response = fetch_response(url)
                    final_url = normalize_url(response.url) or response.url
                    report["pages_fetched"] += 1
                    pdf_doc = extract_pdf_document(response, final_url)
                    if pdf_doc:
                        documents.append(pdf_doc)
                        report["pdfs_extracted"] += 1
                    else:
                        report["empty_pages"].append({"url": final_url, "reason": "PDF had no extractable text or pypdf is unavailable"})
                except requests.RequestException as exc:
                    report["failed_urls"].append({"url": url, "error": str(exc)})
                    print(f"  Could not access PDF: {exc}")
                continue

            if crawler is not None:
                try:
                    run_config = CrawlerRunConfig(
                        cache_mode=CacheMode.BYPASS,
                        page_timeout=REQUEST_TIMEOUT * 1000,
                    )
                    result = await crawler.arun(url=url, config=run_config)
                    if result.success and result.html:
                        html = result.html
                        final_url = normalize_url(getattr(result, "url", None) or url) or url
                    else:
                        reason = getattr(result, "error_message", "Crawl4AI returned no HTML")
                        report["crawl4ai_failures"].append({"url": url, "error": str(reason)})
                except Exception as exc:
                    report["crawl4ai_failures"].append({"url": url, "error": str(exc)})

            # Reliable fallback for pages Crawl4AI could not fetch, and for PDF URLs
            # without a .pdf suffix that are identified by their response headers.
            if html is None:
                try:
                    response = fetch_response(url)
                except requests.RequestException as exc:
                    report["failed_urls"].append({"url": url, "error": str(exc)})
                    print(f"  Could not access: {exc}")
                    continue
                final_url = normalize_url(response.url) or response.url
                report["pages_fetched"] += 1
                content_type = response.headers.get("Content-Type", "").lower()
                if "application/pdf" in content_type or urlparse(final_url).path.lower().endswith(".pdf"):
                    pdf_doc = extract_pdf_document(response, final_url)
                    if pdf_doc:
                        documents.append(pdf_doc)
                        report["pdfs_extracted"] += 1
                    else:
                        report["empty_pages"].append({"url": final_url, "reason": "PDF had no extractable text or pypdf is unavailable"})
                    continue
                if "text/html" not in content_type and "application/xhtml+xml" not in content_type:
                    continue
                html = response.text
            else:
                report["pages_fetched"] += 1

            page_soup = BeautifulSoup(html, "html.parser")
            title_node = page_soup.find("title")
            page_title = title_node.get_text(" ", strip=True) if title_node else ""
            table_docs = extract_table_documents(html, final_url, page_title)
            text = extract_text(html)

            if text:
                documents.append(Document(
                    page_content=f"Page title: {page_title}\nSource URL: {final_url}\n\n{text}",
                    metadata={"source": final_url, "title": page_title, "content_type": "html"},
                ))
                documents.extend(table_docs)
                report["html_pages_extracted"] += 1
                report["pages"].append({
                    "url": final_url,
                    "title": page_title,
                    "text_characters": len(text),
                    "table_documents": len(table_docs),
                })
            else:
                report["empty_pages"].append({"url": final_url, "reason": "HTML returned no extractable text"})

            if urlparse(final_url).path.rstrip("/").lower() == "/contact":
                contact_fields.update(extract_contact_fields(text))
            if urlparse(final_url).path.rstrip("/").lower() == "/hostel":
                doc = build_hostel_document(text)
                if doc:
                    extra_documents.append(doc)
            if final_url == start_url or urlparse(final_url).path == "/":
                admissions_doc = build_admissions_document(text)
                if admissions_doc:
                    extra_documents.append(admissions_doc)
                courses_doc = build_courses_document(text)
                if courses_doc:
                    extra_documents.append(courses_doc)

            collect_department_links(page_soup, department_names)
            for anchor in page_soup.find_all("a", href=True):
                href = anchor.get("href", "").strip()
                if not href or href.startswith(("mailto:", "tel:", "javascript:")):
                    continue
                next_url = normalize_url(urljoin(final_url, href))
                if not next_url or not is_same_domain(next_url, start_url) or is_ignored_url(next_url):
                    continue
                if next_url not in visited and next_url not in queued:
                    queue.append(next_url)
                    queued.add(next_url)

            if REQUEST_DELAY_SECONDS:
                await asyncio.sleep(REQUEST_DELAY_SECONDS)

    if crawler_context is not None:
        async with crawler_context as crawler:
            await process_queue(crawler)
    else:
        await process_queue(None)

    report["queue_remaining_at_limit"] = len(queue)
    report["pages_visited_unique"] = len(visited)
    report["department_links_discovered"] = len(department_names)

    directory_document = build_department_directory_document(department_names)
    if directory_document:
        documents.append(directory_document)
    contact_document = build_contact_info_document(contact_fields)
    if contact_document:
        documents.append(contact_document)
    documents.extend(extra_documents)

    report["documents_created"] = len(documents)
    report["note"] = (
        "Crawl4AI supplies rendered HTML where available; the existing BeautifulSoup extraction, "
        "table-aware documents, PDF extraction, and synthesized college documents are retained. "
        "Crawl4AI failures are recorded and fall back to Requests. Scanned/image-only PDFs may require OCR."
    )
    return documents, report


def crawl_website(start_url, max_pages=MAX_PAGES):
    """Synchronous wrapper used by main(); keeps the existing call signature."""
    return asyncio.run(crawl_website_async(start_url, max_pages=max_pages))

# ==========================================
# MAIN
# ==========================================

def main():
    parser = argparse.ArgumentParser(description="Build the NAVIKA RAG vector store.")
    parser.add_argument("--recrawl", action="store_true", help="Fetch fresh website content instead of using the saved crawl cache.")
    parser.add_argument("--max-pages", type=int, default=MAX_PAGES, help=f"Maximum same-domain pages to visit (default: {MAX_PAGES}).")
    parser.add_argument("--no-cache", action="store_true", help="Ignore the cached crawl and fetch the website again.")
    args = parser.parse_args()

    if args.max_pages < 1:
        parser.error("--max-pages must be at least 1")

    if CACHE_FILE.exists() and not args.recrawl and not args.no_cache:
        print(f"Loading cached website crawl from {CACHE_FILE}. Use --recrawl to refresh it.")
        with CACHE_FILE.open("rb") as cache_file:
            cached = pickle.load(cache_file)
        # Support both the current document-only cache and the newer cache envelope.
        if isinstance(cached, dict) and "documents" in cached:
            documents = cached["documents"]
            crawl_report = cached.get("report", {"note": "Loaded legacy cache without a crawl report."})
        else:
            documents = cached
            crawl_report = {"note": "Loaded legacy cache; page coverage cannot be verified from this cache."}
    else:
        print("Starting full website crawl (sitemap + internal links)...")
        documents, crawl_report = crawl_website(START_URL, max_pages=args.max_pages)
        with CACHE_FILE.open("wb") as cache_file:
            pickle.dump({"documents": documents, "report": crawl_report}, cache_file)
        print(f"Cached {len(documents)} website documents to {CACHE_FILE}.")

    with CRAWL_REPORT_FILE.open("w", encoding="utf-8") as report_file:
        json.dump(crawl_report, report_file, indent=2, ensure_ascii=False)

    print("\nWebsite crawl summary:")
    print(f"  Sitemap URLs discovered: {crawl_report.get('sitemap_urls_discovered', 'unknown')}")
    print(f"  HTML pages extracted: {crawl_report.get('html_pages_extracted', 'unknown')}")
    print(f"  PDFs extracted: {crawl_report.get('pdfs_extracted', 'unknown')}")
    print(f"  Failed URLs: {len(crawl_report.get('failed_urls', []))}")
    print(f"  Empty/unextractable pages: {len(crawl_report.get('empty_pages', []))}")
    print(f"  Queue remaining at page limit: {crawl_report.get('queue_remaining_at_limit', 'unknown')}")
    print(f"  Full crawl report: {CRAWL_REPORT_FILE}")
    print(f"Website documents loaded: {len(documents)}")

    # Preserve the project's existing spatial and curated college knowledge.
    spatial_documents = load_spatial_documents()
    print(f"Spatial documents loaded: {len(spatial_documents)}")
    documents.extend(spatial_documents)

    college_facts_documents = load_college_facts_documents()
    print(f"College-facts documents loaded: {len(college_facts_documents)}")
    documents.extend(college_facts_documents)
    print(f"Total knowledge documents: {len(documents)}")

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    chunks = splitter.split_documents(documents)
    print(f"Text chunks created: {len(chunks)}")

    print("Creating embeddings...")
    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    vectorstore = FAISS.from_documents(chunks, embeddings)
    vectorstore.save_local(str(VECTORSTORE_DIR))
    print(f"NAVIKA knowledge base saved to: {VECTORSTORE_DIR}")

    if crawl_report.get("queue_remaining_at_limit", 0):
        print("WARNING: the crawl reached --max-pages before exhausting discovered URLs.")
        print("Increase --max-pages and rerun with --recrawl for broader coverage.")

if __name__ == "__main__":
    main()
