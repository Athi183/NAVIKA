import os

# Must be set before HuggingFaceEmbeddings loads the tokenizer — the
# STT/NLU pipeline that calls into this module runs it after already
# using tokenizers elsewhere in the process, which otherwise prints a
# fork-safety warning on every single query.
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

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


def ask_question(question, history=None):

    # The current question alone can be too thin to retrieve well when
    # it's a follow-up ("name all of them" carries no lexical signal
    # about departments on its own) — folding in the previous question's
    # text gives the retriever and the keyword-based augment gating
    # something to actually match against, without the cost of a separate
    # LLM call to rewrite the question.
    retrieval_query = question
    if history:
        retrieval_query = f"{history[-1]['question']} {question}"

    documents = retriever.invoke(retrieval_query)

    chunks = [document.page_content for document in documents]
    for augment_text in augment_documents_for(retrieval_query):
        if augment_text not in chunks:
            chunks.append(augment_text)

    context = "\n\n".join(chunks)
    history_text = format_history(history)
    history_block = (
        f"Conversation so far:\n{history_text}\n\n" if history_text else ""
    )

    prompt = f"""
You are a helpful college information assistant.

{history_block}Answer the user's CURRENT question ONLY using the information
provided in the context below. If the current question refers back to the
conversation above (words like "them", "it", "there", "those", "the
second one"), use the conversation to work out what is actually being
asked — but still answer strictly from the context, never from the
conversation history itself.

If the answer cannot be found in the context,
say:

"I couldn't find that information on the college website."

Do not make up information.

Context:
{context}

Current Question:
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