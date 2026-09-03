import os
from dotenv import load_dotenv

from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_groq import ChatGroq


load_dotenv()

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
    "vectorstore",
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
    model="llama-3.1-8b-instant",
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