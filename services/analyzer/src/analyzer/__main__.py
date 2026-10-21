"""Command-line entry point.

Usage (from ``services/analyzer``)::

    python -m analyzer <project_root> [--output FILE] [--exclude DIR]...

Logs go to stderr so stdout stays pure JSON.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from . import analyzer as analyzer_module
from .models import AnalyzerError


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="analyzer",
        description="Analyze a Python project and emit architecture graph JSON.",
    )
    parser.add_argument("root", help="Path to the Python project root to analyze.")
    parser.add_argument(
        "--output",
        "-o",
        default=None,
        help="Optional path to write JSON output; defaults to stdout.",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        metavar="DIR",
        help="Additional directory name to exclude (repeatable).",
    )
    parser.add_argument(
        "--index",
        action="store_true",
        help="Emit the deterministic index document (for the AI analysis "
        "pipeline) instead of the architecture graph.",
    )
    args = parser.parse_args(argv)

    print(f"Analyzing {args.root}", file=sys.stderr)
    try:
        if args.index:
            from .indexer import build_index

            result = build_index(args.root, extra_excludes=args.exclude)
        else:
            result = analyzer_module.analyze(args.root, extra_excludes=args.exclude)
    except AnalyzerError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    payload = json.dumps(result, indent=2)
    if args.output:
        output_dir = os.path.dirname(os.path.abspath(args.output))
        os.makedirs(output_dir, exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(payload + "\n")
        print(f"Wrote analysis result to {args.output}", file=sys.stderr)
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
