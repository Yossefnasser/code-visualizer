"""Tests for SQLAlchemy model discovery."""

import unittest

from tests.support import analyze_fixture


class SQLAlchemyModelTests(unittest.TestCase):
    def setUp(self):
        self.result = analyze_fixture("sqlalchemy_only")
        self.nodes = {node["id"]: node for node in self.result["nodes"]}

    def test_models_discovered(self):
        models = sorted(n["id"] for n in self.result["nodes"] if n["type"] == "database_model")
        self.assertEqual(
            models,
            ["database_model:models:Account", "database_model:models:Order"],
        )
        for model_id in models:
            self.assertEqual(self.nodes[model_id]["details"]["framework"], "sqlalchemy")
            self.assertIn("table", self.nodes[model_id]["details"])

    def test_fields_discovered(self):
        fields = sorted(n["id"] for n in self.result["nodes"] if n["type"] == "database_field")
        self.assertIn("database_field:models:Account.id", fields)
        self.assertIn("database_field:models:Account.name", fields)
        self.assertIn("database_field:models:Account.orders", fields)
        self.assertIn("database_field:models:Order.account_id", fields)
        self.assertEqual(self.nodes["database_field:models:Account.id"]["details"]["model"],
                         "database_model:models:Account")

    def test_relationship_edges_confirmed(self):
        edges = [e for e in self.result["edges"] if e["type"] == "orm_relationship"]
        pairs = {(e["source"], e["target"]) for e in edges}
        self.assertEqual(
            pairs,
            {
                ("database_model:models:Account", "database_model:models:Order"),
                ("database_model:models:Order", "database_model:models:Account"),
            },
        )
        for edge in edges:
            self.assertEqual(edge["status"], "confirmed")
            self.assertTrue(edge["evidence"])
        # The Account->Order edge comes from relationship("Order") on Account;
        # the Order->Account edge must exist via both relationship("Account")
        # and ForeignKey("accounts.id").
        reverse_evidence = [
            e for e in edges
            if e["source"] == "database_model:models:Order"
        ]
        kinds = {ev["kind"] for e in reverse_evidence for ev in e["evidence"]}
        self.assertIn("sqlalchemy_relationship", kinds)

    def test_no_unresolved_relationship_diagnostics(self):
        codes = {d["code"] for d in self.result["diagnostics"]}
        self.assertNotIn("unresolved_orm_relationship", codes)

    def test_models_are_not_duplicated_as_class_nodes(self):
        class_ids = {n["id"] for n in self.result["nodes"] if n["type"] == "class"}
        self.assertNotIn("class:models:Account", class_ids)


if __name__ == "__main__":
    unittest.main()
