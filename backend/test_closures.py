"""Run: .venv/bin/python -m unittest backend/test_closures.py"""
import os
import sys
import tempfile
import unittest
from pathlib import Path

from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parent))
from closures import closures_bp  # noqa: E402

CLOSURE = {"id": "c1", "type": "shaft", "shaft": "shaft_15", "reason": "Cleaning"}


class ClosuresApiTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        os.environ["NAVIKA_CLOSURES_FILE"] = os.path.join(self.folder.name, "state.json")
        os.environ.pop("NAVIKA_STAFF_KEY", None)
        app = Flask(__name__)
        app.register_blueprint(closures_bp)
        self.client = app.test_client()

    def tearDown(self):
        self.folder.cleanup()
        os.environ.pop("NAVIKA_CLOSURES_FILE", None)
        os.environ.pop("NAVIKA_STAFF_KEY", None)

    def post(self, body, key="secret"):
        return self.client.post("/api/closures", json=body, headers={"X-Staff-Key": key})

    def test_empty_by_default(self):
        state = self.client.get("/api/closures").get_json()
        self.assertEqual(state["closures"], [])
        self.assertIsNone(state["emergency"])

    def test_changes_need_a_key_set_on_the_server(self):
        self.assertEqual(self.post({"closures": [CLOSURE]}).status_code, 403)

    def test_wrong_key_is_refused(self):
        os.environ["NAVIKA_STAFF_KEY"] = "secret"
        self.assertEqual(self.post({"closures": [CLOSURE]}, key="guess").status_code, 401)
        self.assertEqual(self.client.get("/api/closures").get_json()["closures"], [])

    def test_saves_and_reads_back(self):
        os.environ["NAVIKA_STAFF_KEY"] = "secret"
        area = {"id": "c2", "type": "area", "floor": "R2", "xy": [-80, 10], "radius_m": 5}
        response = self.post({"closures": [CLOSURE, area], "emergency": {"message": "Fire drill"}})
        self.assertEqual(response.status_code, 200)
        state = self.client.get("/api/closures").get_json()
        self.assertEqual([item["id"] for item in state["closures"]], ["c1", "c2"])
        self.assertEqual(state["emergency"], {"message": "Fire drill"})

    def test_bad_closures_are_refused(self):
        os.environ["NAVIKA_STAFF_KEY"] = "secret"
        for bad in ({"id": "x", "type": "door"},
                    {"id": "x", "type": "area", "floor": 1, "xy": [1], "radius_m": 3},
                    {"id": "x", "type": "area", "floor": 1, "xy": [1, 2], "radius_m": 300},
                    {"id": "x", "type": "shaft"}):
            self.assertEqual(self.post({"closures": [bad]}).status_code, 400, bad)


if __name__ == "__main__":
    unittest.main()
