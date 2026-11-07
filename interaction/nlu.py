import json
import difflib
import os
import re

from dotenv import load_dotenv
from langchain_groq import ChatGroq

# Shares the GROQ_API_KEY already configured for the RAG module (Member
# 2's) rather than duplicating the secret in a second .env file — both
# are the same college project's key, and load_dotenv() run from this
# directory wouldn't otherwise find one two folders over.
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "rag", ".env"))


# ==========================================
# Load campus entity gazetteer
# ==========================================

ENTITIES_PATH = os.path.join(os.path.dirname(__file__), "campus_entities.json")

with open(ENTITIES_PATH, "r") as f:
    ENTITY_DATA = json.load(f)

ALL_KNOWN_ENTITIES = (
    ENTITY_DATA["buildings"]
    + ENTITY_DATA["facilities"]
    + ENTITY_DATA["departments"]
)
ALL_KNOWN_ENTITIES_LOWER = [e.lower() for e in ALL_KNOWN_ENTITIES]

# Short forms / abbreviations students actually say, mapped to the
# canonical gazetteer entity. Checked before the fuzzy fallback so
# "AI and DS" resolves correctly instead of falling through to a
# stale context entity.
ENTITY_ALIASES = {
    "ai and ds": "Artificial Intelligence and Data Science",
    "ai and data science": "Artificial Intelligence and Data Science",
    "aids department": "Artificial Intelligence and Data Science",
    "aids": "Artificial Intelligence and Data Science",
    "cse": "Computer Science Engineering",
    "computer science": "Computer Science Engineering",
    "ece": "Electronics and Communication Engineering",
    "electronics and communication": "Electronics and Communication Engineering",
    "eee": "Electrical and Electronics Engineering",
    "electrical and electronics": "Electrical and Electronics Engineering",
    "mech": "Mechanical Engineering",
    "mechanical": "Mechanical Engineering",
    "civil": "Civil Engineering",
    "mca": "MCA",
    "cyber security": "Cyber Security",
    "cyber": "Cyber Security",
    "library": "Main Library",
    "tagore library": "Main Library",
    "central library": "Main Library",
    "admission": "Admission Office",
    "principal": "Principal Office",
    "vice principal": "Vice Principal Office",

    "hostel": "Hostel",
    "adams house": "Hostel",
    "adam's house": "Hostel",
    "eves house": "Hostel",
    "eve's house": "Hostel",
    "mens hostel": "Hostel",
    "ladies hostel": "Hostel",

    "placement cell": "Placement Cell",
    "placement office": "Placement Cell",
    "career development center": "Placement Cell",
    "career development centre": "Placement Cell",
    "cdc": "Placement Cell",

    "sports complex": "Sports Complex",
    "sports ground": "Sports Complex",

    "auditorium": "Auditorium",
    "conference hall": "Conference Hall",

    "iedc": "IEDC",
    "innovation and entrepreneurship development cell": "IEDC",

    "nss": "NSS",
    "national service scheme": "NSS",

    "anti ragging committee": "Anti-Ragging Committee",
    "anti ragging": "Anti-Ragging Committee",

    "womens forum": "Women's Forum & Grievance Cell",
    "women's forum": "Women's Forum & Grievance Cell",

    "student grievance": "Student Grievance & Redressal Cell",
    "grievance redressal": "Student Grievance & Redressal Cell",
    "sgrc": "Student Grievance & Redressal Cell",

    "internal complaints committee": "Internal Complaints Committee",
    "icc": "Internal Complaints Committee",

    "iqac": "IQAC",
    "internal quality assurance cell": "IQAC",

    "examination cell": "Examination Cell",
    "exam cell": "Examination Cell",
    "controller of examinations": "Examination Cell",
    "coe": "Examination Cell",

    "research and consultancy cell": "Research and Consultancy Cell",
    "research cell": "Research and Consultancy Cell",
}


# ==========================================
# Intent rules
# ==========================================
# Keyword-based intent classification. Simple and explainable —
# good enough for a fixed set of kiosk intents. Can be swapped for
# a trained classifier later without changing the output format.

