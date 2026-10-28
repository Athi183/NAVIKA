import os
import re

# Must be set before HuggingFaceEmbeddings loads the tokenizer — the
# STT/NLU pipeline that calls into this module runs it after already
# using tokenizers elsewhere in the process, which otherwise prints a
# fork-safety warning on every single query.
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

from dotenv import load_dotenv

from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_groq import ChatGroq

try:
    from .spatial_lookup import spatial_context_for_question
except ImportError:
    from spatial_lookup import spatial_context_for_question


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
# Must match ingest.py's EMBEDDING_MODEL — the index was built with these
# vectors, and a mismatched model would silently return garbage nearest
# neighbors instead of erroring.

embeddings = HuggingFaceEmbeddings(
    model_name="BAAI/bge-small-en-v1.5"
)

# ==========================================
# Load FAISS database
# ==========================================

vectorstore = FAISS.load_local(
    VECTORSTORE_PATH,
    embeddings,
    allow_dangerous_deserialization=True
)
print("\n--- PLACEMENT DATA CHECK ---")

for doc in vectorstore.docstore._dict.values():
    content = doc.page_content.lower()

    if any(term in content for term in [
        "tcs - digital",
        "tcs - ninja",
        "total offers",
        "placement statistics",
        "students placed",
    ]):
        print("\nSOURCE:", doc.metadata)
        print(doc.page_content[:1200])
        print("-" * 50)

# ==========================================
# Create retriever
# ==========================================
# bge-small-en-v1.5 ranks correct chunks far higher than the previous
# all-MiniLM-L6-v2 (e.g. a principal lookup went from rank ~12 to rank 0),
# so k can stay modest. Keeping k small also matters for a completely
# separate reason: this Groq account has both an 8000-tokens-per-minute
# rate limit (prompt + max_tokens counted together) and a 200,000-
# tokens-per-day hard cap ("on_demand" free tier) — hit mid-development
# after repeated recrawls/rebuilds and manual testing. A larger k inflates
# the prompt side of every single request against both budgets.

retriever = vectorstore.as_retriever(
    search_kwargs={"k": 8}
)

# A handful of facts on this site are real but structurally hard for
# similarity search to surface no matter the embedding model or k — see
# ingest.py's synthesis functions for why each one exists (department
# directory, contact/office-hours, admissions, courses, HODs/deans,
# hostel administration). Bypassing retrieval ranking for them is cheap
# when it's one or two of them, but blanket-including all five (11 chunks,
# most of a reasoning model's context) on every single query — even ones
# they're irrelevant to — was itself pushing that context large enough to
# reliably exhaust the completion budget on reasoning before any answer
# text got written (a "name all of them" query with no real referent hit
# this: finish_reason "length", empty content, despite raising max_tokens
# already once for a similar problem — see git history). So: the two
# cheapest, most generally useful ones (departments, contact) stay always
# included; the larger, more specific ones only load when the question
# actually mentions that topic, via simple keyword gating rather than
# embedding similarity — the same reasoning as the rest of this file's
# retrieval choices: for a handful of known, high-value topics, a keyword
# check is more reliable than hoping the embedding ranks it well.
_ALWAYS_INCLUDE_MARKERS = ("departments directory", "contact info summary")
_GATED_AUGMENT_GROUPS = [
    (("hostel (administration summary)",), ("hostel", "warden", "adam", "eve")),
    (("admission process",), ("admission", "eligib", "apply", "entrance", "counsel")),
    (("programmes offered",), ("course", "programme", "program", "btech", "b.tech", "mtech", "m.tech", "degree")),
    (("/deans-and-heads",), ("hod", "dean", "head of department", "head of the department")),
    (("cse placement summary", "cse recruiters"), ("placement", "placed", "recruit", "offer", "salary", "package", "lpa", "company", "companies", "recruiter", "hired", "job")),
    (("cse department labs and facilities",), ("lab", "labs", "facility", "facilities", "turing", "grace hopper", "neumann", "codd", "foss", "singularity", "project lab")),
]


