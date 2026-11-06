"""
Turns the already-extracted placement batch sections (rag/app.py's
PLACEMENT_BATCH_SECTIONS -- regex-sectioned straight from the crawled
placement page, see that file's own comments for why a structural
header-to-next-header split was needed) into clean structured data for
the frontend's placement screen: per-batch total offers, highest package
(when the source actually publishes one -- most batches don't, and this
must never guess one), and a list of {recruiter, offers, ctc} rows.

Deliberately does not touch the LLM. A batch-placement question was one
of the slowest and most failure-prone things in this app precisely
*because* it went through the LLM (large context, the single heaviest
prompt in the whole system, and the repeated cause of hitting Groq's
per-minute token caps). The data is already fully structured on the
source page (a real HTML table); re-describing it in prose for a model
to read back out was adding both latency and a point of failure that
parsing it directly removes outright.
"""

import pickle
import re
from pathlib import Path

CACHE_FILE = Path(__file__).resolve().parent / "crawl_cache.pkl"

_PLACEMENT_SOURCE_URLS = ("https://mgmits.ac.in/placement", "https://www.mgmits.ac.in/placement")
# Same structural header-to-next-header split as rag/app.py's own
# PLACEMENT_BATCH_SECTIONS (see that file for why: a batch's own "Total
# Offers" line and its department-unrelated recruiter table have to stay
# scoped to that one batch, not bleed into or get mixed up with another).
# Duplicated here rather than imported because rag/app.py also loads the
# full embeddings model, FAISS index, and Groq client at import time --
# all needless weight for what's otherwise a plain, instant text-parsing
# endpoint with no LLM dependency.
_BATCH_SECTION_PATTERN = re.compile(
    r"Recruiter Wise Analysis ([\d]{4}-[\d]{4}) Batch.*?(?=Recruiter Wise Analysis [\d]{4}-[\d]{4} Batch|\Z)",
    re.DOTALL,
)
_PLACEMENT_MAX_SECTION_CHARS = 8000

_TOTAL_LABEL_PATTERN = re.compile(r"^total\s*offers?$", re.IGNORECASE)
# The total-offers value isn't formatted consistently across batches --
# most are a bare number ("428"), but at least one is "509 offers" (the
# word repeated). A plain int() cast raised ValueError on that one and
# silently left totalOffers as None (confirmed directly: 4 of 5 batches
# parsed fine, 2018-2022 specifically didn't). Extracting the leading
# digits handles both.
_LEADING_NUMBER_PATTERN = re.compile(r"^\d+")
_HIGHEST_PACKAGE_PATTERN = re.compile(r"highest\s*package\s*:?\s*([\d.]+\s*LPA)", re.IGNORECASE)


def _parse_batch_section(section_text):
    highest_package_match = _HIGHEST_PACKAGE_PATTERN.search(section_text)
    highest_package = highest_package_match.group(1).strip() if highest_package_match else None

    recruiters = []
    total_offers = None

    for line in section_text.splitlines():
        line = line.strip()
        if "|" not in line:
            continue
        fields = [part.strip() for part in line.split("|")]

        # The closing "Total Offers | 428" summary line has only 2
        # fields, not 3+ like every recruiter row -- it must be checked
        # before the 3-field table-row logic below, which would just
        # skip it as too short.
        if len(fields) == 2 and _TOTAL_LABEL_PATTERN.match(fields[0]):
            number_match = _LEADING_NUMBER_PATTERN.match(fields[1])
            if number_match:
                total_offers = int(number_match.group(0))
            continue

        if len(fields) < 3:
            continue

        # The recruiter/offers/CTC columns are always the LAST three
        # pipe-separated fields, regardless of whether a row also has a
        # leading "SL No." column -- some batches' tables have it, some
        # don't, and even within one table a row occasionally lacks it
        # (confirmed directly: "Xapien Innovatus | 1 | 15k stipend" in
        # the 2022-2026 table has no leading number, unlike every row
        # before it). Taking the last 3 fields handles both uniformly
        # instead of assuming a fixed column count.
        label, offers_text, ctc = fields[-3:]

        if _TOTAL_LABEL_PATTERN.match(label):
            try:
                total_offers = int(offers_text)
            except ValueError:
                pass
            continue

        if not offers_text.isdigit():
            # Not a real data row -- the header row itself ("Recruiter |
            # Total offers | CTC...") or stray prose from the page that
            # happens to contain pipe characters both land here and are
            # silently skipped, which is correct: this ends table-row
            # parsing on anything that isn't actually one.
            continue

        if not label or label.lower() in ("recruiter", "sl no.", "sl no"):
            continue

        recruiters.append({
            "recruiter": label,
            "offers": int(offers_text),
            "ctc": ctc,
        })

    return {
        "totalOffers": total_offers,
        "highestPackage": highest_package,
        "recruiters": recruiters,
    }


def _load_placement_page_text():
    if not CACHE_FILE.exists():
        return ""

    with CACHE_FILE.open("rb") as f:
        cached = pickle.load(f)
    documents = cached["documents"] if isinstance(cached, dict) and "documents" in cached else cached

    placement_docs = [
        doc for doc in documents
        if doc.metadata.get("source", "") in _PLACEMENT_SOURCE_URLS
    ]
    if not placement_docs:
        return ""

    # The crawl also produces several smaller ~800-1000 char
    # "table-document" entries for this same page (ingest.py's table-
    # aware extraction, grouped 8 rows at a time) alongside the one large
    # flattened-page-text document -- confirmed directly: 53 documents
    # share this source URL, but only one is actually the full page
    # (26,694 characters; the rest are all under 1,300). The single large
    # one alone is both sufficient and cleaner for this regex split than
    # reassembling from the smaller pieces would be (no chunk-boundary
    # duplication to worry about).
    return max(placement_docs, key=lambda doc: len(doc.page_content)).page_content


def build_placement_directory():
    """
    Returns a list of per-batch placement records, newest batch (highest
    graduation year) first, each with {batchRange, totalOffers,
    highestPackage, recruiters}. Safe to call once at process startup and
    cache the result -- the underlying data only changes when
    crawl_cache.pkl is regenerated by a fresh crawl.
    """

    page_text = _load_placement_page_text()
    batch_sections = {
        match.group(1): match.group(0).strip()[:_PLACEMENT_MAX_SECTION_CHARS]
        for match in _BATCH_SECTION_PATTERN.finditer(page_text)
    }

    batches = []
    for batch_range, section_text in batch_sections.items():
        parsed = _parse_batch_section(section_text)
        batches.append({"batchRange": batch_range, **parsed})

    batches.sort(key=lambda b: b["batchRange"].split("-")[1], reverse=True)
    return batches
