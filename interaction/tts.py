import os
import platform
import re
import subprocess
import tempfile
import unicodedata

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
# works across all three without hardcoding one OS. Keyed by language
# so speak(text, lang="ml") picks a Malayalam voice instead of English —
# voice ids for an installed Malayalam pack look like
# "com.apple.voice.compact.ml-IN.<Name>" on macOS, "ml-IN" on Windows.
PREFERRED_VOICE_HINTS = {
    "en": ["samantha", "zira", "david", "english", "en-us", "en_us"],
    "ml": ["malayalam", "ml-in", "ml_in"],
}

# macOS ships a long list of "fun"/character voices (Fred, Zarvox, the
# Eloquence family, etc.) alongside normal ones — none of these should
# ever get auto-selected, but a bare substring hint like "english" could
# still land on one by accident since matching is substring-based, not
# an allowlist. Matched by exact voice name, case-insensitive. These are
# all English-named novelty voices, so this list only needs to apply
# when picking an English voice.
NOVELTY_VOICE_NAMES = {
    "albert", "bad news", "bahh", "bells", "boing", "bubbles", "cellos",
    "wobble", "fred", "good news", "jester", "junior", "kathy", "organ",
    "superstar", "ralph", "trinoids", "whisper", "zarvox", "eddy", "flo",
    "grandma", "grandpa", "reed", "rocko", "sandy", "shelley",
}


def _pick_voice(engine, lang="en"):
    """
    Some systems (seen on macOS) come up with no default voice set,
    which makes pyttsx3 silently speak nothing at all — no error,
    just silence. This picks a real voice explicitly so that never
    happens, preferring a natural-sounding one where available.

    Note this can only choose among voices already installed on the
    machine. macOS's default-installed English voices (e.g. plain
    "Samantha") are all the older, more robotic "compact" synthesis
    tier — the notably better-sounding "Enhanced"/"Premium" voices
    exist but must be downloaded manually (System Settings ->
    Accessibility -> Spoken Content -> System Voice -> Manage Voices).
    If a compact voice still sounds too robotic, that's a one-time OS
    download, not something this code can fix — but this does prefer
    an Enhanced/Premium voice automatically if one is already installed
    alongside the compact one.

    For Malayalam (lang="ml"), a matching voice is only found if the OS
    already has a Malayalam voice pack installed (same "Manage Voices"
    path above) — most machines won't have one out of the box. Returns
    None in that case, which speak() treats as "can't speak this
    language" rather than silently mispronouncing it in an English voice.
    """

    voices = engine.getProperty("voices")
    if not voices:
        return None

    hints = PREFERRED_VOICE_HINTS.get(lang, PREFERRED_VOICE_HINTS["en"])

    if lang == "en":
        voices = [v for v in voices if v.name.lower() not in NOVELTY_VOICE_NAMES]
        if not voices:
            return None

    for hint in hints:
        matches = [v for v in voices if hint in f"{v.id} {v.name}".lower()]
        if not matches:
            continue

        non_compact = [v for v in matches if "compact" not in v.id.lower()]
        return (non_compact or matches)[0].id

    if lang == "en":
        # nothing matched a preferred hint — just use the first available
        # voice rather than leaving it unset
        return voices[0].id

    return None


def _build_engine(lang="en"):
    engine = pyttsx3.init()
    engine.setProperty("rate", 170)
    engine.setProperty("volume", 1.0)

    voice_id = _pick_voice(engine, lang)
    if voice_id:
        engine.setProperty("voice", voice_id)

    return engine, voice_id