def _docs_matching(markers):
    return [
        doc.page_content
        for doc in vectorstore.docstore._dict.values()
        if any(marker in doc.metadata.get("source", "") for marker in markers)
    ]


ALWAYS_INCLUDE_DOCUMENTS = _docs_matching(_ALWAYS_INCLUDE_MARKERS)
GATED_AUGMENT_GROUPS = [(triggers, _docs_matching(markers)) for markers, triggers in _GATED_AUGMENT_GROUPS]


def augment_documents_for(question):
    question_lower = question.lower()
    chunks = list(ALWAYS_INCLUDE_DOCUMENTS)

    for triggers, docs in GATED_AUGMENT_GROUPS:
        if any(trigger in question_lower for trigger in triggers):
            chunks.extend(docs)

    return chunks

# ==========================================
# LLM
# ==========================================
# openai/gpt-oss-20b (the earlier model here) is a *reasoning* model: it
# spends completion tokens on hidden chain-of-thought before writing the
# actual answer, and that reasoning length scales with context size and
# question difficulty rather than being bounded — even at
# reasoning_effort="medium" (tuned down from the default "high" after it
# spent its *entire* budget on reasoning and returned "" with
# finish_reason "length"), a query with a larger context or a more
# ambiguous phrasing could still occasionally exhaust max_tokens on
# reasoning alone and return nothing.
#
# This task — answer strictly from retrieved context, no multi-step
# problem solving — doesn't need hidden chain-of-thought at all. Swapping
# to qwen/qwen3.8-27b (a direct-answer instruct model, no reasoning
# tokens) removed that entire failure mode and used a small, predictable
# 20-200 completion tokens across every benchmark question tried,
# instead of the reasoning model's 100-2000+. It was also markedly more
# consistent across paraphrases of the same question in testing — e.g.
# "who is the principal" / "who heads the college" / "principal of
# MITS?" all correctly named the same person, same facts every time —
# which the reasoning model's answer quality varied more on when its
# hidden reasoning happened to go down a different path per phrasing.
# temperature=0 on top of that makes a given (question, context) pair
# deterministic.
#
# max_tokens=900: this model tier also enforces a separate 1000
# output-tokens-per-minute cap (distinct from the prompt+completion
# per-minute/per-day caps noted elsewhere) — Groq counts the *reserved*
# max_tokens against it, not actual usage, so max_tokens=1500 alone
# already exceeded it and failed every request with a 429, independent
# of how much the model actually needed to write. 900 stays under that
# cap with margin while still comfortably covering the 20-200 tokens
# any real answer here has needed.

llm = ChatGroq(
    model="qwen/qwen3.8-27b",
    temperature=0,
    max_tokens=900,
)

# ==========================================
# Ask question
# ==========================================
# `history` is the recent question/answer turns from the caller's
# ConversationContext (main.py), not anything this module tracks itself —
# ask_question is otherwise stateless and only ever saw the current
# question in isolation. That broke plain conversational follow-ups like
# "name all of them" right after "list all of the departments": there is
# no single named entity for resolve_followup (in context.py) to have
# filled in — "them" refers to a list the previous *answer* gave, which
# only the RAG's own context can supply.

def format_history(history):
    if not history:
        return ""

    lines = []
    for turn in history:
        lines.append(f"User: {turn['question']}")
        lines.append(f"Assistant: {turn['answer']}")

    return "\n".join(lines)



