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


# Must be set before HuggingFaceEmbeddings loads the tokenizer — the
# STT/NLU pipeline that calls into this module runs it after already
# using tokenizers elsewhere in the process, which otherwise prints a
# fork-safety warning on every single query.
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

load_dotenv()

# Malayalam occupies one distinct Unicode block (U+0D00-U+0D7F), so
# script-based detection is fully reliable with no language-ID model.
# Duplicated from interaction/preprocess.py's identical check rather than
# imported — this module is designed to run standalone (see the __main__
# chat loop below) without depending on interaction/ being on sys.path.
# Built from explicit codepoints via chr(), not a \uXXXX regex escape --
# some editors/tools render or transcode that escape as the literal
# character instead of keeping it as text, which is impossible to
# visually verify is still correct; chr(0x0D00) is unambiguous no matter
# how it displays.
_MALAYALAM_PATTERN = re.compile(f"[{chr(0x0D00)}-{chr(0x0D7F)}]")


def detect_language(text):
    """Returns "ml" (Malayalam) or "en", by Unicode script."""
    if text and _MALAYALAM_PATTERN.search(text):
        return "ml"
    return "en"

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

# The placement page (mgmits.ac.in/placement) has one self-contained
# section per batch (2022-2026, 2019-2023, 2018-2022, ...): a
# "Recruiter Wise Analysis <range> Batch" header, optionally a
# "(Highest Package: X LPA)" line (only published for 2 of the 5 batches
# on the live site -- the others genuinely don't have one, not a scraping
# gap), the recruiter-wise table, and a "Total Offers | N" line closing
# that batch's section before the next one starts.
#
# Naive per-CHUNK filtering (does this 800-char chunk contain the digits
# "2026"?) was unreliable two different ways: chunking can split a
# batch's own "Total Offers" line into a different chunk than its table,
# and on a wider top-k retrieval pass, entirely unrelated per-DEPARTMENT
# placement blurbs (e.g. mgmits.ac.in/department/ca's own "Students
# Placed: 43, Median Salary: 7" -- a different dataset for the MCA
# department specifically, not tied to any batch range) kept getting
# pulled in alongside a batch query and blended into one answer as if
# they described the same thing. Reconstructing the full page text and
# regex-matching "header ... until the next header" per batch fixes the
# first problem structurally; the explicit instruction in ask_question's
# prompt (see CONVERSATIONAL_INTENTS block below) about not mixing
# figures across sources covers the second, since retrieval can still
# independently surface a department chunk this function doesn't control.
_PLACEMENT_TRIGGERS = ("placement", "placed", "recruiter", "stipend", "ctc", "lpa", "batch", "offer")
# Must be the exact canonical placement page, not a substring/prefix match.
# A later, much broader crawl added several other pages whose URL starts
# with "/placement" (placement-statistics-of-cse, placement-test, ...) --
# with the old substring check, those got joined into the SAME full-text
# blob this regex walks. The last batch's section has no following header
# to stop at (it falls through to end-of-text, \Z, by design -- there's
# nothing after the oldest batch), so once other pages' unrelated content
# was appended after it, that "last section" silently grew to include all
# of it: 325,567 characters in one context chunk, which blew Groq's
# context-length limit outright (400 context_length_exceeded) on every
# batch-placement question. Restricting to the exact page URL is the
# correct fix; the length guard below is a second, independent safety net
# so this class of bug can't silently reintroduce a multi-hundred-KB
# chunk even if the source set changes again later.
_PLACEMENT_SOURCE_URLS = ("https://mgmits.ac.in/placement", "https://www.mgmits.ac.in/placement")
_PLACEMENT_MAX_SECTION_CHARS = 8000
_YEAR_PATTERN = re.compile(r"\b(?:19|20)\d{2}\b")  # non-capturing group so findall returns the full year
_BATCH_SECTION_PATTERN = re.compile(
    r"Recruiter Wise Analysis ([\d]{4}-[\d]{4}) Batch.*?(?=Recruiter Wise Analysis [\d]{4}-[\d]{4} Batch|\Z)",
    re.DOTALL,
)

