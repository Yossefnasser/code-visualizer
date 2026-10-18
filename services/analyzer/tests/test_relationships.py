"""Tests for missing/ambiguous handler-service relationships and unresolved symbols."""

import unittest

from tests.support import analyze_fixture


class AmbiguousRelationshipTests(unittest.TestCase):
    def setUp(self):
        self.result = analyze_fixture("ambiguous")
        self.nodes = {node["id"]: node for node in self.result["nodes"]}
        self.codes = {d["code"] for d in self.result["diagnostics"]}

    def test_resolvable_routes_still_created(self):
        endpoints = sorted(n["label"] for n in self.result["nodes"] if n["type"] == "endpoint")
        self.assertEqual(endpoints, ["GET /a", "GET /b", "GET /missing"])

    def test_unresolved_imported_call_becomes_unresolved_edge(self):
        edges = [e for e in self.result["edges"] if e["status"] == "unresolved"]
        targets = {e["target"] for e in edges}
        self.assertIn("function:external_lib:mystery_function", targets)
        self.assertIn("function:app.services:missing_service.do_work", targets)
        for edge in edges:
            self.assertEqual(edge["type"], "calls")
            self.assertTrue(edge["evidence"])

    def test_unresolved_targets_are_placeholder_nodes(self):
        placeholder = self.nodes["function:external_lib:mystery_function"]
        self.assertTrue(placeholder["details"]["unresolved"])
        self.assertNotIn("source", placeholder)

    def test_unimported_unknown_names_are_not_invented(self):
        edges = [e for e in self.result["edges"] if e["status"] == "unresolved"]
        targets = {e["target"] for e in edges}
        # ``undefined_local_thing`` is neither imported nor defined: no edge, no node.
        self.assertNotIn("function:unresolved:api:undefined_local_thing", targets)
        self.assertFalse(any("undefined_local_thing" in node_id for node_id in self.nodes))

    def test_unresolved_call_diagnostics_emitted(self):
        self.assertIn("unresolved_call", self.codes)

    def test_unrecognized_router_object_reported(self):
        self.assertIn("unsupported_route_pattern", self.codes)
        # The ``@blueprint.get`` route must not become an endpoint.
        self.assertNotIn("endpoint:weird_decorator:GET:/nope", self.nodes)


if __name__ == "__main__":
    unittest.main()
