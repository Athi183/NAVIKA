import json
import difflib
import os


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
    "admission": "Admission Office",
    "principal": "Principal Office",
    "vice principal": "Vice Principal Office",
}


# ==========================================
# Intent rules
# ==========================================
# Keyword-based intent classification. Simple and explainable —
# good enough for a fixed set of kiosk intents. Can be swapped for
# a trained classifier later without changing the output format.

INTENT_KEYWORDS = {
    "find_location": ["where", "location", "find", "locate", "which floor", "which block"],
    "get_directions": ["how do i get", "how do i reach", "how to reach", "how do you reach", "directions to", "way to", "route to"],
    "get_timing": ["timing", "open", "close", "hours", "when is"],
    "get_contact": ["contact", "phone number", "email address"],
    "greeting": ["hello", "hi", "hey", "good morning", "good afternoon"],
    "goodbye": ["bye", "goodbye", "thank you", "thanks"],
    "help": ["help", "what can you do", "options"],
}


def classify_intent(clean_text):
    """
    Returns the best-matching intent for the cleaned query text,
    along with a rough confidence score based on keyword overlap.
    Falls back to 'unknown' when nothing matches.
    """

    best_intent = "unknown"
    best_score = 0

    for intent, keywords in INTENT_KEYWORDS.items():
        for keyword in keywords:
            if keyword in clean_text:
                score = len(keyword.split())
                if score > best_score:
                    best_score = score
                    best_intent = intent

    confidence = min(1.0, 0.5 + 0.15 * best_score) if best_intent != "unknown" else 0.0

    return best_intent, confidence


def extract_entities(clean_text, cutoff=0.75):
    """
    Matches known campus locations/facilities/departments inside the
    query text. Uses substring matching first (fast, exact) and falls
    back to fuzzy matching (handles STT typos like "libary" -> "library").
    Returns a list of matched entity names (original casing).
    """

    matches = []

    # alias match first (short forms like "AI and DS", "CSE") — checked
    # before the full gazetteer so short forms aren't shadowed by an
    # unrelated substring match elsewhere in the text
    for alias, canonical in ENTITY_ALIASES.items():
        if alias in clean_text and canonical not in matches:
            matches.append(canonical)

    if matches:
        return matches

    # exact / substring match
    for entity, entity_lower in zip(ALL_KNOWN_ENTITIES, ALL_KNOWN_ENTITIES_LOWER):
        if entity_lower in clean_text:
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


def understand_query(clean_text):
    """
    Runs intent classification + entity extraction and returns a
    single structured result.
    """

    intent, confidence = classify_intent(clean_text)
    entities = extract_entities(clean_text)

    return {
        "intent": intent,
        "confidence": round(confidence, 2),
        "entities": entities,
    }
