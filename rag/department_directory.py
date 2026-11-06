"""
Builds a structured department directory (name, description, HOD, source
link) for the frontend's Departments screen.

Deliberately scoped narrower than it could be. Course listings and
department-level placement stats ARE present on these pages, but in
genuinely inconsistent formats across departments -- confirmed directly:
course blocks are "Name ( N Seats )" inline on some pages and a separate
Duration/Credits/Intake block on others, and the placement stat labels
differ in both wording AND order department to department ("Students
placed / Offers received / Highest Package" vs "Offers / Students Placed
/ Companies Associated / Highest Package(LPA)" vs "Students Placed /
Median Salary / Offers Received / Companies Associated"). A fragile
regex guessing at a fixed format would risk silently showing a wrong
number for some department -- exactly the class of bug this project hit
once already with placement data getting mixed up across sources. Rather
than risk that, this only extracts what parses reliably everywhere (the
description paragraph, via a verified two-tier anchor), and links out to
the real department page for anyone who wants the full course/stat
detail instead of guessing at it.
"""

import pickle
import re
from pathlib import Path

CACHE_FILE = Path(__file__).resolve().parent / "crawl_cache.pkl"
_DEANS_AND_HEADS_URL = "https://mgmits.ac.in/deans-and-heads"

# Same mapping as faculty_directory.py's _DEPARTMENT_NAMES (kept as its
# own copy rather than imported -- these two directories are keyed
# slightly differently: this one by the /department/<code> URL segment,
# that one by a staff/faculty page's URL prefix, and they don't always
# agree on which codes exist, e.g. faculty_directory.py's "cst" alias
# doesn't apply here).
_DEPARTMENT_NAMES = {
    "ad": "Artificial Intelligence & Data Science",
    "bsh": "Basic Science and Humanities",
    "ca": "Computer Applications",
    "cc": "Cyber Security",
    "ce": "Civil Engineering",
    "cs": "Computer Science & Engineering",
    "ec": "Electronics & Communication Engineering",
    "ee": "Electrical & Electronics Engineering",
    "me": "Mechanical Engineering",
}


def _extract_description(text):
    lines = [line.strip() for line in text.split("\n")]

    # Most pages have a "Contact" nav item (case varies -- "Contact",
    # "CONTACT" -- confirmed both exist) as the last thing before the
    # section heading repeats the department name and the real
    # description paragraph begins right after.
    contact_index = next((i for i, line in enumerate(lines) if line.lower() == "contact"), None)
    if contact_index is not None:
        start = contact_index + 2
    else:
        # Fallback for the pages with no Contact nav item at all
        # (confirmed: Computer Applications is one): find the page's own
        # title line (always at a fixed position after the "Page title:"/
        # "Source URL:"/blank preamble) recurring with a long, sentence-
        # like line right after it -- the short nav-menu repeats of the
        # same title don't have that, which is what distinguishes the
        # real section heading from the earlier ones.
        start = None
        title_line = lines[3] if len(lines) > 3 else None
        if title_line:
            for i, line in enumerate(lines):
                if line == title_line and i + 1 < len(lines) and len(lines[i + 1]) > 50:
                    start = i + 1
                    break

    if start is None:
        return None

    collected = []
    for line in lines[start:]:
        if not line or line.isdigit() or line.lower() in ("mission", "vision"):
            break
        collected.append(line)
        if len(collected) >= 3:
            break

    return " ".join(collected) if collected else None


def _normalize_department_text(text):
    return re.sub(r"[^a-z]", "", text.lower().replace("&", "and").replace("department of", ""))


def _hod_names_by_department(documents):
    """
    The site's own dedicated Academic Heads list (deans-and-heads) is a
    cleaner, authoritative source for this one fact than inferring it
    from each person's own staff-page designation -- confirmed directly:
    cross-referencing designations alone missed Computer Applications'
    real HOD entirely (her staff-page designation is plain "Professor",
    with no "HOD" in it at all -- a genuine inconsistency on the source
    site, not a parsing bug), and a naive "designation contains 'hod'"
    check elsewhere matched "Asst. HOD" as readily as "HOD" (a real,
    confirmed false positive: CSE's Assistant HOD outranked its actual
    HOD before this was caught). This list has neither problem -- every
    row is "Name | HoD, Department of X" or the Asst. variant, parsed and
    matched against this app's own department names by a normalized
    (lowercased, &/and-insensitive) comparison.
    """

    doc = next((d for d in documents if d.metadata.get("source", "") == _DEANS_AND_HEADS_URL), None)
    if doc is None:
        return {}

    canonical_by_normalized = {_normalize_department_text(name): name for name in _DEPARTMENT_NAMES.values()}

    hod_by_department = {}
    for line in doc.page_content.split("\n"):
        if "|" not in line:
            continue
        name, _, designation = line.partition("|")
        name, designation = name.strip(), designation.strip()

        if not re.search(r"\bhod\b", designation, re.IGNORECASE):
            continue
        if re.search(r"\basst\.?\s*hod\b", designation, re.IGNORECASE):
            continue

        department_text = re.sub(r"^hod,?\s*", "", designation, flags=re.IGNORECASE).strip()
        canonical_name = canonical_by_normalized.get(_normalize_department_text(department_text))
        if canonical_name:
            hod_by_department[canonical_name] = name

    return hod_by_department


def _normalize_person_name(name):
    # The same person's name is punctuated differently across the two
    # source pages this cross-references -- confirmed directly: "Dr.
    # Anishin Raj M.M" (deans-and-heads) vs "Dr.Anishin Raj M M" (their
    # own staff page), a period-and-spacing difference only. Stripping
    # everything but letters avoids an exact-string match losing the
    # photo over formatting that was never a different identity.
    return re.sub(r"[^a-z]", "", name.lower())


def _photo_for_name(name, faculty):
    key = _normalize_person_name(name)
    return next((person["photo"] for person in faculty if _normalize_person_name(person["name"]) == key), None)


def build_department_directory(faculty):
    """
    faculty: the already-built faculty_directory.build_faculty_directory()
    list, passed in rather than rebuilt here -- that function does a live
    HTTP fetch per staff/faculty page (~10s total), and backend/app.py
    already calls it once at startup for /api/faculty; redoing that same
    fetch a second time here just to look up HODs would double the
    startup cost for no benefit.

    Returns an alphabetically-sorted list of
    {code, name, description, hod, sourceUrl} for every department.
    Safe to call once at process startup and cache the result.
    """

    if not CACHE_FILE.exists():
        return []

    with CACHE_FILE.open("rb") as f:
        cached = pickle.load(f)
    documents = cached["documents"] if isinstance(cached, dict) and "documents" in cached else cached

    hod_names = _hod_names_by_department(documents)

    departments = []
    for code, name in _DEPARTMENT_NAMES.items():
        source_url = f"https://mgmits.ac.in/department/{code}"
        doc = next((d for d in documents if d.metadata.get("source", "") == source_url), None)
        description = _extract_description(doc.page_content) if doc else None

        hod_name = hod_names.get(name)
        hod = {"name": hod_name, "photo": _photo_for_name(hod_name, faculty)} if hod_name else None

        departments.append({
            "code": code,
            "name": name,
            "description": description,
            "hod": hod,
            "sourceUrl": source_url,
        })

    departments.sort(key=lambda d: d["name"])
    return departments