INTENT_KEYWORDS = {
    "find_location": [
        "where", "location", "find", "locate",
        "which floor", "which block", "which building", "which department",
    ],
    "get_directions": [
        "how do i get", "how do i reach", "how to reach", "how do you reach",
        "directions to", "way to", "way from", "route to", "route from",
        "navigate to", "go to", "take me to", "lead me to", "guide me to", "navigate me to", "bring me to",
    ],
    "get_timing": ["timing", "open", "close", "hours", "when is"],
    "get_contact": ["contact", "phone number", "email address"],
    "get_info": [
        "who is", "who are", "tell me about", "information about",
        "details about", "what does", "role of",
        "how many", "in total", "name all", "name the", "list all", "list the",
        "staff", "faculty", "workers",
        "eligibility", "criteria", "courses", "programmes", "programs",
        "admission process", "how to apply", "fee", "fees", "scholarship",
        "hostel", "warden",
    ],
    "greeting": ["hello", "hi", "hey", "good morning", "good afternoon"],
    "goodbye": ["bye", "goodbye", "thank you", "thanks"],
    "help": ["help", "what can you do", "options"],
}

# Cache compiled word-boundary patterns so repeated calls don't
# re-compile the same regex per query. The trailing "s?" tolerates
# simple inflection ("closes", "timings") without needing a full
# stemmer — clean_text already stripped punctuation, so this is safe.
_INTENT_PATTERNS = {
    intent: [(keyword, re.compile(rf"\b{re.escape(keyword)}s?\b")) for keyword in keywords]
    for intent, keywords in INTENT_KEYWORDS.items()
}


def classify_intent(clean_text):
    """
    Returns the best-matching intent for the cleaned query text,
    along with a rough confidence score based on keyword overlap.
    Falls back to 'unknown' when nothing matches.

    Matches on whole-word/phrase boundaries (not raw substrings) so a
    keyword like "hi" doesn't fire on a word like "which", or "close"
    on a word like "disclose".
    """

    best_intent = "unknown"
    best_score = 0

    for intent, patterns in _INTENT_PATTERNS.items():
        for keyword, pattern in patterns:
            if pattern.search(clean_text):
                score = len(keyword.split())
                if score > best_score:
                    best_score = score
                    best_intent = intent

    confidence = min(1.0, 0.5 + 0.15 * best_score) if best_intent != "unknown" else 0.0

    return best_intent, confidence


_ALIAS_PATTERNS = [
    (alias, canonical, re.compile(rf"\b{re.escape(alias)}\b"))
    for alias, canonical in ENTITY_ALIASES.items()
]
_ENTITY_PATTERNS = [
    (entity, re.compile(rf"\b{re.escape(entity_lower)}\b"))
    for entity, entity_lower in zip(ALL_KNOWN_ENTITIES, ALL_KNOWN_ENTITIES_LOWER)
]


def extract_entities(clean_text, cutoff=0.75):
    """
    Matches known campus locations/facilities/departments inside the
    query text. Uses substring matching first (fast, exact) and falls
    back to fuzzy matching (handles STT typos like "libary" -> "library").
    Returns a list of matched entity names (original casing).

    Both alias and full-gazetteer matches are collected together (not
    one-or-the-other) so a query naming one entity by its short form
    and another by its full name — e.g. "route from library to
    Ramanujan block" — returns both instead of only the alias hit.
    """

    matches = []

    # alias match (short forms like "AI and DS", "CSE") — checked before
    # the full gazetteer so short forms aren't shadowed, but on word
    # boundaries so e.g. "aids" doesn't fire inside an unrelated word
    for alias, canonical, pattern in _ALIAS_PATTERNS:
        if pattern.search(clean_text) and canonical not in matches:
            matches.append(canonical)

    # exact / whole-word match against the full gazetteer name
    for entity, pattern in _ENTITY_PATTERNS:
        if pattern.search(clean_text) and entity not in matches:
            matches.append(entity)

    if matches:
        return matches

    # fuzzy fallback — check each word/bigram against the gazetteer
    words = clean_text.split()
    candidates = words + [
        " ".join(words[i:i + 2]) for i in range(len(words) - 1)
    ]

    for candidate in candidates:
        close = difflib.get_close_matches(
            candidate, ALL_KNOWN_ENTITIES_LOWER, n=1, cutoff=cutoff
        )
        if close:
            idx = ALL_KNOWN_ENTITIES_LOWER.index(close[0])
            entity = ALL_KNOWN_ENTITIES[idx]
            if entity not in matches:
                matches.append(entity)

    return matches


# ==========================================
# LLM-based classification
# ==========================================
# The keyword matcher above is fast and free but brittle to phrasing —
# "any idea who runs the college" or "any clue where the students stay"
# match nothing, even though "who is the principal" and "where is the
# hostel" (the same questions, differently worded) match fine. An LLM
# call generalizes across phrasing the way keyword lists structurally
# can't. It's still constrained to the same fixed intent set and the
# same entity gazetteer (so downstream consumers of structured_query,
# e.g. Member 3's spatial resolution, see the same vocabulary either
# way) — this changes how a query gets classified, not what it can be
# classified as.

