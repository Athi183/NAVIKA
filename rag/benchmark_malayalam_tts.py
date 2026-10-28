"""
Historical benchmark, kept for reference: this measured the FastPitch +
HiFi-GAN pipeline that interaction/tts.py used for Malayalam before it was
replaced with VITS (see benchmark_malayalam_tts_vits.py and
interaction/tts.py's module docstring for the comparison and why VITS
replaced it). No longer what's actually running in production.

Benchmarks the Malayalam FastPitch + HiFi-GAN pipeline (AI4Bharat's
Indic-TTS checkpoint, run through coqui-tts) using the same methodology
Paper 5 (Dinh, Patamia, Liu, Cosgun 2025) used to benchmark open-source
TTS systems: single-stream (one request fully processed before the
next), median and P90 latency, across increasing input-length
categories (words, phrases, 12-word sentences, 18-word sentences).

Unlike Paper 5 (English only, GPU laptop), this measures Malayalam on
CPU -- neither the language nor the hardware was covered by that paper,
so these are original numbers, not a re-run of theirs. Reports the
acoustic model (FastPitch) and vocoder (HiFi-GAN) timings separately,
not just a combined total, since the vocoder is often the slower half
of a non-autoregressive pipeline like this one on CPU.
"""

import json
import statistics
import time

from TTS.utils.synthesizer import Synthesizer

# Confirmed via `unzip -l ml.zip` against the actual extracted archive.
LANG_DIR = "tts_models/ml"
TTS_CHECKPOINT = f"{LANG_DIR}/fastpitch/best_model.pth"
TTS_CONFIG = f"{LANG_DIR}/fastpitch/config.json"
VOCODER_CHECKPOINT = f"{LANG_DIR}/hifigan/best_model.pth"
VOCODER_CONFIG = f"{LANG_DIR}/hifigan/config.json"

# This checkpoint is multi-speaker (speakers.pth: {"female": 0, "male": 1}) --
# synthesize() raises without a speaker name. "female" is an arbitrary but
# fixed choice so every category is timed against the same voice.
SPEAKER_NAME = "female"

with open("/tmp/ml_test_text.json", encoding="utf-8") as f:
    TEST_TEXT = json.load(f)

CATEGORIES = [
    ("word", TEST_TEXT["words"]),
    ("phrase", TEST_TEXT["phrases"]),
    ("sentence_12", TEST_TEXT["sentences_12"]),
    ("sentence_18", TEST_TEXT["sentences_18"]),
]


def load_synthesizer():
    return Synthesizer(
        tts_checkpoint=TTS_CHECKPOINT,
        tts_config_path=TTS_CONFIG,
        vocoder_checkpoint=VOCODER_CHECKPOINT,
        vocoder_config=VOCODER_CONFIG,
        use_cuda=False,
    )


def percentile(values, p):
    values = sorted(values)
    k = (len(values) - 1) * (p / 100)
    f, c = int(k), min(int(k) + 1, len(values) - 1)
    if f == c:
        return values[f]
    return values[f] + (values[c] - values[f]) * (k - f)


def main():
    print("Loading Malayalam FastPitch + HiFi-GAN checkpoint (CPU)...")
    t_load = time.perf_counter()
    synth = load_synthesizer()
    print(f"Model load time: {time.perf_counter() - t_load:.2f}s (one-time cost, not per-query)\n")

    results = {}

    for category, samples in CATEGORIES:
        acoustic_times = []
        total_times = []

        for text in samples:
            # Acoustic model alone (FastPitch: text -> mel spectrogram)
            t0 = time.perf_counter()
            synth.tts_model.synthesize(text=text, speaker=SPEAKER_NAME, use_griffin_lim=False)
            acoustic_times.append(time.perf_counter() - t0)

            # Full pipeline (FastPitch + HiFi-GAN: text -> waveform)
            t0 = time.perf_counter()
            synth.tts(text, speaker_name=SPEAKER_NAME)
            total_times.append(time.perf_counter() - t0)

        vocoder_times = [t - a for t, a in zip(total_times, acoustic_times)]

        results[category] = {
            "n": len(samples),
            "acoustic_median": statistics.median(acoustic_times),
            "acoustic_p90": percentile(acoustic_times, 90),
            "vocoder_median": statistics.median(vocoder_times),
            "vocoder_p90": percentile(vocoder_times, 90),
            "total_median": statistics.median(total_times),
            "total_p90": percentile(total_times, 90),
        }

        print(f"=== {category} (n={len(samples)}) ===")
        print(f"  Acoustic (FastPitch): median={results[category]['acoustic_median']*1000:.1f}ms  P90={results[category]['acoustic_p90']*1000:.1f}ms")
        print(f"  Vocoder  (HiFi-GAN) : median={results[category]['vocoder_median']*1000:.1f}ms  P90={results[category]['vocoder_p90']*1000:.1f}ms")
        print(f"  Total pipeline      : median={results[category]['total_median']*1000:.1f}ms  P90={results[category]['total_p90']*1000:.1f}ms")
        print()

    with open("malayalam_tts_benchmark_results.json", "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print("Saved full results to malayalam_tts_benchmark_results.json")


if __name__ == "__main__":
    main()
