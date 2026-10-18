"""Tests for FastAPI route discovery and handler relationships."""

import unittest

from tests.support import analyze_fixture


class FastAPIRouteTests(unittest.TestCase):
    def setUp(self):
        self.result = analyze_fixture("fastapi_app")
        self.nodes = {node["id"]: node for node in self.result["nodes"]}

    def test_endpoints_discovered(self):
        endpoints = [n for n in self.result["nodes"] if n["type"] == "endpoint"]
        self.assertEqual(
            sorted(e["label"] for e in endpoints),
            ["GET /users", "GET /users/{user_id}"],
        )
        for endpoint in endpoints:
            self.assertEqual(endpoint["details"]["framework"], "fastapi")
            self.assertIn("handler", endpoint["details"])

    def test_route_handler_edges_are_confirmed(self):
        edges = [e for e in self.result["edges"] if e["type"] == "route_handler"]
        self.assertEqual(len(edges), 2)
        for edge in edges:
            self.assertEqual(edge["status"], "confirmed")
            self.assertIn(edge["source"], self.nodes)
            self.assertEqual(self.nodes[edge["target"]]["type"], "service" if "service:" in edge["target"] else "function")
        # Handlers live in app/api/users.py, which is not a service module.
        for edge in edges:
            self.assertTrue(edge["target"].startswith("function:app.api.users:"))

    def test_handler_to_service_calls_are_inferred(self):
        calls = [e for e in self.result["edges"] if e["type"] == "calls" and e["status"] == "inferred"]
        targets = {e["target"] for e in calls}
        self.assertIn("service:app.services.user_service:list_users", targets)
        self.assertIn("service:app.services.user_service:get_user", targets)

    def test_service_uses_model(self):
        uses = [e for e in self.result["edges"] if e["type"] == "uses_model"]
        self.assertTrue(
            any(e["target"] == "database_model:app.models.user:User" for e in uses)
        )
        for edge in uses:
            self.assertEqual(edge["status"], "inferred")


if __name__ == "__main__":
    unittest.main()
