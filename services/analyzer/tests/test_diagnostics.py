"""Tests for diagnostics on invalid or partially unsupported Python syntax."""

import unittest

from tests.support import analyze_fixture


class DiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.result = analyze_fixture("broken_syntax")
        self.codes = {d["code"] for d in self.result["diagnostics"]}

    def test_parse_error_reported(self):
        self.assertIn("parse_error", self.codes)
        parse_errors = [d for d in self.result["diagnostics"] if d["code"] == "parse_error"]
        self.assertEqual(parse_errors[0]["source"]["path"], "bad.py")
        self.assertGreaterEqual(parse_errors[0]["source"]["startLine"], 1)

    def test_other_files_still_analyzed(self):
        node_ids = {n["id"] for n in self.result["nodes"]}
        self.assertIn("module:good", node_ids)
        self.assertIn("function:good:ok_function", node_ids)

    def test_broken_file_produces_no_nodes(self):
        node_ids = {n["id"] for n in self.result["nodes"]}
        self.assertNotIn("module:bad", node_ids)

    def test_valid_fixture_has_no_error_diagnostics(self):
        result = analyze_fixture("fastapi_app")
        errors = [d for d in result["diagnostics"] if d["severity"] == "error"]
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
