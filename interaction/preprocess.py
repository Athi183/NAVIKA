import re
import unicodedata


# ==========================================
# Query preprocessing
# ==========================================
# Cleans up raw STT / typed text before intent and entity extraction.

CONTRACTIONS = {
    "where's": "where is",
    "what's": "what is",
    "how's": "how is",
    "who's": "who is",
    "i'm": "i am",
    "don't": "do not",
    "can't": "cannot",
    "isn't": "is not",
    "it's": "it is",
}

FILLER_WORDS = {"um", "uh", "like", "actually", "please", "kindly"}

# Malayalam occupies one distinct Unicode block (U+0D00-U+0D7F), unlike
# English's Latin script -- this makes script-based language detection
# fully reliable with no ML model or library dependency: if the text
# contains any character in this range, treat the whole query as
# Malayalam (including code-mixed Malayalam+English) for the purposes of
# which language to answer and speak the response in.
# Built from explicit codepoints via chr(), not a \uXXXX regex escape --
# some editors/tools render or transcode that escape as the literal
# character instead of keeping it as text, which is impossible to
# visually verify is still correct; chr(0x0D00) is unambiguous no matter
# how it displays.
_MALAYALAM_PATTERN = re.compile(f"[{chr(0x0D00)}-{chr(0x0D7F)}]")


def detect_language(raw_text):
    """Returns "ml" (Malayalam) or "en" (English), by Unicode script."""

    if raw_text and _MALAYALAM_PATTERN.search(raw_text):
        return "ml"
    return "en"


def expand_contractions(text):
    for contraction, expansion in CONTRACTIONS.items():
        text = re.sub(rf"\b{contraction}\b", expansion, text)
    return text


def remove_fillers(text):
    words = text.split()
    cleaned = [w for w in words if w not in FILLER_WORDS]
    return " ".join(cleaned)


def _strip_punctuation_preserving_marks(text):
    """
    Keeps Unicode letters (category L*), combining marks (category M*),
    and digits (category N*); replaces everything else (punctuation,
    symbols, control characters) with a space.

    Not the same as Python's \\w, despite \\w also being "Unicode-aware":
    \\w matches L* and N* (and underscore) but NOT M* -- and Malayalam
    words are built from base letters PLUS combining vowel signs and a
    virama mark, which are category Mc/Mn, not L. re.sub(r"[^\\w\\s]", " ",
    text) silently strips those marks out, e.g. "ലൈബ്രറി" (library)
    becomes "ല ബ രറ" -- the base consonants survive but the word is
    destroyed, which then makes NLU's LLM classifier misread or fail to
    classify the query entirely. This was found by testing real Malayalam
    questions through nlu.py end-to-end, not by inspecting this file in
    isolation -- the previous \\w-based version looked correct (it does
    fix the earlier, cruder bug of deleting Malayalam text entirely) but
    was never verified against an actual multi-character Malayalam word.
    """

    return "".join(
        ch if ch.isspace() or unicodedata.category(ch)[0] in "LMN" else " "
        for ch in text
    )


def clean_text(raw_text):
    """
    Normalizes raw input text: lowercase, expand contractions,
    strip punctuation noise, remove filler words, collapse whitespace.

    lower() is a safe no-op on Malayalam, which has no case.
    """

    if not raw_text:
        return ""

    text = raw_text.lower().strip()
    text = expand_contractions(text)
    text = _strip_punctuation_preserving_marks(text)
    text = remove_fillers(text)
    text = re.sub(r"\s+", " ", text).strip()

    return text
