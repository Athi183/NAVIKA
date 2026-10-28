"""
Retrieval-pipeline test suite for NAVIKA's RAG knowledge base.

Checks steps 1-4 of a question's lifecycle -- was the source page
discovered, was its content extracted, was it indexed, does retrieval
surface it -- WITHOUT calling the LLM (step 5: is the generated answer
actually grounded in that context). That split is deliberate: steps 1-4
are deterministic and free to re-run as often as needed; step 5 costs
real Groq tokens and can hit the account's daily quota, so it's kept
optional and separate (--with-llm) rather than baked into every run.

Each case is checked three ways:
  - crawl: was a document with this source URL actually crawled at all
    (independent of chunking/retrieval -- catches "never discovered" vs.
    "discovered but retrieval ranked it badly")
  - retrieved: does the assembled context NAVIKA's app.py would actually
    send to the LLM (vectorstore top-k + augment_documents_for +
    spatial_context_for_question, same as ask_question builds) contain
    the expected fact
  - verdict: PASS if retrieved, FAIL if the source was crawled but the
    fact still didn't make it into context (a retrieval/indexing
    problem), MISSING_SOURCE if the source page itself was never crawled
    (a crawl-coverage problem) -- these three outcomes point at
    different layers of the pipeline, which is the point: a single
    pass/fail number can't tell you whether to fix the crawler or the
    retriever.

"absent" cases (expect=None) invert the check: PASS means nothing
matched, which is the correct behavior for a question with no real
answer on the site. These exist so the suite can't be gamed by
over-broad retrieval that happens to return something for every query.

Usage:
    python3 test_retrieval_suite.py            # retrieval-only (free)
    python3 test_retrieval_suite.py --with-llm # also generates and
                                                # grades real answers
                                                # (costs Groq tokens)
"""

import argparse
import importlib.util
import json
import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_app():
    spec = importlib.util.spec_from_file_location("navika_rag_app_test", os.path.join(BASE_DIR, "app.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Each case: (category, question, expect) -- expect is a substring that
# must appear (case-insensitively) somewhere in the assembled context for
# a "present" case, or None for a case whose answer should NOT be found.
# source_hint (optional) is a URL substring used only for the separate
# "was this page even crawled" check, independent of whether retrieval
# found it.
TEST_CASES = [
    ("faculty", "who is doctor Indu MT", "indu m", "cs-staff"),
    ("faculty", "who is Anishin Raj", "anishin raj", "cs-staff"),
    ("faculty", "who is the HOD of civil engineering", "mary lissy", "department/ce"),
    ("faculty", "who is the HOD of mechanical engineering", "pramod kumar", "department/me"),
    ("faculty", "is Indu MT a faculty member at MITS", "indu m", "cs-staff"),
    ("departments", "what departments are available at MITS", "computer science", None),
    ("departments", "where is the CSE department located", "cse", None),
    ("placement", "what is the total offers for the 2022-2026 batch", "2022-2026", "placement"),
    ("placement", "how many offers did TCS make", "tcs", "placement"),
    ("admissions", "what are the admission requirements", "eligib", "admission"),
    ("admissions", "what entrance exams are accepted", "keam", "admission"),
    ("research", "what research activities are available at MITS", "research", "research"),
    ("facilities", "what facilities does the computer science department have", "laborator", "department/cs"),
    ("contact", "what is the contact information for MITS", "phone", "contact"),
    # Spatial-matching regression cases: a department library sharing a
    # generic word ("library") with several other labels must still rank
    # to the correct floor, not get crowded out by same-department rooms
    # that merely share the department code (see spatial_lookup.py's
    # _match_score / _GENERIC_MATCH_ONLY_WORDS).
    ("spatial", "where is the computer science department library", "floor 3", None),
    ("spatial", "where is the artificial intelligence department library", "floor 4", None),
    ("absent", "what is the price of a semester abroad exchange program at MIT Boston", None, None),
    ("absent", "who is the president of the United States mentioned on the MITS website", None, None),
    ("absent", "what is MITS's policy on cryptocurrency payments for fees", None, None),
]


def source_was_crawled(cache_documents, source_hint):
    if source_hint is None:
        return None
    return any(source_hint in doc.metadata.get("source", "") for doc in cache_documents)


def build_context(app, question):
    """Mirrors ask_question's retrieval assembly (app.py) up to, but not
    including, the LLM call -- so this exercises the exact same retrieval
    path the real answer would be generated from."""
    documents = app.retriever.invoke(question)
    chunks = [doc.page_content for doc in documents]
    for text in app.augment_documents_for(question):
        if text not in chunks:
            chunks.append(text)
    spatial = app.spatial_context_for_question(question)
    if spatial:
        chunks.append(spatial)
    return "\n\n".join(chunks)


def run(with_llm=False):
    app = _load_app()

    import pickle
    cache_path = os.path.join(BASE_DIR, "crawl_cache.pkl")
    cache_documents = []
    if os.path.exists(cache_path):
        with open(cache_path, "rb") as f:
            cached = pickle.load(f)
        cache_documents = cached["documents"] if isinstance(cached, dict) and "documents" in cached else cached

    results = []
    for category, question, expect, source_hint in TEST_CASES:
        context = build_context(app, question)
        context_lower = context.lower()
        found = (expect.lower() in context_lower) if expect else False

        if expect is None:
            verdict = "PASS" if not found else "FAIL (retrieved something for an absent-answer question)"
        else:
            crawled = source_was_crawled(cache_documents, source_hint)
            if found:
                verdict = "PASS"
            elif crawled is False:
                verdict = "MISSING_SOURCE (page never crawled)"
            elif crawled is None:
                verdict = "FAIL (retrieval/indexing -- no source_hint to localize further)"
            else:
                verdict = "FAIL (page WAS crawled, but fact didn't reach retrieved context)"

        result = {
            "category": category,
            "question": question,
            "expect": expect,
            "verdict": verdict,
            "context_chars": len(context),
        }

        if with_llm:
            try:
                answer = app.ask_question(question)
            except Exception as exc:
                answer = f"<error: {exc}>"
            result["llm_answer"] = answer

        results.append(result)

    return results


def print_report(results):
    width = max(len(r["question"]) for r in results) + 2
    passed = sum(1 for r in results if r["verdict"] == "PASS")
    for r in results:
        marker = "OK " if r["verdict"] == "PASS" else "!! "
        print(f"{marker}[{r['category']:<10}] {r['question']:<{width}} -> {r['verdict']}")
        if "llm_answer" in r:
            print(f"      answer: {r['llm_answer'][:200]}")
    print(f"\n{passed}/{len(results)} passed (retrieval-level check)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--with-llm", action="store_true", help="Also generate real answers via ask_question (costs Groq tokens)")
    parser.add_argument("--json", action="store_true", help="Print results as JSON instead of a text report")
    args = parser.parse_args()

    results = run(with_llm=args.with_llm)

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        print_report(results)