PLACEMENT_DOCUMENTS = [
    doc.page_content
    for doc in vectorstore.docstore._dict.values()
    if doc.metadata.get("source", "") in _PLACEMENT_SOURCE_URLS
]
_PLACEMENT_FULL_TEXT = "\n".join(PLACEMENT_DOCUMENTS)
PLACEMENT_BATCH_SECTIONS = {
    match.group(1): match.group(0).strip()[:_PLACEMENT_MAX_SECTION_CHARS]
    for match in _BATCH_SECTION_PATTERN.finditer(_PLACEMENT_FULL_TEXT)
}


def _placement_docs_for(question_lower):
    if not any(trigger in question_lower for trigger in _PLACEMENT_TRIGGERS):
        return []

    years_in_question = _YEAR_PATTERN.findall(question_lower)

    if not years_in_question:
        # No specific year named ("placement stats" in general) -- a
        # handful of chunks is a reasonable size; let normal retrieval
        # ranking supply whichever table it finds most relevant rather
        # than including every batch's table unfiltered.
        return []

    matched_sections = []
    for batch_range, section_text in PLACEMENT_BATCH_SECTIONS.items():
        if any(year in batch_range for year in years_in_question):
            matched_sections.append(section_text)

    return matched_sections


# A faculty member's name is the sharpest case of the "structurally hard
# for similarity search" problem noted above for HODs/deans: it's one
# entry among 50-100+ in a flat "Name | Designation | Research interests |
# view profile" department staff-listing page, with almost no other
# distinguishing text nearby -- confirmed directly against this
# vectorstore (vectorstore.similarity_search("who is doctor Indu MT", k=5)
# never surfaces the cs-staff chunk that contains her, even though that
# chunk is in the index). Unlike admissions/hostel/deans there's no fixed
# keyword list to gate on here -- the "topic" is whichever person the
# question names, which is unbounded, so this matches chunk *text*
# directly instead of chunk *topic*: after stripping the campus-boilerplate
# words a lookup question is typically phrased with ("who is assistant
# professor ... in the computer science department"), what's left over is
# almost always the actual name fragments the person typed or said, and a
# plain case-insensitive substring search for those across every staff/
# faculty-pattern page finds them reliably where embedding similarity
# alone does not.
_FACULTY_SOURCE_MARKERS = ("staff", "faculty", "deans-and-heads", "profile-details")
_PERSON_LOOKUP_TRIGGERS = (
    "who is", "who's", "whos", "tell me about", "contact of", "email of",
    "professor", "faculty", "staff", "hod", "lecturer",
)
_PERSON_LOOKUP_STOPWORDS = {
    "who", "is", "are", "was", "the", "a", "an", "in", "of", "at", "for", "about",
    "me", "tell", "you", "know", "whos", "please", "can",
    "dr", "doctor", "prof", "professor", "mr", "mrs", "ms", "sir", "madam",
    "name", "teacher", "faculty", "staff", "assistant", "associate", "lecturer",
    "department", "dept", "hod", "head", "college", "mits",
    "cse", "computer", "science", "engineering", "ece", "eee", "ee", "ec",
    "mechanical", "civil", "cyber", "security", "ai", "ds", "data",
    "applications", "mca", "basic", "humanities", "ca", "cc", "ad", "bsh",
}

FACULTY_DOCUMENTS = _docs_matching(_FACULTY_SOURCE_MARKERS)
_FACULTY_FULL_TEXT = "\n".join(FACULTY_DOCUMENTS)


