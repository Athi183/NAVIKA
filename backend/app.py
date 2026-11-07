import importlib.util
import os
import sys
import uuid

from flask import Flask, Response, request, jsonify
from flask_cors import CORS

# interaction/ and rag/ are sibling directories, not installed packages —
# resolve their paths from this file's own location (not the process's
# CWD) so this works regardless of where the server is launched from.
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INTERACTION_DIR = os.path.join(BASE_DIR, "..", "interaction")
RAG_DIR = os.path.join(BASE_DIR, "..", "rag")
RAG_APP_FILE = os.path.join(BASE_DIR, "..", "rag", "app.py")
sys.path.append(INTERACTION_DIR)
sys.path.append(RAG_DIR)

from context import ConversationContext  # noqa: E402
import main as interaction_main  # noqa: E402
import tts as interaction_tts  # noqa: E402
from faculty_directory import build_faculty_directory  # noqa: E402
from placement_directory import build_placement_directory  # noqa: E402
from department_directory import build_department_directory  # noqa: E402
from place_lookup import find_places  # noqa: E402


app = Flask(__name__)
CORS(app)

MAX_HISTORY = 5

# One ConversationContext (NLU follow-ups) plus the recent question/answer
# pairs (RAG follow-ups) per browser session, kept in memory. Fine for
# a single-process demo deployment; a multi-worker/production setup
# would need a shared store (Redis, a DB) instead, since each worker
# process would otherwise have its own separate SESSIONS dict.
SESSIONS = {}

_rag = None


def get_session(session_id):
    if session_id not in SESSIONS:
        SESSIONS[session_id] = {"context": ConversationContext(), "exchanges": []}
    return SESSIONS[session_id]


def get_rag():
    """Load rag/app.py once, by path. Importing it as `app` would pick up
    this file instead, since both modules share that name."""
    global _rag
    if _rag is None:
        # rag/app.py imports its sibling modules (spatial_lookup, ...).
        sys.path.append(os.path.dirname(RAG_APP_FILE))
        spec = importlib.util.spec_from_file_location("navika_rag_app", RAG_APP_FILE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _rag = module
    return _rag


def answer_from_rag(structured_query, exchanges, places):
    try:
        return get_rag().ask_question(
            structured_query["clean_text"],
            history=exchanges,
            intent=structured_query["intent"],
            places=places,
        )
    except Exception as error:
        app.logger.exception("RAG unavailable: %s", error)
        return "Sorry, I can't reach the campus knowledge base right now. Please try again in a moment."


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    session_id = data.get("session_id") or str(uuid.uuid4())

    if not message:
        return jsonify({"error": "message is required"}), 400

    session = get_session(session_id)

    structured_query = interaction_main.process_query(message, session["context"])

    places = find_places(structured_query["clean_text"])
    answer = answer_from_rag(structured_query, session["exchanges"], places)
    session["exchanges"] = (session["exchanges"] + [{"question": message, "answer": answer}])[-MAX_HISTORY:]

    return jsonify({
        "session_id": session_id,
        "answer": answer,
        "intent": structured_query["intent"],
        "confidence": structured_query["confidence"],
        "places": places,
        "entities": structured_query["entities"],
        "resolved_from_context": structured_query["resolved_from_context"],
    })


@app.route("/api/tts/malayalam", methods=["POST"])
def tts_malayalam():
    """
    Synthesizes Malayalam speech server-side and returns it as a WAV
    file. Exists because the browser's own Web Speech API (used for
    English in the frontend) has no usable Malayalam voice on this
    system — same gap tts.py's pyttsx3 path has — so Malayalam voice
    output has to be rendered here, with tts.py's VITS pipeline, rather
    than left to window.speechSynthesis.
    """

    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()

    if not text:
        return jsonify({"error": "text is required"}), 400

    try:
        wav_bytes = interaction_tts.synthesize_malayalam_wav(text)
    except Exception as error:
        return jsonify({"error": f"Malayalam TTS unavailable: {error}"}), 500

    return Response(wav_bytes, mimetype="audio/wav")


# Built once at process startup, not per-request: it's a pure parse of
# the already-crawled staff/faculty pages (no LLM call, no network
# request), so there's nothing to gain from redoing it on every hit, and
# the result only changes when the site is re-crawled and this process
# is restarted anyway.
FACULTY_DIRECTORY = build_faculty_directory()
PLACEMENT_DIRECTORY = build_placement_directory()
# Passed the already-built faculty list rather than building its own --
# department_directory.py cross-references it for each department's HOD
# photo, and faculty_directory.build_faculty_directory() does a ~10s live
# fetch per staff/faculty page; redoing that here would double startup
# time for no benefit.
DEPARTMENT_DIRECTORY = build_department_directory(FACULTY_DIRECTORY)


@app.route("/api/faculty", methods=["GET"])
def faculty_directory():
    return jsonify({"faculty": FACULTY_DIRECTORY})


@app.route("/api/placements", methods=["GET"])
def placement_directory():
    return jsonify({"batches": PLACEMENT_DIRECTORY})


@app.route("/api/departments", methods=["GET"])
def department_directory():
    return jsonify({"departments": DEPARTMENT_DIRECTORY})


@app.route("/api/reset", methods=["POST"])
def reset():
    data = request.get_json(silent=True) or {}
    session_id = data.get("session_id")

    if session_id in SESSIONS:
        SESSIONS[session_id]["context"].reset()
        SESSIONS[session_id]["exchanges"] = []

    return jsonify({"status": "ok"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=True, use_reloader=False)
