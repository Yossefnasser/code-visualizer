"""Python file discovery with deterministic ordering and directory exclusions."""

from __future__ import annotations

import os
from typing import List, Optional, Sequence, Tuple

DEFAULT_EXCLUDED_DIRS = frozenset(
    {
        ".venv",
        "venv",
        "env",
        ".env",
        "virtualenv",
        "__pycache__",
        ".git",
        ".hg",
        ".svn",
        "node_modules",
        "site-packages",
        ".tox",
        ".nox",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".eggs",
        "build",
        "dist",
        "target",
        ".cache",
        ".idea",
        ".vscode",
    }
)


def _posix(path: str) -> str:
    return path.replace(os.sep, "/")


def discover_python_files(
    root: str,
    extra_excludes: Optional[Sequence[str]] = None,
) -> Tuple[List[str], List[str]]:
    """Return ``(python_files, skipped_directories)`` for ``root``.

    Both lists contain workspace-relative POSIX-style paths and are sorted
    deterministically. Exclusions match directory names and file base names.
    Excluded directories are pruned before traversal so their contents are
    never visited, and each pruned directory is reported once so callers can
    emit ``skipped_directory`` diagnostics.
    """
    excluded = set(DEFAULT_EXCLUDED_DIRS)
    excluded.update(extra_excludes or [])

    files: List[str] = []
    skipped: List[str] = []
    root_abs = os.path.abspath(root)

    for dirpath, dirnames, filenames in os.walk(root_abs):
        dirnames.sort()
        filenames.sort()
        keep: List[str] = []
        for dirname in dirnames:
            if dirname in excluded:
                skipped.append(_posix(os.path.relpath(os.path.join(dirpath, dirname), root_abs)))
            else:
                keep.append(dirname)
        dirnames[:] = keep

        for filename in filenames:
            if not filename.endswith(".py") or filename in excluded:
                continue
            rel = _posix(os.path.relpath(os.path.join(dirpath, filename), root_abs))
            files.append(rel)

    files.sort()
    skipped.sort()
    return files, skipped
