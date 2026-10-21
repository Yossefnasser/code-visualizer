"""Shared helpers for analyzer tests."""

import os

from analyzer import analyzer as analyzer_module
from analyzer.indexer import build_index

FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def analyze_fixture(name, extra_excludes=None):
    """Run the analyzer on a fixture project and return the result dict."""
    root = os.path.join(FIXTURES_DIR, name)
    return analyzer_module.analyze(root)


def index_fixture(name):
    """Build the index document for a fixture project."""
    root = os.path.join(FIXTURES_DIR, name)
    return build_index(root)
