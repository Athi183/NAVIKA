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
import pickle
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

CHUNK_SIZE = 800
CHUNK_OVERLAP = 150

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

    for element in soup(["script", "style", "nav", "footer"]):
        element.decompose()

    soup = linearize_tables(soup)

    text = soup.get_text(separator="\n", strip=True)

    # collapse runs of blank lines
    lines = [line.strip() for line in text.split("\n")]
    lines = [line for line in lines if line]
    return "\n".join(lines)


# ==========================================
# Crawl website
# ==========================================

def crawl_website(start_url, max_pages=MAX_PAGES, debug=False):
    queue = deque([start_url])
    visited = set()
    documents = []

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

        soup = BeautifulSoup(response.text, "html.parser")
        for link in soup.find_all("a", href=True):
            next_url = clean_url(urljoin(url, link["href"]))

            if not is_same_domain(next_url, start_url):
                continue
            if next_url in visited:
                continue
            if next_url.lower().endswith(IGNORED_EXTENSIONS):
                continue

            queue.append(next_url)

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
        model_name="sentence-transformers/all-MiniLM-L6-v2"
    )

    # ---- Build & save FAISS index ----
    vectorstore = FAISS.from_documents(chunks, embeddings)
    vectorstore.save_local(VECTORSTORE_DIR)

    print("\n================================")
    print(f"RAG knowledge base created! Saved to '{VECTORSTORE_DIR}/'")
    print("================================")


if __name__ == "__main__":
    main()