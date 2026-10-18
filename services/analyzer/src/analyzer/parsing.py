"""Parse Python source files with :mod:`ast` without executing them.

Parse failures are reported as diagnostics so a single broken file does not
abort analysis of the rest of the project.
"""

from __future__ import annotations

import ast
from typing import List, Optional

from .models import Diagnostic, SourceLocation


def parse_file(abs_path: str, rel_path: str, diagnostics: List[Diagnostic]) -> Optional[ast.Module]:
    """Parse ``abs_path`` and return the AST, or ``None`` on failure.

    ``rel_path`` is the workspace-relative POSIX path used in diagnostics.
    """
    try:
        with open(abs_path, "r", encoding="utf-8") as handle:
            source = handle.read()
    except OSError as exc:
        diagnostics.append(
            Diagnostic(
                severity="error",
                code="read_error",
                message=f"Could not read {rel_path}: {exc}",
                source=SourceLocation(rel_path, 1),
            )
        )
        return None

    try:
        return ast.parse(source, filename=rel_path)
    except SyntaxError as exc:
        line = exc.lineno or 1
        diagnostics.append(
            Diagnostic(
                severity="error",
                code="parse_error",
                message=f"Could not parse {rel_path}: {exc.msg} (line {line})",
                source=SourceLocation(rel_path, line),
            )
        )
        return None
    except (ValueError, RecursionError) as exc:
        diagnostics.append(
            Diagnostic(
                severity="error",
                code="parse_error",
                message=f"Could not parse {rel_path}: {exc}",
                source=SourceLocation(rel_path, 1),
            )
        )
        return None
