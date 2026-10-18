"""Contract-conformance tests for analyzer output (docs/ARCHITECTURE_DATA_MODEL.md)."""

import json
import unittest

from tests.support import FIXTURES_DIR, analyze_fixture

ALLOWED_NODE_TYPES = {
    "endpoint", "service", "function", "class", "module",
    "database_model", "database_field",
}
ALLOWED_EDGE_TYPES = {"route_handler", "calls", "uses_model", "orm_relationship", "imports"}
ALLOWED_STATUSES = {"confirmed", "inferred", "unresolved"}
ALLOWED_SEVERITIES = {"info", "warning", "error"}

ALL_FIXTURES = ["fastapi_app", "sqlalchemy_only", "django_app", "ambiguous", "broken_syntax", "with_excluded"]


class ContractConformanceTests(unittest.TestCase):
    def test_top_level_shape_for_all_fixtures(self):
        for name in ALL_FIXTURES:
            with self.subTest(fixture=name):
                result = analyze_fixture(name)
                self.assertEqual(
                    set(result.keys()),
                    {"schemaVersion", "project", "nodes", "edges", "diagnostics"},
                )
                self.assertEqual(result["schemaVersion"], "1.0")
                self.assertEqual(result["project"]["language"], "python")

    def test_node_and_edge_shapes(self):
        for name in ALL_FIXTURES:
            with self.subTest(fixture=name):
                result = analyze_fixture(name)
                node_ids = set()
                for node in result["nodes"]:
                    self.assertIn("id", node)
                    self.assertIn("type", node)
                    self.assertIn("label", node)
                    self.assertIn(node["type"], ALLOWED_NODE_TYPES)
                    if "source" in node:
                        self.assertIn("path", node["source"])
                        self.assertGreaterEqual(node["source"]["startLine"], 1)
                    node_ids.add(node["id"])
                self.assertEqual(len(node_ids), len(result["nodes"]), "node ids must be unique")
                for edge in result["edges"]:
                    self.assertIn("id", edge)
                    self.assertIn("source", edge)
                    self.assertIn("target", edge)
                    self.assertIn(edge["type"], ALLOWED_EDGE_TYPES)
                    self.assertIn(edge["status"], ALLOWED_STATUSES)
                    self.assertIn(edge["source"], node_ids, "edge source must be a known node")
                    self.assertIn(edge["target"], node_ids, "edge target must be a known node")
                edge_ids = [edge["id"] for edge in result["edges"]]
                self.assertEqual(len(edge_ids), len(set(edge_ids)), "edge ids must be unique")

    def test_diagnostics_shapes(self):
        result = analyze_fixture("broken_syntax")
        for diagnostic in result["diagnostics"]:
            self.assertIn(diagnostic["severity"], ALLOWED_SEVERITIES)
            self.assertIn("code", diagnostic)
            self.assertIn("message", diagnostic)

    def test_output_is_json_serializable(self):
        result = analyze_fixture("fastapi_app")
        self.assertIsInstance(json.dumps(result), str)

    def test_sample_output_fixture_matches_current_output(self):
        """The committed sample output must match analyzer behavior.

        ``project.root`` echoes the caller-supplied path, which differs between
        this test (absolute fixture path) and the CLI invocation used to
        generate the sample; normalize it before comparing.
        """
        import os

        sample_path = os.path.join(
            os.path.dirname(os.path.dirname(FIXTURES_DIR)), "examples", "fastapi_app.result.json"
        )
        with open(sample_path, "r", encoding="utf-8") as handle:
            sample = json.load(handle)
        actual = analyze_fixture("fastapi_app")
        sample["project"]["root"] = actual["project"]["root"]
        self.assertEqual(sample, actual)


if __name__ == "__main__":
    unittest.main()
