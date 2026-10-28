import json
from pathlib import Path
from langchain_core.documents import Document

FACTS_FILE = Path(__file__).resolve().parent.parent / "data" / "college" / "core_facts.json"


def load_college_facts_documents() -> list[Document]:
    """Loads guaranteed baseline college facts from local JSON into LangChain Documents.

    Ensures the assistant can answer critical questions about college timings,
    placements, labs, and programmes even if the college website is offline.
    """
    if not FACTS_FILE.exists():
        print(f"Warning: Core facts file {FACTS_FILE} not found.")
        return []

    with open(FACTS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    documents = []

    # 1. Placement Statistics Document
    cse = data.get("cse_department", {})
    po = cse.get("placement_overview", {})
    batch_stats = cse.get("batch_placement_statistics", [])

    lines = [
        "Computer Science and Engineering (CSE) Placement Statistics at Muthoot Institute of Technology and Science (MITS):",
        f"Overview: Total Offers Received: {po.get('total_offers_received', 708)}, "
        f"Average Salary Package: {po.get('average_salary_package_lpa', 4.4)} LPA, "
        f"Total Students Placed: {po.get('total_students_placed', 372)}, "
        f"Associated Companies: {po.get('companies_associated', 177)}.",
        "\nBatch-wise Placement Records:",
    ]
    for b in batch_stats:
        lines.append(f"- Batch {b['batch']}: {b['students_placed']} students placed, {b['offers']} offers")

    documents.append(
        Document(
            page_content="\n".join(lines),
            metadata={"source": "https://mgmits.ac.in/cs-careerandplacementstatistics (cse placement summary)"},
        )
    )

    # 2. Recruiters Document
    recruiters = cse.get("top_recruiters", [])
    if recruiters:
        rec_lines = [
            "Top Recruiting Companies and Employers for Computer Science and Engineering (CSE) at Muthoot Institute of Technology and Science (MITS):",
            "Major recruiters hiring CSE graduates include:",
        ]
        for r in recruiters:
            rec_lines.append(f"- {r}")
        rec_lines.append(f"Over {po.get('companies_associated', 177)} corporate recruiters partner with the institution.")

        documents.append(
            Document(
                page_content="\n".join(rec_lines),
                metadata={"source": "https://mgmits.ac.in/cs-careerandplacementstatistics (cse recruiters)"},
            )
        )

    # 3. Department Labs and Infrastructure Document
    labs = cse.get("labs", [])
    clubs = cse.get("professional_bodies_and_clubs", [])
    lab_lines = [
        "Computing Laboratories and Facilities in the Department of Computer Science and Engineering at Muthoot Institute of Technology and Science (MITS):",
        "The CSE Department is equipped with modern state-of-the-art computing laboratories:",
    ]
    for lab in labs:
        lab_lines.append(f"- {lab}")
    if clubs:
        lab_lines.append("\nStudent associations and professional clubs:")
        for club in clubs:
            lab_lines.append(f"- {club}")
    lab_lines.append(f"The B.Tech in Computer Science & Engineering programme has an intake capacity of {cse.get('intake', 120)} students and duration of {cse.get('duration_years', 4)} years ({cse.get('credits', 160)} credits).")

    documents.append(
        Document(
            page_content="\n".join(lab_lines),
            metadata={"source": "https://mgmits.ac.in/department/cs (cse department labs and facilities)"},
        )
    )

    # 4. General College Overview Document
    col = data.get("college", {})
    progs = data.get("programmes", [])
    col_lines = [
        f"General Information for {col.get('name', 'Muthoot Institute of Technology and Science')}:",
        f"Location: {col.get('location', '')}",
        f"Office Working Hours: {col.get('office_hours', 'Monday - Saturday: 8:50 AM - 4:10 PM')}",
        f"Contact Phone: {col.get('contact', {}).get('phone', '')}",
        f"Contact Email: {col.get('contact', {}).get('email', '')}",
        "\nProgrammes Offered:",
    ]
    for p in progs:
        col_lines.append(f"- {p}")

    documents.append(
        Document(
            page_content="\n".join(col_lines),
            metadata={"source": "https://mgmits.ac.in/contact (core college overview)"},
        )
    )

    return documents
