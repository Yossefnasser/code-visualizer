"""ORM adapter interface and shared helpers.

Each adapter discovers ORM models for one framework. Adapters operate purely
on parsed AST symbols; they never import or execute the analyzed project.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from ..models import SourceLocation


@dataclass
class FieldInfo:
    name: str
    type_str: Optional[str]
    line: int
    kind: str  # column | relationship | foreign_key | one_to_one | many_to_many
    target_hint: Optional[str] = None  # referenced model for relationship-ish fields


@dataclass
class ModelInfo:
    adapter: str
    module: str
    name: str
    path: str
    node_id: str
    table_name: Optional[str] = None
    fields: List[FieldInfo] = field(default_factory=list)


class ModelIndex:
    """Lookup helpers for resolving relationship target hints across models."""

    def __init__(self, models: List[ModelInfo]) -> None:
        self.by_symbol: Dict[tuple, ModelInfo] = {(m.module, m.name): m for m in models}
        self.by_table: Dict[str, ModelInfo] = {m.table_name: m for m in models if m.table_name}
        self.by_name: Dict[str, List[ModelInfo]] = {}
        for model in models:
            self.by_name.setdefault(model.name, []).append(model)

    def resolve_hint(self, hint: Optional[str]) -> Optional[ModelInfo]:
        """Resolve a relationship target hint to a model, or ``None``.

        Supported hint shapes: ``ClassName``, ``module.ClassName``,
        ``table``, and ``table.column`` (as used in ``ForeignKey`` strings).
        Ambiguous hints resolve to ``None`` rather than a guess.
        """
        if not hint:
            return None
        hint = hint.strip().strip("'\"")
        if not hint:
            return None
        if hint in self.by_table:
            return self.by_table[hint]

        parts = hint.split(".")
        for index in range(len(parts) - 1, 0, -1):
            head = ".".join(parts[:index])
            tail = ".".join(parts[index:])
            head_model = self.by_table.get(head)
            if head_model is not None:
                return head_model
            symbol_model = self.by_symbol.get((head, tail))
            if symbol_model is not None:
                return symbol_model
            candidates = [
                candidate
                for candidate in self.by_name.get(tail, [])
                if candidate.module == head or candidate.module.endswith("." + head)
            ]
            if len(candidates) == 1:
                return candidates[0]

        candidates = self.by_name.get(hint, [])
        if len(candidates) == 1:
            return candidates[0]
        return None


class ORMAdapter:
    """Base interface for framework-specific ORM model discovery."""

    name = "orm"

    def module_imports_orm(self, ms) -> bool:
        raise NotImplementedError

    def discover_models(self, registry, ms, builder, diagnostics) -> List[ModelInfo]:
        """Discover ORM models in ``ms``, creating nodes; return model info."""
        raise NotImplementedError

    def resolve_relationships(self, registry, models: List[ModelInfo], builder, diagnostics) -> None:
        """Create model-to-model relationship edges for discovered models."""
        raise NotImplementedError


def make_unresolved_relationship_diagnostic(adapter_name, model, field, hint):
    from ..models import Diagnostic

    return Diagnostic(
        severity="warning",
        code="unresolved_orm_relationship",
        message=(
            f"Could not resolve {adapter_name} relationship target '{hint}' declared on "
            f"{model.module}.{model.name}.{field.name} in {model.path}:{field.line}."
        ),
        source=SourceLocation(model.path, field.line),
    )
