"""Tests for Python file discovery and directory exclusion."""

import unittest

from analyzer import discovery
from tests.support import FIXTURES_DIR


class DiscoveryTests(unittest.TestCase):
    def test_excluded_directories_are_skipped(self):
        import os

        root = os.path.join(FIXTURES_DIR, "with_excluded")
        files, skipped = discovery.discover_python_files(root)
        self.assertEqual(files, ["valid.py"])
        self.assertEqual(skipped, [".venv", "__pycache__", "node_modules"])

    def test_extra_excludes_are_honored(self):
        import os

        root = os.path.join(FIXTURES_DIR, "with_excluded")
        files, skipped = discovery.discover_python_files(root, extra_excludes=["valid.py"])
        self.assertEqual(files, [])
        self.assertEqual(skipped, [".venv", "__pycache__", "node_modules"])

    def test_result_is_sorted(self):
        import os

        root = os.path.join(FIXTURES_DIR, "fastapi_app")
        files, _ = discovery.discover_python_files(root)
        self.assertEqual(files, sorted(files))


if __name__ == "__main__":
    unittest.main()
