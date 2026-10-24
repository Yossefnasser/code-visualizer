"""Index document tests: shape, determinism, hints, and no rule-based pass."""

import json
import unittest

from tests.support import index_fixture

INDEX_KEYS = {
    "schemaVersion",
    "root",
    "language",
    "digest",
    "files",
    "endpoints",
    "routeBindings",
    "models",
    "ormRelationships",
    "references",
    "reverseReferences",
    "diagnostics",
}


class IndexerTests(unittest.TestCase):
    def test_index_shape_and_schema_version(self):
        doc = index_fixture("fastapi_app")
        self.assertEqual(set(doc.keys()), INDEX_KEYS)
        self.assertEqual(doc["schemaVersion"], "1.1")
        self.assertEqual(doc["language"], "python")
        self.assertIn("reverseReferences", doc)
        digest = doc["digest"]
        self.assertIn("tree", digest)
        self.assertIn("manifest", digest)
        self.assertEqual(
            set(digest["counts"].keys()),
            {
                "files",
                "totalLines",
                "endpoints",
                "models",
                "ormRelationships",
                "references",
                "diagnostics",
            },
        )

    def test_index_is_deterministic(self):
        first = index_fixture("fastapi_app")
        second = index_fixture("fastapi_app")
        self.assertEqual(
            json.dumps(first, sort_keys=True),
            json.dumps(second, sort_keys=True),
        )

    def test_index_contains_no_rule_based_analysis_output(self):
        doc = index_fixture("fastapi_app")
        # The legacy rule-based engine emitted nodes/edges/relationships; the
        # index document must never contain them (ARCHITECTURE.md section 9).
        for legacy_key in ("nodes", "edges", "relationships", "components"):
            self.assertNotIn(legacy_key, doc)
        # Relationships exist only as framework hints with explicit provenance,
        # never with rule-based confidence labels.
        for rel in doc["ormRelationships"]:
            self.assertNotIn("confidence", rel)
            self.assertNotIn("evidence", rel)

    def test_fastapi_hints_are_present(self):
        doc = index_fixture("fastapi_app")
        self.assertGreaterEqual(len(doc["endpoints"]), 1)
        endpoint = doc["endpoints"][0]
        self.assertTrue(endpoint["path"])
        self.assertTrue(endpoint["methods"])
        self.assertTrue(endpoint["sourcePath"])
        self.assertIsNotNone(endpoint["line"])

        self.assertGreaterEqual(len(doc["routeBindings"]), 1)
        binding = doc["routeBindings"][0]
        self.assertIn("endpointId", binding)
        self.assertIn("handlerQualname", binding)

        self.assertGreaterEqual(len(doc["models"]), 1)
        model = doc["models"][0]
        self.assertTrue(model["name"])
        self.assertGreaterEqual(len(model["fields"]), 1)
        self.assertIn("name", model["fields"][0])

        self.assertGreaterEqual(len(doc["ormRelationships"]), 1)
        rel = doc["ormRelationships"][0]
        self.assertIn("sourceId", rel)
        self.assertIn("targetId", rel)

    def test_references_resolve_across_modules(self):
        doc = index_fixture("fastapi_app")
        self.assertGreaterEqual(len(doc["references"]), 1)
        for ref in doc["references"]:
            self.assertTrue(ref["sourceModule"])
            self.assertTrue(ref["targetModule"])
            self.assertNotEqual(
                (ref["sourceModule"], ref["sourceQualname"]),
                (ref["targetModule"], ref["targetQualname"]),
            )
            self.assertIsInstance(ref["line"], int)

    def test_digest_matches_document_counts(self):
        doc = index_fixture("fastapi_app")
        counts = doc["digest"]["counts"]
        self.assertEqual(counts["files"], len(doc["files"]))
        self.assertEqual(counts["endpoints"], len(doc["endpoints"]))
        self.assertEqual(counts["models"], len(doc["models"]))
        self.assertEqual(counts["references"], len(doc["references"]))
        self.assertEqual(len(doc["digest"]["manifest"]), len(doc["files"]))

    def test_symbols_have_stable_ids(self):
        doc = index_fixture("fastapi_app")
        for file_doc in doc["files"]:
            for symbol in file_doc["symbols"]:
                self.assertIn("id", symbol)
                self.assertTrue(symbol["id"])
                if symbol["kind"] == "class":
                    self.assertTrue(symbol["id"].startswith("class:"))
                elif symbol["kind"] == "function":
                    self.assertTrue(symbol["id"].startswith("function:"))

    def test_files_have_language_field(self):
        doc = index_fixture("fastapi_app")
        for file_doc in doc["files"]:
            self.assertEqual(file_doc["language"], "python")

    def test_reverse_references_exist_and_sorted(self):
        doc = index_fixture("fastapi_app")
        self.assertIn("reverseReferences", doc)
        rev = doc["reverseReferences"]
        self.assertIsInstance(rev, dict)
        # Check that reverse references are sorted
        for target_key, refs in rev.items():
            for i in range(len(refs) - 1):
                a = refs[i]
                b = refs[i + 1]
                self.assertLessEqual(
                    (a["sourceModule"], a["sourceQualname"], a["line"]),
                    (b["sourceModule"], b["sourceQualname"], b["line"]),
                )


if __name__ == "__main__":
    unittest.main()