# ==========================================
# Malayalam neural TTS (VITS)
# ==========================================
# pyttsx3 has zero Malayalam voices on every machine tested (0 of 184
# system voices) — Malayalam needs a genuine engine, not just a language
# flag, unlike English which pyttsx3 already covers natively. This runs
# Meta's MMS-TTS Malayalam checkpoint (facebook/mms-tts-mal) through
# transformers' VitsModel — an end-to-end model (one forward pass
# text -> waveform directly), unlike the earlier FastPitch+HiFi-GAN setup
# this replaced, which needed a separate acoustic model and vocoder stage.
#
# Downloaded automatically from Hugging Face on first use (~145MB), no
# manual model file setup needed, unlike the old AI4Bharat checkpoint.
# Benchmarked on this machine's CPU against the same test text as the old
# pipeline (see rag/benchmark_malayalam_tts_vits.py): median total latency
# ~290ms for a single word up to ~1.0s for an 18-word sentence. Slower
# than FastPitch+HiFi-GAN on short inputs (~290ms vs ~120ms for one word)
# but faster on longer ones (~1.0s vs ~1.45s for an 18-word sentence) —
# real RAG answers are closer to the sentence end of that range, so this
# is a net latency win for actual use, not a universal one. See
# rag/malayalam_tts_vits_benchmark_results.json for the full breakdown.

_MALAYALAM_MODEL_ID = "facebook/mms-tts-mal"

# Loaded once and cached at module scope, unlike pyttsx3's per-call engine
# above — loading this checkpoint took ~1-2s in benchmarking (after the
# one-time download), which is fine to pay once but far too slow to
# repeat on every single spoken response.
_malayalam_model = None
_malayalam_tokenizer = None


def _load_malayalam_model():
    global _malayalam_model, _malayalam_tokenizer
    if _malayalam_model is None:
        from transformers import VitsModel, AutoTokenizer

        _malayalam_model = VitsModel.from_pretrained(_MALAYALAM_MODEL_ID)
        _malayalam_model.eval()
        _malayalam_tokenizer = AutoTokenizer.from_pretrained(_MALAYALAM_MODEL_ID)
    return _malayalam_model, _malayalam_tokenizer


# This checkpoint's tokenizer vocabulary is mostly Malayalam script, but
# — unexpectedly — also contains a handful of stray Latin letters and
# digits (confirmed by inspecting its vocab directly: 'i', 'm', 'o', 'c',
# 'q' and '0'-'6' but not '7'-'9'). Using them anyway would be worse than
# dropping them: tested empirically, feeding raw text through produces no
# warning at all (unlike the old FastPitch checkpoint, which at least
# logged a warning per dropped character) and silently keeps just the
# in-vocab fragments — "8.30" became the wrong-but-plausible-looking "30",
# and "working days" collapsed to the meaningless "oi". That's worse than
# an honest omission: it reads as if the model said something, when what
# it said doesn't match the real text at all. So this intentionally
# excludes those stray characters and only allows genuine Malayalam
# script (Unicode block U+0D00-U+0D7F, same block preprocess.py/rag/app.py
# use for language detection) plus space.
_MALAYALAM_SYNTHESIZABLE_CHARS = set(" ") | {chr(c) for c in range(0x0D00, 0x0D80)}


def _strip_markdown_for_malayalam_tts(text):
    """
    Same problem as chatApi.js's stripMarkdownForSpeech (the LLM's markdown
    gets read/dropped literally), but this has to run before the
    vocabulary filter below, not instead of it: a whitespace token like
    "**കോളേജ്**" contains real Malayalam wrapped in asterisks the
    vocabulary filter doesn't know about — filtering token-by-token first
    would discard the whole word just because of the attached "*", losing
    real content instead of just the markdown noise.
    """

    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"\*(.+?)\*", r"\1", text)
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"^[\-\*•]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\d+\.\s+", "", text, flags=re.MULTILINE)
    return text


def _strip_edge_punctuation(word):
    """
    Strips leading/trailing punctuation (Unicode category P*: periods,
    commas, parentheses, quotes...) from a word, without touching
    anything in the middle of it. Needed because real Malayalam answers
    are full of this -- abbreviation dots ("ഡോ."), sentence-ending
    periods ("ആണ്."), parenthesized asides ("(MITS)") -- and treating a
    whole token as unsynthesizable just because of attached punctuation
    was wrongly discarding genuine Malayalam words along with the actual
    English/numeral content, found by testing a real RAG answer: "ഡോ.",
    "പി.", "സി.", "ആണ്.", and "വഹിക്കുന്നുണ്ട്." were all being dropped
    whole, even though each is a real word once the trailing period is
    removed.
    """

    start, end = 0, len(word)
    while start < end and unicodedata.category(word[start])[0] == "P":
        start += 1
    while end > start and unicodedata.category(word[end - 1])[0] == "P":
        end -= 1
    return word[start:end]