def get_conversational_response(question):
    message = re.sub(r"[^\w\s']", " ", question.lower())
    message = " ".join(message.split())

    responses = {
        # Greetings
        "hi": "Hello! I'm NAVIKA, your MITS assistant. How can I help you today?",
        "hello": "Hello! I'm NAVIKA, your MITS assistant. What would you like to know about MITS?",
        "hey": "Hey! Welcome to NAVIKA. How can I help you with MITS?",
        "good morning": "Good morning! Welcome to NAVIKA. How can I help you today?",
        "good afternoon": "Good afternoon! How can I help you today?",
        "good evening": "Good evening! Welcome to NAVIKA. What would you like to know about MITS?",

        # Acknowledgements
        "ok": "Alright! If you'd like to know anything else about MITS, feel free to ask.",
        "okay": "Alright! If you'd like to know anything else about MITS, feel free to ask.",
        "alright": "Alright! Let me know if there's anything else I can help you with.",
        "got it": "Great! Feel free to ask if you need any more information.",

        # Gratitude
        "thanks": "You're welcome! Feel free to ask if you need any more information about MITS.",
        "thank you": "You're very welcome! Is there anything else you'd like to know about MITS?",
        "thanks a lot": "You're welcome! I'm happy to help.",

        # Conversation endings
        "bye": "Goodbye! Have a wonderful day. I'm here whenever you need information about MITS.",
        "goodbye": "Goodbye! Have a great day.",
        "see you": "See you! Feel free to return whenever you need help with MITS.",
        "that's all": "Alright! Thank you for using NAVIKA. Have a great day.",
        "thats all": "Alright! Thank you for using NAVIKA. Have a great day.",
    }

    return responses.get(message)


def ask_question(question, history=None):
    conversational_reply = get_conversational_response(question)

    if conversational_reply:
        return conversational_reply
       # Prepare the query, including the previous answer
    # so follow-up references can retrieve relevant documents.
    retrieval_query = question

    if history:
        previous_turn = history[-1]

        previous_question = previous_turn.get("question", "")
        previous_answer = previous_turn.get("answer", "")

        retrieval_query = (
            f"{previous_question}\n"
            f"{previous_answer}\n"
            f"Current question: {question}"
        )
    # 1. Retrieve semantically relevant documents.
    documents = retriever.invoke(retrieval_query)

    # 2. Find additional documents using lexical matching.
    stopwords = {
        "what", "who", "where", "when", "which", "how",
        "are", "is", "was", "were", "the", "a", "an",
        "of", "in", "on", "at", "to", "for", "from",
        "and", "or", "does", "do", "did", "there",
        "their", "with", "about", "tell", "me", "please"
    }

    query_terms = {
        word.lower()
        for word in re.findall(r"[a-zA-Z]+", retrieval_query)
        if len(word) > 2 and word.lower() not in stopwords
    }

    lexical_matches = []

    if query_terms:
        for doc in vectorstore.docstore._dict.values():
            content = doc.page_content.lower()

            matched_terms = sum(
                1 for term in query_terms if term in content
            )

            if matched_terms >= 2:
                lexical_matches.append((matched_terms, doc))

    # Add up to three lexical matches without duplicating documents.
    lexical_matches.sort(key=lambda item: item[0], reverse=True)
    existing_content = {doc.page_content for doc in documents}

    for _, doc in lexical_matches[:3]:
        if doc.page_content not in existing_content:
            documents.append(doc)
            existing_content.add(doc.page_content)

    # 3. Add relevant predefined college information.
    chunks = [doc.page_content for doc in documents]

    for text in augment_documents_for(retrieval_query):
        if text not in chunks:
            chunks.append(text)

    spatial_context = spatial_context_for_question(retrieval_query)
    if spatial_context:
        chunks.append(f"Structured DXF spatial lookup (candidate/unreviewed data):\n{spatial_context}")

    context = "\n\n".join(chunks)

    # 4. Include conversation history for follow-up questions.
    history_text = format_history(history)
    history_block = (
        f"Conversation so far:\n{history_text}\n\n"
        if history_text else ""
    )

    # 5. Generate an answer grounded in the retrieved context.
    prompt = f"""
You are a helpful campus information assistant.

{history_block}Answer the user's current question using only the
information in the context below. Use conversation history only
to understand references in the current question, not as a source
of factual information.

If the answer cannot be found in the context,
say:

"I couldn't find that information on the college website."

Do not invent facts or unsupported details.

Context:
{context}

Current question:
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

    history = []

    while True:

        question = input("You: ")

        if question.lower() == "exit":
            print("Goodbye!")
            break

        answer = ask_question(question, history=history)

        print("\nAssistant:", answer)
        print()

        history.append({"question": question, "answer": answer})
        history = history[-2:]