VALID_INTENTS = set(INTENT_KEYWORDS) | {"unknown"}

# Back on qwen/qwen3.8-27b as of 2026-11-06 -- see the matching comment
# in rag/app.py for the full story of the 2026-10-29 quota crisis that
# pushed this through gpt-oss-120b then gpt-oss-20b as successive last
# resorts. This call degrades gracefully on failure (falls back to
# keyword classification, English-only -- see extract_entities), which
# is exactly why leaving it on an exhausted/unreliable model hurts
# Malayalam specifically more than English: a failed or low-quality
# classification call silently lands Malayalam questions on an
# English-only fallback. Quota re-verified recovered with 3 consecutive
# real-sized calls before reverting.
_llm = ChatGroq(
    model="qwen/qwen3.8-27b",
    temperature=0,
    max_tokens=300,
    request_timeout=10,
)

_INTENT_DESCRIPTIONS = """- find_location: wants to know WHERE something is
- get_directions: wants navigation/route to a place
- get_timing: wants hours/timing of something
- get_contact: wants phone/email contact info
- get_info: wants general facts (who is X, list Y, how many Z, details about something)
- greeting: greeting the assistant
- goodbye: ending conversation / thanking
- help: asking what the assistant can do
- unknown: none of the above fit"""

_ENTITIES_BLOCK = "\n".join(f"- {e}" for e in ALL_KNOWN_ENTITIES)


def _extract_json_object(content):
    """Groq's direct-answer models normally return bare JSON, but strip
    a markdown code fence if one shows up anyway."""

    content = content.strip()
    fence_match = re.match(r"^```(?:json)?\s*(.*?)\s*```$", content, re.DOTALL)
    if fence_match:
        content = fence_match.group(1)

    return json.loads(content)


def classify_with_llm(clean_text):
    """
    Asks the LLM to classify intent and extract entities in one call.
    Raises on any failure (network/quota/malformed output) — the caller
    is responsible for falling back to the keyword-based classifier.
    """

    prompt = f"""Classify this campus-assistant query. Respond with ONLY a JSON object, no other text.

Valid intents:
{_INTENT_DESCRIPTIONS}

Known campus entities (use these EXACT names):
{_ENTITIES_BLOCK}

Match entities by MEANING, not just literal wording — a query can refer to
a known entity without naming it directly. For example "who is the head
of the college" or "who runs the college" both mean "Principal Office";
"where do students live" means "Hostel"; "who leads the CS branch" means
"Computer Science Engineering". Use an empty list only if the query
genuinely does not concern any entity on the list.

The query may be written in English or Malayalam — classify it and match
entities the same way regardless of which language it's in. Always
respond with the intent/entity names exactly as given above, in English,
even when the query itself is in Malayalam.

Query: "{clean_text}"

Respond as: {{"intent": "<one of the valid intents>", "entities": ["<exact entity name>", ...], "confidence": <0.0-1.0>}}
"""

    response = _llm.invoke(prompt)
    parsed = _extract_json_object(response.content)

    intent = parsed["intent"] if parsed.get("intent") in VALID_INTENTS else "unknown"

    entities = []
    for entity in parsed.get("entities") or []:
        if entity in ALL_KNOWN_ENTITIES and entity not in entities:
            entities.append(entity)

    confidence = float(parsed.get("confidence", 0.0))
    confidence = max(0.0, min(1.0, confidence))

    return {
        "intent": intent,
        "confidence": round(confidence, 2),
        "entities": entities,
    }


def understand_query(clean_text):
    """
    Runs intent classification + entity extraction and returns a
    single structured result. Tries the LLM classifier first for its
    much better handling of varied phrasing, and falls back to the
    keyword/gazetteer matcher above if the LLM call fails for any
    reason (offline, Groq quota exhausted, malformed response) — so a
    RAG/network outage degrades classification quality instead of
    breaking the pipeline entirely.
    """

    try:
        return classify_with_llm(clean_text)

    except Exception as error:
        print(f"[LLM classification unavailable, using keyword fallback: {error}]")
        intent, confidence = classify_intent(clean_text)
        entities = extract_entities(clean_text)

        return {
            "intent": intent,
            "confidence": round(confidence, 2),
            "entities": entities,
        }
