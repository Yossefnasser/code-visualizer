"""Data structures for analyzer output.

The serialized shapes follow ``docs/ARCHITECTURE_DATA_MODEL.md``
(``schemaVersion`` 1.0). Serialization is deterministic: nodes, edges, and
diagnostics are sorted by stable keys before being emitted.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

SCHEMA_VERSION = "1.0"

NODE_TYPES = frozenset(
    {
        "endpoint",
        "service",
        "function",
        "class",
        "module",
        "database_model",
        "database_field",
    }
)

EDGE_TYPES = frozenset(
    {
        "route_handler",
        "calls",
        "uses_model",
        "orm_relationship",
        "imports",
    }
)

EVIDENCE_STATUSES = frozenset({"confirmed", "inferred", "unresolved"})

DIAGNOSTIC_SEVERITIES = frozenset({"info", "warning", "error"})


class AnalyzerError(Exception):
    """Raised for fatal analyzer problems (e.g. a missing project root)."""


@dataclass
class SourceLocation:
    """Workspace-relative source location with one-based line numbers."""

    path: str
    start_line: int
    end_line: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {"path": self.path, "startLine": self.start_line}
        if self.end_line is not None:
            data["endLine"] = self.end_line
        return data

    def sort_key(self) -> tuple:
        return (self.path, self.start_line, self.end_line or 0)


@dataclass
class Evidence:
    """Evidence record explaining why a node or edge exists."""

    kind: str
    description: str
    source: Optional[SourceLocation] = None
    metadata: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {"kind": self.kind, "description": self.description}
        if self.source is not None:
            data["source"] = self.source.to_dict()
        if self.metadata:
            data["metadata"] = self.metadata
        return data

    def sort_key(self) -> tuple:
        return (
            self.kind,
            self.description,
            self.source.sort_key() if self.source else ("", 0, 0),
        )


@dataclass
class Node:
    id: str
    type: str
    label: str
    details: Dict[str, Any] = field(default_factory=dict)
    source: Optional[SourceLocation] = None
    evidence: List[Evidence] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {"id": self.id, "type": self.type, "label": self.label}
        if self.details:
            data["details"] = self.details
        if self.source is not None:
            data["source"] = self.source.to_dict()
        if self.evidence:
            data["evidence"] = [e.to_dict() for e in sorted(self.evidence, key=lambda e: e.sort_key())]
        return data


@dataclass
class Edge:
    id: str
    source: str
    target: str
    type: str
    status: str
    evidence: List[Evidence] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "id": self.id,
            "source": self.source,
            "target": self.target,
            "type": self.type,
            "status": self.status,
        }
        if self.evidence:
            data["evidence"] = [e.to_dict() for e in sorted(self.evidence, key=lambda e: e.sort_key())]
        return data


@dataclass
class Diagnostic:
    severity: str
    code: str
    message: str
    source: Optional[SourceLocation] = None

    def to_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "severity": self.severity,
            "code": self.code,
            "message": self.message,
        }
        if self.source is not None:
            data["source"] = self.source.to_dict()
        return data

    def sort_key(self) -> tuple:
        return (
            self.code,
            self.message,
            self.source.sort_key() if self.source else ("", 0, 0),
        )


@dataclass
class AnalysisResult:
    project_root: str
    nodes: List[Node] = field(default_factory=list)
    edges: List[Edge] = field(default_factory=list)
    diagnostics: List[Diagnostic] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        diagnostics: List[Diagnostic] = []
        seen = set()
        for diag in self.diagnostics:
            key = (diag.severity, diag.code, diag.message, diag.source.sort_key() if diag.source else None)
            if key not in seen:
                seen.add(key)
                diagnostics.append(diag)
        return {
            "schemaVersion": SCHEMA_VERSION,
            "project": {"root": self.project_root, "language": "python"},
            "nodes": [n.to_dict() for n in sorted(self.nodes, key=lambda n: n.id)],
            "edges": [e.to_dict() for e in sorted(self.edges, key=lambda e: e.id)],
            "diagnostics": [d.to_dict() for d in sorted(diagnostics, key=lambda d: d.sort_key())],
        }
