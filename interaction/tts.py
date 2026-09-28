import pyttsx3


# ==========================================
# Text-to-Speech
# ==========================================
# A fresh pyttsx3 engine is created and disposed of on every speak()
# call instead of being cached/reused. This is deliberate: on macOS
# (the nsss driver), calling runAndWait() a second time on the SAME
# engine instance within one process frequently goes silent with no
# error at all — the call returns normally but nothing plays. Since
# main.py's loop calls speak() once per turn, a cached engine would
# work on the first turn and then silently stop working afterward.
# Recreating it per call costs a bit of init overhead but is reliable
# across turns, which matters more for a kiosk than speed here.

# First match wins. macOS (nsss) voice ids look like
# "com.apple.voice.compact.en-US.Samantha", Windows (sapi5) voice
# names look like "Microsoft Zira Desktop", Linux (espeak) voice
# ids look like "english" / "en". We match on substrings so this
# works across all three without hardcoding one OS.
PREFERRED_VOICE_HINTS = ["samantha", "zira", "david", "english", "en-us", "en_us"]


def _pick_voice(engine):
    """
    Some systems (seen on macOS) come up with no default voice set,
    which makes pyttsx3 silently speak nothing at all — no error,
    just silence. This picks a real voice explicitly so that never
    happens, preferring a natural-sounding one where available.
    """

    current = engine.getProperty("voice")
    if current:
        return current

    voices = engine.getProperty("voices")
    if not voices:
        return None

    for hint in PREFERRED_VOICE_HINTS:
        for voice in voices:
            haystack = f"{voice.id} {voice.name}".lower()
            if hint in haystack:
                return voice.id

    # nothing matched a preferred hint — just use the first available
    # voice rather than leaving it unset
    return voices[0].id


def _build_engine():
    engine = pyttsx3.init()
    engine.setProperty("rate", 170)
    engine.setProperty("volume", 1.0)

    voice_id = _pick_voice(engine)
    if voice_id:
        engine.setProperty("voice", voice_id)

    return engine


def speak(text):
    """
    Speaks the given text aloud through the kiosk's speakers.

    Builds a new engine per call (see note above) rather than reusing
    one across turns, and always tears it down afterward so the audio
    driver is left in a clean state for the next call.
    """

    if not text:
        return

    engine = None
    try:
        engine = _build_engine()
        engine.say(text)
        engine.runAndWait()
    except Exception as error:
        print(f"[TTS unavailable: {error}]")
    finally:
        if engine is not None:
            try:
                engine.stop()
            except Exception:
                pass