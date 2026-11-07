from types import SimpleNamespace
import unittest
from unittest.mock import patch

import app
from langchain_core.documents import Document


class CapturingLLM:
    def __init__(self):
        self.prompt = ""

    def invoke(self, prompt):
        self.prompt = prompt
        return SimpleNamespace(content="stubbed response")


class RetrievalRegressionTests(unittest.TestCase):
    def install_documents(self, documents):
        vectorstore = SimpleNamespace(docstore=SimpleNamespace(
            _dict={str(index): doc for index, doc in enumerate(documents)}
        ))
        retriever = SimpleNamespace(invoke=lambda _query: [])
        return (
            patch.object(app, "vectorstore", vectorstore),
            patch.object(app, "retriever", retriever),
        )


    def test_indu_name_query_ranks_the_official_cse_record(self):
        target = Document(
            page_content=(
                "Dr. Indu M. T. | Assistant Professor | Computer Science "
                "and Engineering | Research Interests: Machine Learning"
            ),
            metadata={"source": "https://mgmits.ac.in/cs-staff"},
        )
        distractor = Document(
            page_content="Dr. Chikku Abraham is Vice Principal.",
            metadata={"source": "https://mgmits.ac.in/vice-principal"},
        )
        llm = CapturingLLM()
        vectorstore_patch, retriever_patch = self.install_documents(
            [distractor, target]
        )

        with vectorstore_patch, retriever_patch, patch.object(app, "llm", llm):
            answer = app.ask_question("Who is Dr. Indu M. T.?")

        self.assertEqual(answer, "stubbed response")
        self.assertIn("https://mgmits.ac.in/cs-staff", llm.prompt)
        self.assertIn("Assistant Professor", llm.prompt)
        self.assertIn("Research Interests: Machine Learning", llm.prompt)


    def test_tcs_query_keeps_periods_and_offer_semantics_in_prompt(self):
        records = [
            Document(
                page_content=(
                    "Recruiter Wise Analysis 2022-2026 Batch\n"
                    "Columns: Recruiter | Total offers\n"
                    "TCS Digital | 43\nTCS Ninja | 32\nTCS Prime | 4\n"
                    "TCS Codevita | 1"
                ),
                metadata={"source": "https://mgmits.ac.in/placement"},
            ),
            Document(
                page_content=(
                    "Recruiter Wise Analysis 2021-2025 Batch\n"
                    "Columns: Recruiter | Total Offers\n"
                    "TCS Ninja | 54"
                ),
                metadata={"source": "https://mgmits.ac.in/placement"},
            ),
        ]
        llm = CapturingLLM()
        vectorstore_patch, retriever_patch = self.install_documents(records)

        with vectorstore_patch, retriever_patch, patch.object(app, "llm", llm):
            answer = app.ask_question("How many got placed at TCS?")

        self.assertEqual(answer, "stubbed response")
        self.assertIn("https://mgmits.ac.in/placement", llm.prompt)
        self.assertIn("Total offers", llm.prompt)
        self.assertIn("2022-2026 Batch", llm.prompt)
        self.assertIn("2021-2025 Batch", llm.prompt)
        self.assertIn("Do not add counts from separate tables or reporting periods", llm.prompt)
        self.assertIn(
            "offer count equals the number of unique students finally placed",
            llm.prompt,
        )
        self.assertIn(
            "report the supported offer rows and periods",
            llm.prompt,
        )


if __name__ == "__main__":
    unittest.main()
