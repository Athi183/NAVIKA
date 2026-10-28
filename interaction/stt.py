import io
import wave

import numpy as np
import speech_recognition as sr
import whisper


# ==========================================
# Speech-to-Text
# ==========================================
# Two backends, split by job. Whisper's "tiny" model does ONLY spoken-
# language identification locally (its encoder alone, not the full
# decoder — a single forward pass, ~0.1s per utterance once the model is
# loaded, even on CPU) so the mic no longer needs a language chosen
# before listening starts. Actual transcription still goes through
# Google's recognize_google, same as before.
#
# This split is deliberate, not incidental — tested empirically before
# committing to it: Whisper's own multilingual checkpoints transcribe
# Malayalam badly. The "small" model transcribed a real Malayalam test
# clip as "Library Evidey Anu" (Latin-script phonetic guessing, not
# Malayalam text); "medium" was both far slower (53s for a 1.7s clip on
# this CPU — unusable live) AND worse ("aver"). Google's recognize_google,
# given the exact same clip and the correct language code, transcribed
# it perfectly. So Whisper answers "which language is this" (a much
# easier task its encoder is good at), Google still answers "what did
# they say" — using Whisper for both would trade working Malayalam
# transcription for broken Malayalam transcription just to get
# automatic language detection.

recognizer = sr.Recognizer()

# This project's internal language codes ("en"/"ml", matching
# preprocess.detect_language) vs. the BCP-47 codes recognize_google
# actually wants.
GOOGLE_LANG_CODES = {"en": "en-US", "ml": "ml-IN"}

_whisper_model = None


def _load_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        _whisper_model = whisper.load_model("tiny")
    return _whisper_model


def _audio_to_whisper_array(audio):
    """
    Converts an sr.AudioData object into the 16kHz mono float32 array
    Whisper's feature extractor expects. get_wav_data's convert_rate/
    convert_width do the resampling via SpeechRecognition's own
    audioop-based conversion, so this needs neither a temp file nor
    ffmpeg — whisper.load_audio's file-path mode shells out to ffmpeg
    internally, which this project doesn't otherwise depend on.
    """

    wav_bytes = audio.get_wav_data(convert_rate=16000, convert_width=2)
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        frames = wf.readframes(wf.getnframes())

    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def detect_spoken_language(audio):
    """
    Identifies which supported language was spoken ("en" or "ml"),
    using only Whisper's encoder (detect_language) rather than
    transcribing anything. Falls back to "en" on any error, or if
    Whisper's top guess is a language this project doesn't support
    (it recognizes ~100 languages; only two are wired up downstream).

    Confidence on a single short utterance is real but well below
    English's: in testing, a ~1.7s English clip scored ~98% for "en",
    while an equivalent Malayalam clip scored only ~41% for "ml" (with
    "en" and "hi" as the next guesses) — correct, but a meaningfully
    closer call. Treat this as a best guess on short phrases, not a
    certainty; forcing `lang` explicitly (see listen_from_mic) skips
    this uncertainty entirely when reliability matters more than
    hands-free language switching.
    """

    try:
        model = _load_whisper_model()
        samples = whisper.pad_or_trim(_audio_to_whisper_array(audio))
        mel = whisper.log_mel_spectrogram(samples, model.dims.n_mels).to(model.device)
        _, probs = model.detect_language(mel)
        detected = max(probs, key=probs.get)
        return detected if detected in GOOGLE_LANG_CODES else "en"
    except Exception as error:
        print(f"[Language detection unavailable ({error}) — defaulting to English]")
        return "en"


def listen_from_mic(timeout=5, phrase_time_limit=8, lang=None):
    """
    Captures audio from the default microphone and returns the
    transcribed text. Returns None if nothing usable was captured.

    `lang` ("en" or "ml") forces the spoken language and skips detection
    entirely — more reliable than auto-detection for short utterances
    (see detect_spoken_language's confidence numbers above). Leave it
    None (the default) to auto-detect per utterance instead, which is
    what lets a kiosk session mix English and Malayalam turn-to-turn
    with no manual language toggle.
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

    return transcribe_audio(audio, lang=lang)


def transcribe_audio(audio, lang=None):
    """
    Transcribes an sr.AudioData object into text. `lang` is this
    project's internal code ("en"/"ml") or None to auto-detect via
    Whisper first — either way, the actual transcription is done by
    Google's recognize_google (see module docstring for why).
    """

    if lang is None:
        lang = detect_spoken_language(audio)

    google_lang = GOOGLE_LANG_CODES.get(lang, "en-US")

    try:
        text = recognizer.recognize_google(audio, language=google_lang)
        return text

    except sr.UnknownValueError:
        return None

    except sr.RequestError as error:
        print(f"STT service error: {error}")
        return None


def transcribe_file(file_path, lang=None):
    """
    Transcribes an audio file (wav) instead of live mic input.
    Useful for testing without a microphone.
    """

    with sr.AudioFile(file_path) as source:
        audio = recognizer.record(source)

    return transcribe_audio(audio, lang=lang)
