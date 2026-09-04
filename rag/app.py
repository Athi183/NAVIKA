import os
from dotenv import load_dotenv

from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_groq import ChatGroq


load_dotenv()

# ==========================================
# Resolve paths relative to this file
# ==========================================
# main.py imports this module via sys.path.append("../rag"), which
# only affects module lookup — it does NOT change the working
# directory. A plain relative path like "vectorstore" therefore
# resolves against whatever folder main.py was launched FROM, not
# against this file's own location, and load_local() fails to find
# it. Resolving against __file__ makes this work regardless of where
# the importing script is run from.

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VECTORSTORE_PATH = os.path.join(BASE_DIR, "vectorstore")

# ==========================================
# Load embeddings
# ==========================================

embeddings = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2"
)

# ==========================================
# Load FAISS database
# ==========================================

vectorstore = FAISS.load_local(
    VECTORSTORE_PATH,
    embeddings,
    allow_dangerous_deserialization=True
)

# ==========================================
# Create retriever
# ==========================================

retriever = vectorstore.as_retriever(
    search_kwargs={"k": 4}
)

# ==========================================
# LLM
# ==========================================

llm = ChatGroq(
    model="openai/gpt-oss-20b",
    temperature=0
)

# ==========================================
# Ask question
# ==========================================

def ask_question(question):

    documents = retriever.invoke(question)

    context = "\n\n".join(
        document.page_content
        for document in documents
    )

    prompt = f"""
You are a helpful college information assistant.

Answer the user's question ONLY using the information
provided in the context below.

If the answer cannot be found in the context,
say:

"I couldn't find that information on the college website."

Do not make up information.

Context:
{context}

User Question:
{question}

Answer:
"""

    response = llm.invoke(prompt)

    return response.content


# ==========================================
# Chat loop
# ==========================================
# Guarded behind __main__ so importing ask_question from another
# module (e.g. main.py) doesn't trigger this standalone loop and
# block on input().

if __name__ == "__main__":
    print("\nCollege RAG Assistant")
    print("Type 'exit' to stop.\n")

    while True:

        question = input("You: ")

        if question.lower() == "exit":
            print("Goodbye!")
            break

        answer = ask_question(question)

        print("\nAssistant:", answer)
        print()