"""Accumulates nodes, edges, and symbol lookups for one analysis run."""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from .models import AnalysisResult, Edge, Evidence, Node


class AnalysisBuilder:
    def __init__(self) -> None:
        self._nodes: Dict[str, Node] = {}
        self._symbols: Dict[Tuple[str, str], str] = {}
        self._edges: Dict[Tuple[str, str, str], Edge] = {}

    # -- symbols -----------------------------------------------------------

    def register_symbol(self, module: str, qualname: str, node_id: str) -> None:
        self._symbols.setdefault((module, qualname), node_id)

    def lookup_symbol(self, module: str, qualname: str) -> Optional[str]:
        return self._symbols.get((module, qualname))

    # -- nodes and edges ---------------------------------------------------

    def add_node(self, node: Node) -> Node:
        """Add ``node``; if the ID already exists, merge evidence and details."""
        existing = self._nodes.get(node.id)
        if existing is None:
            self._nodes[node.id] = node
            return node
        existing.evidence.extend(node.evidence)
        for key, value in node.details.items():
            existing.details.setdefault(key, value)
        return existing

    def add_edge(
        self,
        edge_type: str,
        source: str,
        target: str,
        status: str,
        evidence: Optional[List[Evidence]] = None,
    ) -> Edge:
        """Add an edge; repeated (type, source, target) pairs merge evidence."""
        key = (edge_type, source, target)
        edge = self._edges.get(key)
        if edge is None:
            edge = Edge(
                id=f"{edge_type}:{source}->{target}",
                source=source,
                target=target,
                type=edge_type,
                status=status,
            )
            self._edges[key] = edge
        if evidence:
            edge.evidence.extend(evidence)
        return edge

    # -- output ------------------------------------------------------------

    def result(self, project_root: str, diagnostics: List) -> AnalysisResult:
        return AnalysisResult(
            project_root=project_root,
            nodes=list(self._nodes.values()),
            edges=list(self._edges.values()),
            diagnostics=list(diagnostics),
        )
