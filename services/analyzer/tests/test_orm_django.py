"""Tests for Django ORM model discovery (models only, no URL routing)."""

import unittest

from tests.support import analyze_fixture


class DjangoModelTests(unittest.TestCase):
    def setUp(self):
        self.result = analyze_fixture("django_app")
        self.nodes = {node["id"]: node for node in self.result["nodes"]}

    def test_models_discovered(self):
        models = sorted(n["id"] for n in self.result["nodes"] if n["type"] == "database_model")
        self.assertEqual(
            models,
            ["database_model:models:Author", "database_model:models:Book"],
        )
        for model_id in models:
            self.assertEqual(self.nodes[model_id]["details"]["framework"], "django")

    def test_fields_discovered(self):
        fields = sorted(n["id"] for n in self.result["nodes"] if n["type"] == "database_field")
        self.assertIn("database_field:models:Author.name", fields)
        self.assertIn("database_field:models:Book.title", fields)
        self.assertIn("database_field:models:Book.author", fields)
        author_field = self.nodes["database_field:models:Book.author"]
        self.assertEqual(author_field["details"]["kind"], "foreign_key")
        self.assertEqual(author_field["details"]["targetHint"], "Author")

    def test_foreign_key_edge_confirmed(self):
        edges = [e for e in self.result["edges"] if e["type"] == "orm_relationship"]
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["source"], "database_model:models:Book")
        self.assertEqual(edges[0]["target"], "database_model:models:Author")
        self.assertEqual(edges[0]["status"], "confirmed")

    def test_no_django_routing_analysis(self):
        # Django URL routing is out of scope: no endpoint nodes may appear.
        endpoints = [n for n in self.result["nodes"] if n["type"] == "endpoint"]
        self.assertEqual(endpoints, [])


if __name__ == "__main__":
    unittest.main()
