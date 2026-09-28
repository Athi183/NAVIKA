import speech_recognition as sr


# ==========================================
# Speech-to-Text
# ==========================================
# Uses the device microphone by default (recognize_google needs internet).
# For fully offline kiosks, swap the recognizer call for a local Whisper
# model later (recognizer.recognize_whisper).

recognizer = sr.Recognizer()


def listen_from_mic(timeout=5, phrase_time_limit=8):
    """
    Captures audio from the default microphone and returns the
    transcribed text. Returns None if nothing usable was captured.
    """

    with sr.Microphone() as source:
        recognizer.adjust_for_ambient_noise(source, duration=0.5)
        print("Listening...")

        try:
            audio = recognizer.listen(
                source,
                timeout=timeout,
                phrase_time_limit=phrase_time_limit
            )
        except sr.WaitTimeoutError:
            return None

    return transcribe_audio(audio)


def transcribe_audio(audio):
    """
    Transcribes an sr.AudioData object into text.
    """

    try:
        text = recognizer.recognize_google(audio)
        return text

    except sr.UnknownValueError:
        return None

    except sr.RequestError as error:
        print(f"STT service error: {error}")
        return None


def transcribe_file(file_path):
    """
    Transcribes an audio file (wav) instead of live mic input.
    Useful for testing without a microphone.
    """

    with sr.AudioFile(file_path) as source:
        audio = recognizer.record(source)

    return transcribe_audio(audio)
