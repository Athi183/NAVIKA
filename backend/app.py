import os
import sys
import uuid

from flask import Flask, request, jsonify
from flask_cors import CORS

# interaction/ and rag/ are sibling directories, not installed packages —
# resolve their paths from this file's own location (not the process's
# CWD) so this works regardless of where the server is launched from.
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INTERACTION_DIR = os.path.join(BASE_DIR, "..", "interaction")
sys.path.append(INTERACTION_DIR)

from context import ConversationContext  # noqa: E402
import main as interaction_main  # noqa: E402


app = Flask(__name__)
CORS(app)

# One ConversationContext per browser session, kept in memory. Fine for
# a single-process demo deployment; a multi-worker/production setup
# would need a shared store (Redis, a DB) instead, since each worker
# process would otherwise have its own separate SESSIONS dict.
SESSIONS = {}


def get_context(session_id):
    if session_id not in SESSIONS:
        SESSIONS[session_id] = ConversationContext()
    return SESSIONS[session_id]


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

    context = get_context(session_id)

    structured_query = interaction_main.process_query(message, context)

    answer = interaction_main.get_answer_from_rag(
        structured_query, history=context.recent_exchanges()
    )
    context.record_exchange(message, answer)

    return jsonify({
        "session_id": session_id,
        "answer": answer,
        "intent": structured_query["intent"],
        "confidence": structured_query["confidence"],
        "entities": structured_query["entities"],
        "resolved_from_context": structured_query["resolved_from_context"],
    })


@app.route("/api/reset", methods=["POST"])
def reset():
    data = request.get_json(silent=True) or {}
    session_id = data.get("session_id")

    if session_id in SESSIONS:
        SESSIONS[session_id].reset()

    return jsonify({"status": "ok"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=True, use_reloader=False)
