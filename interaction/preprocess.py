import re


# ==========================================
# Query preprocessing
# ==========================================
# Cleans up raw STT / typed text before intent and entity extraction.

CONTRACTIONS = {
    "where's": "where is",
    "what's": "what is",
    "how's": "how is",
    "i'm": "i am",
    "don't": "do not",
    "can't": "cannot",
    "isn't": "is not",
    "it's": "it is",
}

FILLER_WORDS = {"um", "uh", "like", "actually", "please", "kindly"}


def expand_contractions(text):
    for contraction, expansion in CONTRACTIONS.items():
        text = re.sub(rf"\b{contraction}\b", expansion, text)
    return text


def remove_fillers(text):
    words = text.split()
    cleaned = [w for w in words if w not in FILLER_WORDS]
    return " ".join(cleaned)


def clean_text(raw_text):
    """
    Normalizes raw input text: lowercase, expand contractions,
    strip punctuation noise, remove filler words, collapse whitespace.
    """

    if not raw_text:
        return ""

    text = raw_text.lower().strip()
    text = expand_contractions(text)
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = remove_fillers(text)
    text = re.sub(r"\s+", " ", text).strip()

    return text
