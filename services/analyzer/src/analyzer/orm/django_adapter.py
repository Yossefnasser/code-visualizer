"""Django ORM adapter: model and field discovery (models only, no URL routing)."""

from __future__ import annotations

import ast
from typing import List, Optional, Tuple

from .. import symbols
from ..models import Evidence, Node, SourceLocation
from .base import FieldInfo, ModelInfo, ModelIndex, ORMAdapter, make_unresolved_relationship_diagnostic

RELATIONSHIP_FIELD_KINDS = {
    "ForeignKey": "foreign_key",
    "OneToOneField": "one_to_one",
    "ManyToManyField": "many_to_many",
}

FIELD_SUFFIXES = frozenset(
    {
        "AutoField", "BigAutoField", "BigIntegerField", "BooleanField", "CharField",
        "DateField", "DateTimeField", "DecimalField", "DurationField", "EmailField",
        "FileField", "FloatField", "GenericIPAddressField", "IntegerField", "JSONField",
        "SlugField", "SmallIntegerField", "TextField", "TimeField", "URLField", "UUIDField",
    }
    | set(RELATIONSHIP_FIELD_KINDS)
)


def _first_argument(call: ast.Call) -> Optional[str]:
    """First positional argument as a constant string or bare name."""
    if call.args:
        first = call.args[0]
        if isinstance(first, ast.Constant) and isinstance(first.value, str):
            return first.value
        if isinstance(first, ast.Name):
            return first.id
    for keyword in call.keywords:
        if keyword.arg == "to":
            value = keyword.value
            if isinstance(value, ast.Constant) and isinstance(value.value, str):
                return value.value
            if isinstance(value, ast.Name):
                return value.id
    return None


class DjangoAdapter(ORMAdapter):
    name = "django"

    def module_imports_orm(self, ms) -> bool:
        return any((ref.module or "").startswith("django.db") for ref in ms.imports.values())

    def _is_model(self, registry, ms, class_info) -> bool:
        for base in class_info.bases:
            resolved = registry.resolve_dotted(ms, base)
            if resolved is None:
                continue
            target_module, target_qual = resolved
            if target_module.startswith("django.db") and target_qual.split(".")[-1] == "Model":
                return True
        return False

    def _fields(self, class_info) -> List[Tuple[str, ast.Call, int]]:
        results = []
        for stmt in class_info.node.body:
            target = None
            value = None
            if isinstance(stmt, ast.Assign):
                if len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
                    target, value = stmt.targets[0].id, stmt.value
            elif isinstance(stmt, ast.AnnAssign):
                if isinstance(stmt.target, ast.Name) and isinstance(stmt.value, ast.Call):
                    target, value = stmt.target.id, stmt.value
            if target is None or not isinstance(value, ast.Call):
                continue
            results.append((target, value, stmt.lineno))
        return results

    def discover_models(self, registry, ms, builder, diagnostics) -> List[ModelInfo]:
        if not self.module_imports_orm(ms):
            return []
        models: List[ModelInfo] = []
        for class_name in sorted(ms.classes):
            class_info = ms.classes[class_name]
            if not self._is_model(registry, ms, class_info):
                continue
            node_id = f"database_model:{ms.module}:{class_name}"
            builder.add_node(
                Node(
                    id=node_id,
                    type="database_model",
                    label=class_name,
                    details={"framework": "django"},
                    source=SourceLocation(ms.path, class_info.start, class_info.end),
                    evidence=[
                        Evidence(
                            kind="django_model_class",
                            description="Class inherits from django.db.models.Model",
                            source=SourceLocation(ms.path, class_info.start),
                        )
                    ],
                )
            )
            builder.register_symbol(ms.module, class_name, node_id)

            fields: List[FieldInfo] = []
            for field_name, call, line in self._fields(class_info):
                dotted = symbols.dotted_name(call.func)
                if dotted is None:
                    continue
                leaf = dotted.split(".")[-1]
                resolved = registry.resolve_dotted(ms, dotted)
                is_django_field = (
                    resolved is not None and resolved[0].startswith("django.db")
                ) or (resolved is None and leaf in FIELD_SUFFIXES and self.module_imports_orm(ms))
                if not is_django_field:
                    continue
                if leaf in RELATIONSHIP_FIELD_KINDS:
                    field_info = FieldInfo(
                        name=field_name,
                        type_str=None,
                        line=line,
                        kind=RELATIONSHIP_FIELD_KINDS[leaf],
                        target_hint=_first_argument(call),
                    )
                else:
                    field_info = FieldInfo(name=field_name, type_str=leaf, line=line, kind="column")
                fields.append(field_info)

            for field_info in fields:
                field_node_id = f"database_field:{ms.module}:{class_name}.{field_info.name}"
                field_details = {"model": node_id, "kind": field_info.kind}
                if field_info.type_str:
                    field_details["type"] = field_info.type_str
                if field_info.target_hint:
                    field_details["targetHint"] = field_info.target_hint
                builder.add_node(
                    Node(
                        id=field_node_id,
                        type="database_field",
                        label=field_info.name,
                        details=field_details,
                        source=SourceLocation(ms.path, field_info.line),
                        evidence=[
                            Evidence(
                                kind="django_field",
                                description="Django model field declaration",
                                source=SourceLocation(ms.path, field_info.line),
                            )
                        ],
                    )
                )
            models.append(
                ModelInfo(
                    adapter=self.name,
                    module=ms.module,
                    name=class_name,
                    path=ms.path,
                    node_id=node_id,
                    fields=fields,
                )
            )
        return models

    def resolve_relationships(self, registry, models: List[ModelInfo], builder, diagnostics) -> None:
        index = ModelIndex(models)
        for model in models:
            for field_info in model.fields:
                if field_info.kind not in RELATIONSHIP_FIELD_KINDS.values() or not field_info.target_hint:
                    continue
                target = index.resolve_hint(field_info.target_hint)
                if target is None:
                    diagnostics.append(
                        make_unresolved_relationship_diagnostic(
                            self.name, model, field_info, field_info.target_hint
                        )
                    )
                    continue
                if target.node_id == model.node_id:
                    continue
                builder.add_edge(
                    "orm_relationship",
                    model.node_id,
                    target.node_id,
                    "confirmed",
                    [
                        Evidence(
                            kind="django_relationship",
                            description=(
                                f"Django {field_info.kind} on {model.name}.{field_info.name} "
                                f"references '{field_info.target_hint}'"
                            ),
                            source=SourceLocation(model.path, field_info.line),
                        )
                    ],
                )
