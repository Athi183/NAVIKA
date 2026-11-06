"""
Builds a structured faculty directory (name, designation, department,
research interests, photo, and location where known) for the frontend's
faculty search dropdown.

Parses each department staff/faculty page's LIVE HTML directly via
BeautifulSoup rather than the already-crawled, text-only
crawl_cache.pkl: the site renders each person as a clean, consistent
`<a class="profileBx"><div class="imageBx"><img>...<div class="txtBx">
<h5>Name</h5><h6>Designation</h6><ul><li>interest</li>...` block
(confirmed identical across multiple different department pages), which
pairs a person's name, designation, interests, and PHOTO together
reliably by DOM structure. The old approach -- reconstructing this from
flattened, HTML-stripped text via line-position heuristics -- had no way
to recover a photo at all (extract_text() in ingest.py discards every
<img> tag), and was inherently more fragile for everything else too.

Still deliberately does NOT go through the LLM or RAG pipeline -- this
is a live but plain, structured fetch-and-parse, no model call, no
tokens spent, consistent with the rest of this app's directory-style
endpoints (see placement_directory.py for the same reasoning in more
detail).
"""

import re

import requests
from bs4 import BeautifulSoup

_SESSION = requests.Session()
_SESSION.headers.update({"User-Agent": "Mozilla/5.0 (compatible; NAVIKACollegeAssistant/1.0)"})
_REQUEST_TIMEOUT = 15

# One (or two, for departments split into "-faculty"/"-staff" and a
# "technical staff" page) URL per department, confirmed directly against
# the live site. Naming is inconsistent across departments (CSE's own
# teaching-faculty page is "cs-staff", not "cs-faculty", unlike every
# other department) -- found the hard way earlier in this project, so
# every known page is listed explicitly here rather than guessed from a
# naming pattern.
_STAFF_PAGE_URLS = [
    "https://mgmits.ac.in/cs-staff",
    "https://mgmits.ac.in/cstechnicalstaff",
    "https://mgmits.ac.in/ad-faculty",
    "https://mgmits.ac.in/ad-staff",
    "https://mgmits.ac.in/ca-faculty",
    "https://mgmits.ac.in/ca-staff",
    "https://mgmits.ac.in/cc-faculty",
    "https://mgmits.ac.in/cc-staff",
    "https://mgmits.ac.in/ce-faculty",
    "https://mgmits.ac.in/ce-staff",
    "https://mgmits.ac.in/ec-faculty",
    "https://mgmits.ac.in/ec-technical-staff",
    "https://mgmits.ac.in/ee-faculty",
    "https://mgmits.ac.in/ee-technical-staff",
    "https://mgmits.ac.in/me-faculty",
    "https://mgmits.ac.in/bsh-faculty",
    "https://mgmits.ac.in/bsh-technical-staff",
]

# Keyed by the URL prefix each department's pages use (e.g. "cs-staff",
# "cs-faculty" both belong to "cs"). Taken from the department directory
# this site itself links under /department/<code>.
_DEPARTMENT_NAMES = {
    "ad": "Artificial Intelligence & Data Science",
    "bsh": "Basic Science and Humanities",
    "ca": "Computer Applications",
    "cc": "Cyber Security",
    "ce": "Civil Engineering",
    "cs": "Computer Science & Engineering",
    "cst": "Computer Science & Engineering",
    "ec": "Electronics & Communication Engineering",
    "ee": "Electrical & Electronics Engineering",
    "me": "Mechanical Engineering",
}

# Only departments actually present in the reviewed Ramanujan Block DXF
# floor-plan data (data/spatial/ramanujan_block/places.csv -- confirmed
# directly, see spatial_lookup.py) get a location. The other departments
# aren't covered by any DXF data this app has at all; returning a guess
# for them would be worse than admitting it isn't known.
_DEPARTMENT_LOCATIONS = {
    "Computer Science & Engineering": "Ramanujan Block, Floors 2-5",
    "Electrical & Electronics Engineering": "Ramanujan Block, Floor 2",
    "Artificial Intelligence & Data Science": "Ramanujan Block, Floors 4-5",
    "Cyber Security": "Ramanujan Block, Floor 6",
}


def _department_for_url(url):
    path = url.rsplit("/", 1)[-1]
    prefix = re.match(r"[a-z]+", path.lower())
    code = prefix.group(0) if prefix else ""
    for candidate in sorted(_DEPARTMENT_NAMES, key=len, reverse=True):
        if code.startswith(candidate):
            return _DEPARTMENT_NAMES[candidate]
    return "Unknown Department"


def _parse_staff_page(html):
    soup = BeautifulSoup(html, "html.parser")
    people = []

    for block in soup.select("a.profileBx"):
        name_tag = block.select_one(".txtBx h5")
        designation_tag = block.select_one(".txtBx h6")
        if not name_tag or not designation_tag:
            continue

        img_tag = block.select_one(".imageBx img")
        # Lazy-loaded images here carry the real URL in data-src, with
        # src left as a placeholder/duplicate -- data-src first, src as
        # the fallback if a page doesn't use lazy-loading.
        photo = None
        if img_tag:
            photo = img_tag.get("data-src") or img_tag.get("src")

        interests = [li.get_text(strip=True) for li in block.select(".contLstWraP li")]

        people.append({
            "name": name_tag.get_text(strip=True),
            "designation": designation_tag.get_text(strip=True),
            "interests": [i for i in interests if i],
            "photo": photo,
        })

    return people


def build_faculty_directory():
    """
    Returns a deduplicated, alphabetically-sorted list of
    {name, designation, department, interests, photo, location} by
    fetching and parsing every known department staff/faculty page live.
    Safe to call once at process startup and cache the result. A page
    that fails to fetch (network issue, site down) is skipped rather than
    failing the whole directory -- a partial directory is better than
    none.
    """

    directory = {}
    for url in _STAFF_PAGE_URLS:
        try:
            response = _SESSION.get(url, timeout=_REQUEST_TIMEOUT)
            response.raise_for_status()
        except requests.RequestException:
            continue

        department = _department_for_url(url)
        location = _DEPARTMENT_LOCATIONS.get(department)

        for person in _parse_staff_page(response.text):
            key = person["name"].lower().strip()
            if key in directory:
                continue
            directory[key] = {
                "name": person["name"],
                "designation": person["designation"],
                "department": department,
                "interests": person["interests"],
                "photo": person["photo"],
                "location": location,
            }

    return sorted(directory.values(), key=lambda p: p["name"].lower())
