"""Code Visualizer Python analyzer.

Static, AST-based analysis of Python backends. The analyzer never imports or
executes the project it inspects; it only parses source files with the
standard-library ``ast`` module and emits JSON conforming to
``docs/ARCHITECTURE_DATA_MODEL.md``.
"""

from .analyzer import analyze
from .models import SCHEMA_VERSION, AnalyzerError

__all__ = ["analyze", "AnalyzerError", "SCHEMA_VERSION"]