def _person_lookup_tokens(question_lower):
    words = re.findall(r"[a-z]+", question_lower)
    # len > 2 deliberately excludes 2-letter fragments like name initials
    # ("mt") -- those are common enough as substrings of unrelated words
    # (e.g. "mt" inside "comment") to flood the snippet search with false
    # positives, whereas a first name alone (4+ letters, as nearly every
    # real one here is) is specific enough to find the right person on
    # its own without needing the initials too.
    return [w for w in words if w not in _PERSON_LOOKUP_STOPWORDS and len(w) > 2]


def _faculty_snippets_for(question_lower):
    if not any(trigger in question_lower for trigger in _PERSON_LOOKUP_TRIGGERS):
        return []

    tokens = _person_lookup_tokens(question_lower)
    if not tokens:
        return []

    snippets = []
    seen_spans = []
    for token in tokens:
        for match in re.finditer(re.escape(token), _FACULTY_FULL_TEXT, re.IGNORECASE):
            start = max(0, match.start() - 250)
            end = min(len(_FACULTY_FULL_TEXT), match.end() + 250)
            if any(start < e and s < end for s, e in seen_spans):
                continue
            seen_spans.append((start, end))
            snippets.append(_FACULTY_FULL_TEXT[start:end])
            if len(snippets) >= 4:
                return snippets

    return snippets


def augment_documents_for(question):
    question_lower = question.lower()
    chunks = list(ALWAYS_INCLUDE_DOCUMENTS)

    for triggers, docs in GATED_AUGMENT_GROUPS:
        if any(trigger in question_lower for trigger in triggers):
            chunks.extend(docs)

    chunks.extend(_placement_docs_for(question_lower))
    chunks.extend(_faculty_snippets_for(question_lower))

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


def translate_to_english(malayalam_text):
    """
    Used only for the RETRIEVAL step of a Malayalam question. The
    embedding model (bge-small-en-v1.5) and the entire crawled corpus are
    English-only — monolingual embedding models aren't trained to place
    semantically equivalent text in different scripts near each other in
    vector space, so embedding a Malayalam query directly against English
    chunks would retrieve badly. Translating just for retrieval, while
    keeping the original Malayalam text in the generation prompt below,
    gets both good retrieval AND an answer in the question's own language.
    Raises on failure — the caller falls back to retrieving on the
    untranslated text rather than failing the whole question.
    """

    prompt = (
        "Translate the following Malayalam text to English. "
        "Respond with ONLY the translation, no other text.\n\n"
        f"{malayalam_text}"
    )
    response = llm.invoke(prompt)
    return response.content.strip()


# Intents that need a short, friendly reply, not a document-grounded
# answer — retrieval has nothing relevant to offer them anyway, and
# forcing one through the normal path actively breaks them: the history-
# blended retrieval query below (needed for genuine follow-ups like "name
# all of them") pulls in whatever the PREVIOUS question was about, so
# "hello" right after "where is the library" retrieves library chunks,
# and the LLM then correctly-but-uselessly decides "hello" isn't answered
# by that context and falls back to "I couldn't find that information" —
# verified by reproducing this exact case before writing this fix.
CONVERSATIONAL_INTENTS = {
    "greeting": "The user is greeting you. Reply with a short, friendly greeting, and invite them to ask a question about the college.",
    "goodbye": "The user is ending the conversation. Reply with a short, friendly goodbye.",
    "help": "The user is asking what you can help with. Briefly explain that you can answer questions about campus locations, timings, contact info, departments, and general college information.",
}


