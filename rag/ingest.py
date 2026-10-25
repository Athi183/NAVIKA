"""
ingest.py
==========
Crawls the college website, extracts text (table-aware so that things like
"Computer Science | Dr. XYZ | HOD" don't get scrambled), chunks it, embeds
it, and saves a FAISS vector store to disk for app.py to query.

Usage:
    python ingest.py                # uses cached crawl if available
    python ingest.py --recrawl      # forces a fresh crawl of the site
    python ingest.py --debug        # prints diagnostics after each stage
"""

import argparse
import csv
import pickle
import re
from pathlib import Path
from collections import deque
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup, NavigableString

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS


# ==========================================
# CONFIG
# ==========================================

START_URL = "https://mgmits.ac.in/"
MAX_PAGES = 80


CACHE_FILE = Path("crawl_cache.pkl")          # raw crawled documents
VECTORSTORE_DIR = "vectorstore"
SPATIAL_CSV_DIR = Path(__file__).resolve().parent / "data/spatial/ramanujan_block"

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
# URL helpers
# ==========================================

def is_same_domain(url, base_url):
    return urlparse(url).netloc == urlparse(base_url).netloc


def clean_url(url):
    url = url.split("#")[0]
    return url.rstrip("/")


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
            cells = [c.get_text(strip=True) for c in tr.find_all(["td", "th"])]
            cells = [c for c in cells if c]
            if cells:
                rows_text.append(" | ".join(cells))
        table_text = "\n".join(rows_text)
        table.replace_with(NavigableString(f"\n{table_text}\n"))
    return soup


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
    programmes = [re.sub(r"^B\s*\.?\s*Tech\b", "B.Tech", p) for p in programmes]

    body = "\n".join(f"- {p}" for p in programmes)
    content = f"Programmes/courses offered at Muthoot Institute of Technology and Science (MITS):\n{body}"

    return Document(
        page_content=content,
        metadata={"source": "https://mgmits.ac.in (programmes offered, compiled from homepage)"},
    )


