"""Shared helpers for analyzer tests."""

import os

from analyzer import analyzer as analyzer_module

FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def analyze_fixture(name, extra_excludes=None):
    """Run the analyzer on a fixture project and return the result dict."""
    root = os.path.join(FIXTURES_DIR, name)
    return analyzer_module.analyze(root)
