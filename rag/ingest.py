import os
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS


load_dotenv()

WEBSITE_URL = "https://mgmits.ac.in/"

# ==========================================
# Download webpage
# ==========================================

response = requests.get(
    WEBSITE_URL,
    timeout=20,
    headers={
        "User-Agent": "Mozilla/5.0"
    }
)

response.raise_for_status()
soup = BeautifulSoup(response.text, "html.parser")

# Remove unnecessary elements
for element in soup(["script", "style", "nav", "footer"]):
    element.decompose()

text = soup.get_text(separator=" ", strip=True)

print(f"Extracted {len(text)} characters.")

# ==========================================
# Create document
# ==========================================

document = Document(
    page_content=text,
    metadata={"source": WEBSITE_URL}
)

# ==========================================
# Split into chunks
# ==========================================

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=800,
    chunk_overlap=150
)

chunks = text_splitter.split_documents([document])

print(f"Created {len(chunks)} chunks.")

# ==========================================
# Create embeddings
# ==========================================

embeddings = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2"
)

# ==========================================
# Create FAISS vector database
# ==========================================

vectorstore = FAISS.from_documents(
    chunks,
    embeddings
)

vectorstore.save_local("vectorstore")

print("Vector database created successfully!")