"""
Benchmarks the Malayalam VITS pipeline (Meta's MMS-TTS checkpoint,
facebook/mms-tts-mal, run through transformers' VitsModel) using the same
methodology as benchmark_malayalam_tts.py (the FastPitch+HiFi-GAN
benchmark) so the two are directly comparable: single-stream, median and
P90 latency, across the same word/phrase/12-word-sentence/18-word-sentence
test text.

VITS is architecturally different from FastPitch+HiFi-GAN: it's a single
end-to-end model (one forward pass produces the waveform directly), not
a two-stage acoustic-model-then-vocoder pipeline. There's no analogous
"acoustic vs. vocoder" split to report separately here -- only one total
latency number per utterance.
"""

import json
import statistics
import time

import numpy as np
import torch
from transformers import VitsModel, AutoTokenizer

MODEL_ID = "facebook/mms-tts-mal"

with open(
    "/private/tmp/claude-501/-Users-mac-NAVIKA/3313f008-9d85-4d5b-9c9c-4346c45c6dc5/scratchpad/ml_test_text.json",
    encoding="utf-8",
) as f:
    TEST_TEXT = json.load(f)

CATEGORIES = [
    ("word", TEST_TEXT["words"]),
    ("phrase", TEST_TEXT["phrases"]),
    ("sentence_12", TEST_TEXT["sentences_12"]),
    ("sentence_18", TEST_TEXT["sentences_18"]),
]


def percentile(values, p):
    values = sorted(values)
    k = (len(values) - 1) * (p / 100)
    f, c = int(k), min(int(k) + 1, len(values) - 1)
    if f == c:
        return values[f]
    return values[f] + (values[c] - values[f]) * (k - f)


def main():
    print("Loading Malayalam VITS checkpoint (CPU)...")
    t_load = time.perf_counter()
    model = VitsModel.from_pretrained(MODEL_ID)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    model.eval()
    print(f"Model load time: {time.perf_counter() - t_load:.2f}s (one-time cost, not per-query)\n")

    results = {}

    for category, samples in CATEGORIES:
        total_times = []

        for text in samples:
            inputs = tokenizer(text, return_tensors="pt")

            t0 = time.perf_counter()
            with torch.no_grad():
                model(**inputs).waveform
            total_times.append(time.perf_counter() - t0)

        results[category] = {
            "n": len(samples),
            "total_median": statistics.median(total_times),
            "total_p90": percentile(total_times, 90),
        }

        print(f"=== {category} (n={len(samples)}) ===")
        print(f"  Total (VITS, end-to-end): median={results[category]['total_median']*1000:.1f}ms  P90={results[category]['total_p90']*1000:.1f}ms")
        print()

    with open("malayalam_tts_vits_benchmark_results.json", "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print("Saved full results to malayalam_tts_vits_benchmark_results.json")


if __name__ == "__main__":
    main()