def load_spatial_documents(csv_dir=SPATIAL_CSV_DIR):
    """Load compact semantic/topology CSV rows into the RAG corpus.

    Raw geometry.csv is intentionally kept for structured coordinate queries
    and is not embedded as thousands of tiny line-segment documents.
    """
    documents = []
    for filename, category in (
        ("places.csv", "spatial_place"),
        ("topology_edges.csv", "spatial_candidate_connection"),
        ("floor_summaries.csv", "spatial_floor_geometry_summary"),
    ):
        path = Path(csv_dir) / filename
        if not path.is_file():
            continue
        with path.open("r", encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                content = row.get("search_text", "").strip()
                if not content:
                    continue
                key = row.get("place_id") or row.get("edge_id") or row.get("floor_id", "row")
                documents.append(Document(
                    page_content=content,
                    metadata={
                        "source": f"spatial-csv://{filename}#{key}",
                        "category": category,
                        "building_id": row.get("building_id", ""),
                        "floor_id": row.get("floor_id", ""),
                        "floor_number": row.get("floor_number", ""),
                        "verification_status": row.get("review_status") or row.get("verification_status", ""),
                    },
                ))
    return documents


# ==========================================
# Crawl website
# ==========================================

def crawl_website(start_url, max_pages=MAX_PAGES, debug=False):
    queue = deque([start_url])
    visited = set()
    documents = []
    department_names = {}
    contact_fields = {}
    extra_documents = []

    while queue and len(visited) < max_pages:
        url = clean_url(queue.popleft())

        if url in visited:
            continue
        visited.add(url)

        print(f"\nCrawling: {url}")

        try:
            response = requests.get(
                url,
                timeout=15,
                headers={"User-Agent": "Mozilla/5.0"},
            )
            response.raise_for_status()
        except Exception as e:
            print(f"Could not access: {url}\n{e}")
            continue

        content_type = response.headers.get("Content-Type", "")
        if "text/html" not in content_type:
            continue

        text = extract_text(response.text)

        if text:
            documents.append(
                Document(page_content=text, metadata={"source": url})
            )
            if debug:
                print(f"  -> extracted {len(text)} chars")

            if url.rstrip("/").endswith("/contact"):
                contact_fields.update(extract_contact_fields(text))

            if url.rstrip("/").endswith("/hostel"):
                doc = build_hostel_document(text)
                if doc:
                    extra_documents.append(doc)

            if url == clean_url(start_url):
                admissions_doc = build_admissions_document(text)
                if admissions_doc:
                    extra_documents.append(admissions_doc)

                courses_doc = build_courses_document(text)
                if courses_doc:
                    extra_documents.append(courses_doc)

        soup = BeautifulSoup(response.text, "html.parser")
        collect_department_links(soup, department_names)

        for link in soup.find_all("a", href=True):
            next_url = clean_url(urljoin(url, link["href"]))

            if not is_same_domain(next_url, start_url):
                continue
            if next_url in visited:
                continue
            if next_url.lower().endswith(IGNORED_EXTENSIONS):
                continue

            queue.append(next_url)

    directory_document = build_department_directory_document(department_names)
    if directory_document:
        documents.append(directory_document)

    contact_document = build_contact_info_document(contact_fields)
    if contact_document:
        documents.append(contact_document)

    documents.extend(extra_documents)

    return documents


# ==========================================
# Debug helpers
# ==========================================

def debug_scan_documents(documents, keywords):
    print("\n" + "=" * 60)
    print(f"DEBUG: scanning {len(documents)} crawled pages for {keywords}")
    print("=" * 60)
    hits = 0
    for doc in documents:
        content_lower = doc.page_content.lower()
        if all(k.lower() in content_lower for k in keywords):
            hits += 1
            print(f"\nMATCH: {doc.metadata['source']}")
            # print a window around the first keyword hit
            idx = content_lower.find(keywords[0].lower())
            start = max(0, idx - 200)
            end = min(len(doc.page_content), idx + 400)
            print(doc.page_content[start:end])
            print("-" * 60)
    if hits == 0:
        print("No pages matched. Either the crawler never reached the "
              "relevant page, or the info is behind JS rendering / an "
              "image / a PDF that get_text() can't see.")


def debug_scan_chunks(chunks, keywords):
    print("\n" + "=" * 60)
    print(f"DEBUG: scanning {len(chunks)} chunks for {keywords}")
    print("=" * 60)
    hits = 0
    for i, chunk in enumerate(chunks):
        content_lower = chunk.page_content.lower()
        if all(k.lower() in content_lower for k in keywords):
            hits += 1
            print(f"\nChunk {i} ({chunk.metadata['source']}):")
            print(chunk.page_content)
            print("-" * 60)
    if hits == 0:
        print("Keywords were found together on a page (see above) but not "
              "together in any single chunk -- they got split across a "
              "chunk boundary. Consider raising CHUNK_SIZE or CHUNK_OVERLAP.")


# ==========================================
# MAIN
# ==========================================

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--recrawl", action="store_true",
                         help="Force a fresh crawl instead of using the cache")
    parser.add_argument("--debug", action="store_true",
                         help="Print diagnostics after crawling and chunking")
    parser.add_argument("--debug-keywords", nargs="+",
                         default=["hod", "computer science"],
                         help="Keywords to search for in debug mode")
    args = parser.parse_args()

    # ---- Crawl (or load cache) ----
    if CACHE_FILE.exists() and not args.recrawl:
        print(f"Loading cached crawl from {CACHE_FILE} "
              f"(use --recrawl to force a fresh crawl)")
        with open(CACHE_FILE, "rb") as f:
            documents = pickle.load(f)
    else:
        print("Starting website crawler...\n")
        documents = crawl_website(START_URL, debug=args.debug)
        with open(CACHE_FILE, "wb") as f:
            pickle.dump(documents, f)
        print(f"\nCached {len(documents)} pages to {CACHE_FILE}")

    spatial_documents = load_spatial_documents()
    documents.extend(spatial_documents)
    print(f"Added {len(spatial_documents)} spatial CSV documents from {SPATIAL_CSV_DIR}")

    print("\n================================")
    print("Crawling completed")
    print("Pages found:", len(documents))
    print("================================")

    if args.debug:
        debug_scan_documents(documents, args.debug_keywords)

    # ---- Chunk ----
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
    )
    chunks = text_splitter.split_documents(documents)
    print(f"Created {len(chunks)} text chunks.")

    if args.debug:
        debug_scan_chunks(chunks, args.debug_keywords)

    # ---- Embed ----
    print("\nCreating embeddings...")
    embeddings = HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL
    )

    # ---- Build & save FAISS index ----
    vectorstore = FAISS.from_documents(chunks, embeddings)
    vectorstore.save_local(VECTORSTORE_DIR)

    print("\n================================")
    print(f"RAG knowledge base created! Saved to '{VECTORSTORE_DIR}/'")
    print("================================")


if __name__ == "__main__":
    main()