def ask_question(question, history=None, intent=None):

    language = detect_language(question)

    # No retrieval, no history, no document context at all for these --
    # see CONVERSATIONAL_INTENTS above for why that's required, not just
    # an optimization.
    if intent in CONVERSATIONAL_INTENTS:
        language_instruction = (
            "Respond entirely in Malayalam.\n\n" if language == "ml" else ""
        )
        prompt = f"""
You are a helpful college information assistant.

{language_instruction}{CONVERSATIONAL_INTENTS[intent]}

Current message:
{question}

Response:
"""
        response = llm.invoke(prompt)
        return response.content

    # The current question alone can be too thin to retrieve well when
    # it's a follow-up ("name all of them" carries no lexical signal
    # about departments on its own) — folding in the previous question's
    # text gives the retriever and the keyword-based augment gating
    # something to actually match against, without the cost of a separate
    # LLM call to rewrite the question. For Malayalam, retrieval runs on
    # a translated copy of the current question specifically (see
    # translate_to_english); a Malayalam previous-question folded in
    # unstranslated would dilute that signal, so history is only blended
    # in for the English case — a known gap for Malayalam follow-ups.
    if language == "ml":
        try:
            retrieval_query = translate_to_english(question)
        except Exception:
            retrieval_query = question
    else:
        retrieval_query = question
        if history:
            retrieval_query = f"{history[-1]['question']} {question}"

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
    language_instruction = (
        "The Current Question is in Malayalam. Write your entire answer in "
        "Malayalam too, translating the relevant facts from the (English) "
        "context below — do not answer in English and do not mix languages.\n\n"
        if language == "ml" else ""
    )

    # Placement answers were going straight into the recruiter-wise table
    # with no lead-in, which buries the handful of numbers someone
    # actually skims for first (how good was this batch's placement,
    # roughly, before they care which specific companies came). Only
    # applies when placement is actually the topic, same trigger check
    # _placement_docs_for uses, so this doesn't add irrelevant structure
    # to answers about anything else.
    placement_instruction = (
        "This is a placement-statistics question. The context may contain "
        "TWO DIFFERENT kinds of placement data that must never be mixed "
        "together: (1) college-wide recruiter-wise tables for a specific "
        "graduating batch (e.g. \"Recruiter Wise Analysis 2022-2026 "
        "Batch\"), each with its own Total Offers and sometimes a Highest "
        "Package figure, and (2) a single department's own overall "
        "placement figures (Students Placed, Offers Received, Median "
        "Salary, Companies Associated), which belong to that department "
        "only and are NOT about any specific graduating batch. If the "
        "question asks about a batch/graduating year, answer ONLY from "
        "that batch's own college-wide section — do not state a "
        "department's separate Students Placed/Median Salary/Companies "
        "Associated figures as if they were that batch's figures.\n\n"
        "Before any detailed recruiter-wise table, start with a short "
        "summary line covering whichever of these are actually present "
        "for the specific thing asked about: highest package/offer, "
        "median salary, average salary, and total offers/students "
        "placed. Only state a figure that is actually present in the "
        "context — omit any of these from the summary rather than "
        "estimating or inferring one that isn't given.\n\n"
        if any(trigger in question.lower() for trigger in _PLACEMENT_TRIGGERS) else ""
    )

    # 5. Generate an answer grounded in the retrieved context.
    prompt = f"""
You are a helpful campus information assistant.

{history_block}{language_instruction}{placement_instruction}Answer the user's CURRENT question ONLY using the information
provided in the context below. If the current question refers back to the
conversation above (words like "them", "it", "there", "those", "the
second one"), use the conversation to work out what is actually being
asked — but still answer strictly from the context, never from the
conversation history itself.

Answer spatial questions only from the retrieved or structured spatial context. Preserve any candidate or unreviewed status and never convert a label anchor or candidate connector into a verified room entrance or route.

Student batches in the context are labeled by their full admission-to-
graduation span, e.g. "2022-2026 Batch" for students who were admitted in
2022 and graduated in 2026. When the question names only a single year
for a batch or graduating class (e.g. "the 2026 batch", "2026 batch
placement stats", "students who graduated in 2026"), treat that year as
the GRADUATION year and match it to the span in the context whose second
year is the same — do not treat this as ambiguous or ask the user to
clarify, since this is the standard way batches are referred to in
everyday conversation, not a guess.

If the answer cannot be found in the context, say so — in the same
language as the Current Question — instead of guessing. In English that's:
"I couldn't find that information in the available campus data."

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
