import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from collections import deque

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS


# ==========================================
# COLLEGE WEBSITE
# ==========================================

START_URL = "https://mgmits.ac.in/"

# Maximum number of webpages to crawl
MAX_PAGES = 50


# ==========================================
# Helper: check whether URL belongs
# to the same website
# ==========================================

def is_same_domain(url, base_url):

    return urlparse(url).netloc == urlparse(base_url).netloc


# ==========================================
# Helper: remove unnecessary parts
# ==========================================

def clean_url(url):

    # Remove fragments such as #about
    url = url.split("#")[0]

    return url.rstrip("/")


# ==========================================
# Crawl website
# ==========================================

def crawl_website(start_url):

    queue = deque([start_url])
    visited = set()

    documents = []

    while queue and len(visited) < MAX_PAGES:

        url = queue.popleft()
        url = clean_url(url)

        if url in visited:
            continue

        visited.add(url)

        print(f"\nCrawling: {url}")

        try:

            response = requests.get(
                url,
                timeout=15,
                headers={
                    "User-Agent": "Mozilla/5.0"
                }
            )

            response.raise_for_status()

        except Exception as e:

            print(f"Could not access: {url}")
            print(e)

            continue

        # Only process HTML pages
        content_type = response.headers.get(
            "Content-Type",
            ""
        )

        if "text/html" not in content_type:

            continue

        soup = BeautifulSoup(
            response.text,
            "html.parser"
        )

        # Remove unnecessary elements
        for element in soup(
            ["script", "style", "nav", "footer", "header"]
        ):
            element.decompose()

        # Extract text
        text = soup.get_text(
            separator=" ",
            strip=True
        )

        if text:

            documents.append(
                Document(
                    page_content=text,
                    metadata={
                        "source": url
                    }
                )
            )

        # ======================================
        # Find links
        # ======================================

        for link in soup.find_all("a", href=True):

            href = link["href"]

            next_url = urljoin(
                url,
                href
            )

            next_url = clean_url(next_url)

            # Only follow links from same domain
            if is_same_domain(
                next_url,
                start_url
            ):

                if next_url not in visited:

                    # Ignore files
                    ignored_extensions = (
                        ".jpg",
                        ".jpeg",
                        ".png",
                        ".gif",
                        ".svg",
                        ".mp4",
                        ".mp3",
                        ".zip",
                        ".doc",
                        ".docx",
                        ".xls",
                        ".xlsx"
                    )

                    if not next_url.lower().endswith(
                        ignored_extensions
                    ):

                        queue.append(next_url)

    return documents


# ==========================================
# MAIN
# ==========================================

print("Starting website crawler...\n")

documents = crawl_website(
    START_URL
)

print("\n================================")
print("Crawling completed")
print("Pages found:", len(documents))
print("================================")


# ==========================================
# Split documents into chunks
# ==========================================

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=800,
    chunk_overlap=150
)

chunks = text_splitter.split_documents(
    documents
)

print(
    f"Created {len(chunks)} text chunks."
)


# ==========================================
# Create embeddings
# ==========================================

print("\nCreating embeddings...")

embeddings = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2"
)


# ==========================================
# Create FAISS database
# ==========================================

vectorstore = FAISS.from_documents(
    chunks,
    embeddings
)

vectorstore.save_local(
    "vectorstore"
)

print("\n================================")
print("RAG knowledge base created!")
print("================================")