from preprocess import clean_text
from nlu import understand_query
from context import ConversationContext
from stt import listen_from_mic
from tts import speak


# ==========================================
# RAG handoff (Member 2)
# ==========================================
# NOTE for the team: rag/app.py currently runs its chat loop at import
# time (the `while True` at the bottom isn't wrapped in
# `if __name__ == "__main__":`), so importing ask_question directly
# from it will hang on input(). Ask Member 2 to guard that block.
# Until then, this wrapper fails gracefully instead of hanging.

def get_answer_from_rag(structured_query):
    """
    Sends the structured query to Member 2's RAG module and returns
    the generated answer text. Falls back to a placeholder if the RAG
    module isn't wired up / importable yet.
    """

    question = structured_query["clean_text"]

    try:
        import sys
        sys.path.append("../rag")
        from app import ask_question  # noqa: E402
        return ask_question(question)

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

if __name__ == "__main__":
    context = ConversationContext()

    print("\nNAVIKA - Member 1: Multimodal Interaction & Query Understanding")
    print("Listening... (say 'exit' or press Ctrl+C to stop)\n")

    try:
        while True:
            raw_text = listen_from_mic()

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

            response_text = get_answer_from_rag(structured_query)
            print("Assistant:", response_text)

            speak(response_text)

    except KeyboardInterrupt:
        print("\nGoodbye!")