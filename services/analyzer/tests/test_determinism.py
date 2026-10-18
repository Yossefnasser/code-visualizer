"""Determinism tests: identical input must produce identical output."""

import json
import unittest

from tests.support import analyze_fixture


class DeterminismTests(unittest.TestCase):
    def test_repeated_runs_are_identical(self):
        first = analyze_fixture("fastapi_app")
        second = analyze_fixture("fastapi_app")
        self.assertEqual(
            json.dumps(first, sort_keys=True),
            json.dumps(second, sort_keys=True),
        )

    def test_excluded_directory_content_is_not_analyzed(self):
        result = analyze_fixture("with_excluded")
        node_ids = {n["id"] for n in result["nodes"]}
        self.assertIn("module:valid", node_ids)
        self.assertFalse(any("hidden" in node_id for node_id in node_ids))
        self.assertFalse(any("cached" in node_id for node_id in node_ids))
        self.assertFalse(any("packaged" in node_id for node_id in node_ids))
        skipped = [d for d in result["diagnostics"] if d["code"] == "skipped_directory"]
        self.assertEqual(len(skipped), 3)

    def test_node_ids_are_deterministic_and_unique(self):
        result = analyze_fixture("fastapi_app")
        ids = [n["id"] for n in result["nodes"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(ids, sorted(ids))


if __name__ == "__main__":
    unittest.main()
