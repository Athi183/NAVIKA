import importlib.util
import os
import sys

from preprocess import clean_text, detect_language
from nlu import understand_query
from context import ConversationContext

# Resolved from this file's own location, not the process's working
# directory — "../rag" as a bare relative path only ever worked when a
# script happened to be launched from inside interaction/ (true for
# every manual `python3 main.py` run so far, but not for backend/app.py
# importing this module from a different CWD).
RAG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "rag")
RAG_APP_PATH = os.path.join(RAG_DIR, "app.py")


_rag_app_module = None  # cached after first successful load — see below


def _load_rag_app():
    """
    Loads rag/app.py directly by file path under a distinct internal
    module name, rather than `sys.path.append(rag_dir); from app import
    ...`. The bare-name approach broke the moment backend/app.py existed:
    when the server runs from backend/, that directory sits on sys.path
    ahead of rag/, so `from app import ask_question` silently resolved to
    the *Flask* app instead — "cannot import name 'ask_question' from
    'app'", pointing at backend/app.py. Loading by exact path sidesteps
    sys.path/cwd entirely, so this can't collide with any other app.py
    anywhere in the project regardless of who imports main.py or from
    where.

    RAG_DIR is still added to sys.path (just not relied on for finding
    app.py itself) because rag/app.py imports its OWN sibling modules by
    bare name (e.g. `from spatial_lookup import spatial_context_for_question`,
    a fallback for when the relative `from .spatial_lookup import ...`
    fails since this loading method gives the module no real package).
    Without rag/ on sys.path, both of those imports fail and this whole
    function raises ModuleNotFoundError on every call — which
    get_answer_from_rag's broad except then silently swallows into the
    generic "I couldn't reach the knowledge base yet" fallback, making
    every single real query look like a knowledge-base outage instead of
    the actual import error it is. Found by reproducing a live failure
    that direct testing (which happened to have rag/ on sys.path already,
    from an unrelated sys.path.append in the test script) had masked.

    Cached at module level after the first successful load: rag/app.py's
    top level builds the embedding model and loads the FAISS index
    (~30s), so re-running that on every single query — which naively
    reloading by path on every call would do — would make each answer
    take as long as a cold start.
    """

    global _rag_app_module

    if _rag_app_module is None:
        if RAG_DIR not in sys.path:
            sys.path.append(RAG_DIR)

        spec = importlib.util.spec_from_file_location("navika_rag_app", RAG_APP_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _rag_app_module = module

    return _rag_app_module


# ==========================================
# RAG handoff (Member 2)
# ==========================================

def get_answer_from_rag(structured_query, history=None):
    """
    Sends the structured query to Member 2's RAG module and returns
    the generated answer text. Falls back to a placeholder if the RAG
    module isn't wired up / importable yet.

    `history` (recent question/answer turns from ConversationContext) is
    passed through so the RAG can resolve references to what was just
    discussed — e.g. "name all of them" right after "list all of the
    departments". Without it, ask_question only ever sees this one
    question in isolation, no matter what resolve_followup figured out
    about the current turn: that only fills in a single named entity, but
    a lot of real follow-ups refer back to something the *answer* said
    (a list, a count) rather than a place resolve_followup would catch.

    `intent` (from nlu.py's classification) is also passed through so
    ask_question can skip retrieval entirely for greeting/goodbye/help --
    see rag/app.py's CONVERSATIONAL_INTENTS for why that's necessary, not
    optional: retrieval has nothing relevant to offer these, and feeding
    it anyway actively breaks them once history is present.
    """

    question = structured_query["clean_text"]
    intent = structured_query.get("intent")

    try:
        rag_app = _load_rag_app()
        return rag_app.ask_question(question, history=history, intent=intent)

    except Exception as error:
        print(f"[RAG unavailable: {error}]")
        entities = structured_query["entities"] or ["that"]
        return f"I couldn't reach the knowledge base yet, but I understood you're asking about {entities}."



# ==========================================
# Structured query builder
# ==========================================
# This is the handoff format for Member 2 (RAG) and Member 3
# (spatial resolution). Keep this shape stable — the other modules
# will build against it.

def build_structured_query(raw_text, understood_query):
    return {
        "raw_text": raw_text,
        "clean_text": understood_query.get("clean_text"),
        "intent": understood_query["intent"],
        "confidence": understood_query["confidence"],
        "entities": understood_query["entities"],
        "resolved_from_context": understood_query.get("resolved_from_context", False),
    }


# ==========================================
# Pipeline
# ==========================================

def process_query(raw_text, context):
    """
    Runs one full turn of the pipeline on a single piece of input text
    (already transcribed, or typed directly for testing).
    Returns the structured query ready to hand off downstream.
    """

    text = clean_text(raw_text)
    understood = understand_query(text)
    understood["clean_text"] = text
    understood = context.resolve_followup(understood)
    context.update(understood)

    return build_structured_query(raw_text, understood)


# ==========================================
# Live loop (mic input, for the actual kiosk)
# ==========================================
# Listens continuously via the microphone instead of typed input.
# listen_from_mic() returns None if nothing usable was captured
# (silence/timeout, or STT couldn't understand the audio) — that's
# handled as a normal, recoverable case, not an error.

EXIT_PHRASES = {"exit", "quit", "goodbye", "bye", "stop listening"}


def run_voice_loop(listen_lang=None):
    """
    Mic-in / speaker-out loop for the actual kiosk hardware.

    `listen_lang` ("en", "ml", or None) controls the mic's spoken
    language. None (the default) auto-detects per utterance via
    stt.detect_spoken_language (a local Whisper encoder pass) — a kiosk
    session can now mix English and Malayalam turn-to-turn with no
    language toggle at all. Passing --lang=en or --lang=ml instead pins
    the whole session to one language and skips detection entirely,
    which is more reliable for short utterances (Whisper's own
    detection confidence on a ~1.7s Malayalam clip measured well below
    its confidence on an equivalent English one in testing — see
    stt.detect_spoken_language's docstring).

    TTS output has never had this constraint either way: it's chosen
    per-turn by detecting the language of the RAG's own answer (which
    itself answers in whatever language the question was asked in — see
    rag/app.py).
    """

    from stt import listen_from_mic
    from tts import speak

    context = ConversationContext()

    mode = f"'{listen_lang}'" if listen_lang else "auto-detect"
    print(f"Listening ({mode})... (say 'exit' or press Ctrl+C to stop)\n")

    try:
        while True:
            raw_text = listen_from_mic(lang=listen_lang)

            if raw_text is None:
                print("[No speech detected or unrecognized — listening again]")
                continue

            print("You said:", raw_text)

            if raw_text.strip().lower() in EXIT_PHRASES:
                print("Goodbye!")
                speak("Goodbye!")
                break

            structured_query = process_query(raw_text, context)
            print("Structured query:", structured_query)

            response_text = get_answer_from_rag(structured_query, history=context.recent_exchanges())
            print("Assistant:", response_text)
            context.record_exchange(raw_text, response_text)

            speak(response_text, lang=detect_language(response_text))

    except KeyboardInterrupt:
        print("\nGoodbye!")


def run_text_loop():
    """
    Typed-input version of the same pipeline, with no mic/speaker
    dependency. Useful for developing and demoing the NLU/context
    logic on a machine without kiosk hardware — prints the structured
    query for every turn so intent/entity/context resolution is
    visible, not just the final answer.
    """

    context = ConversationContext()

    print("Text mode (type 'exit' to stop)\n")

    try:
        while True:
            raw_text = input("You: ")

            if not raw_text.strip():
                continue

            if raw_text.strip().lower() in EXIT_PHRASES:
                print("Goodbye!")
                break

            structured_query = process_query(raw_text, context)
            print("Structured query:", structured_query)

            response_text = get_answer_from_rag(structured_query, history=context.recent_exchanges())
            print("Assistant:", response_text)
            context.record_exchange(raw_text, response_text)
            print()

    except (KeyboardInterrupt, EOFError):
        print("\nGoodbye!")


def _parse_listen_lang(argv):
    """Returns "en"/"ml" if --lang=... was passed, else None (auto-detect)."""

    for arg in argv:
        if arg.startswith("--lang="):
            value = arg.split("=", 1)[1].strip().lower()
            if value in ("en", "ml"):
                return value
    return None


if __name__ == "__main__":
    if "--text" in sys.argv:
        run_text_loop()
    else:
        run_voice_loop(listen_lang=_parse_listen_lang(sys.argv))