def _drop_unsynthesizable_words(text):
    """
    Drops each whitespace-separated token wholesale if its core (after
    stripping edge punctuation, see _strip_edge_punctuation) contains any
    character outside the model's vocabulary, rather than letting
    coqui-tts discard the offending characters one at a time from inside
    the token — the latter can leave a mangled remainder of a word instead
    of cleanly omitting it. This means English loanwords and any numeral
    are still dropped from what's SPOKEN (the on-screen answer is
    untouched) — a real, current limitation of this checkpoint, not a
    cosmetic one — but a Malayalam word is no longer punished just for
    having ordinary punctuation attached to it.
    """

    kept = []
    for word in text.split():
        core = _strip_edge_punctuation(word)
        if core and all(ch in _MALAYALAM_SYNTHESIZABLE_CHARS for ch in core):
            kept.append(core)
    return " ".join(kept)


def synthesize_malayalam_wav(text):
    """
    Returns synthesized Malayalam speech as raw WAV bytes, without
    playing it anywhere. Separated from _speak_malayalam (which plays
    audio through this machine's own speakers via afplay) because the
    Flask backend (backend/app.py) also needs this: a web request isn't
    being made by someone sitting at the server's speakers, so the
    backend's job is to hand the browser audio data to play itself, not
    to play audio locally on the server.
    """

    import io
    import wave

    import numpy as np
    import torch

    text = _strip_markdown_for_malayalam_tts(text)
    text = _drop_unsynthesizable_words(text)

    model, tokenizer = _load_malayalam_model()
    inputs = tokenizer(text, return_tensors="pt")

    with torch.no_grad():
        waveform = model(**inputs).waveform

    # VitsModel outputs float32 samples in [-1, 1] -- the `wave` module
    # (and afplay, and browsers' <audio>) expect integer PCM, not float,
    # so this has to be rescaled before writing, unlike coqui-tts's
    # save_wav (which did this conversion internally).
    samples = waveform.squeeze().numpy()
    samples_int16 = np.clip(samples * 32767, -32768, 32767).astype(np.int16)

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(model.config.sampling_rate)
        wf.writeframes(samples_int16.tobytes())

    return buffer.getvalue()


def _speak_malayalam(text):
    wav_bytes = synthesize_malayalam_wav(text)

    fd, temp_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        with open(temp_path, "wb") as f:
            f.write(wav_bytes)
        if platform.system() == "Darwin":
            subprocess.run(["afplay", temp_path], check=True)
        else:
            # Only macOS playback is wired up so far — this project's
            # kiosk/dev target. A Windows/Linux deployment needs an
            # equivalent playback call here (e.g. simpleaudio) before
            # lang="ml" will work there.
            raise RuntimeError("Malayalam TTS playback is only implemented for macOS so far.")
    finally:
        os.remove(temp_path)


def speak(text, lang="en"):
    """
    Speaks the given text aloud through the kiosk's speakers.

    lang="ml" routes to the neural FastPitch+HiFi-GAN pipeline above
    rather than pyttsx3, since pyttsx3 has no usable Malayalam voice on
    this system. lang="en" is unaffected and still uses pyttsx3 exactly
    as before, rebuilding a fresh engine per call (see note above).

    If the neural pipeline fails for any reason (model files missing,
    coqui-tts not installed, playback failure), falls back to pyttsx3's
    default voice rather than staying silent — misreading Malayalam text
    with an English voice's phonetics is still more useful to a kiosk
    user than total silence, but a clear warning is always printed so
    the gap is visible rather than silently wrong.
    """

    if not text:
        return

    if lang == "ml":
        try:
            _speak_malayalam(text)
            return
        except Exception as error:
            print(
                f"[Malayalam neural TTS unavailable ({error}) — falling back "
                "to the default system voice instead.]"
            )

    engine = None
    try:
        engine, voice_id = _build_engine(lang)
        if lang == "ml" and voice_id is None:
            print(
                "[TTS warning: no Malayalam voice installed — speaking with "
                "the default voice instead. Install one via System Settings "
                "-> Accessibility -> Spoken Content -> Manage Voices.]"
            )
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
