"""SQLAlchemy ORM adapter: model, field, and relationship discovery."""

from __future__ import annotations

import ast
from typing import List, Optional, Tuple

from .. import symbols
from ..models import Evidence, Node, SourceLocation
from .base import FieldInfo, ModelInfo, ModelIndex, ORMAdapter, make_unresolved_relationship_diagnostic

COLUMN_FACTORIES = {"Column", "mapped_column"}
RELATIONSHIP_FACTORIES = {"relationship"}


def _tablename(class_node: ast.ClassDef) -> Optional[str]:
    for stmt in class_node.body:
        if isinstance(stmt, ast.Assign):
            for target in stmt.targets:
                if isinstance(target, ast.Name) and target.id == "__tablename__":
                    if isinstance(stmt.value, ast.Constant) and isinstance(stmt.value.value, str):
                        return stmt.value.value
    return None


def _first_const_str(call: ast.Call) -> Optional[str]:
    for arg in call.args:
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            return arg.value
    return None


def _annotation_strings(annotation) -> List[str]:
    if annotation is None:
        return []
    return [
        node.value
        for node in ast.walk(annotation)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    ]


def _annotation_type(annotation) -> Optional[str]:
    if annotation is None:
        return None
    if isinstance(annotation, ast.Name):
        return annotation.id
    if isinstance(annotation, ast.Constant) and isinstance(annotation.value, str):
        return annotation.value
    if isinstance(annotation, ast.Subscript):
        inner = annotation.slice
        if isinstance(inner, ast.Constant) and isinstance(inner.value, str):
            return inner.value
        dn = symbols.dotted_name(inner) if isinstance(inner, (ast.Name, ast.Attribute)) else None
        if dn:
            return dn
        if isinstance(inner, ast.Subscript) and isinstance(inner.value, ast.Name):
            return inner.value.id
    return None


def _find_foreign_key(call: ast.Call) -> Optional[str]:
    for arg in call.args:
        if isinstance(arg, ast.Call):
            fd = symbols.dotted_name(arg.func)
            if fd and fd.split(".")[-1] == "ForeignKey":
                return _first_const_str(arg)
    for keyword in call.keywords:
        if isinstance(keyword.value, ast.Call):
            fd = symbols.dotted_name(keyword.value.func)
            if fd and fd.split(".")[-1] == "ForeignKey":
                return _first_const_str(keyword.value)
    return None


class SQLAlchemyAdapter(ORMAdapter):
    name = "sqlalchemy"

    def module_imports_orm(self, ms) -> bool:
        return any((ref.module or "").split(".")[0] == "sqlalchemy" for ref in ms.imports.values())

    def _is_model(self, registry, ms, class_info) -> bool:
        if _tablename(class_info.node) is not None:
            return True
        for base in class_info.bases:
            resolved = registry.resolve_dotted(ms, base)
            if resolved is not None:
                target_module, target_qual = resolved
                leaf = target_qual.split(".")[-1]
                if target_module.split(".")[0] == "sqlalchemy" and leaf in {"Base", "DeclarativeBase"}:
                    return True
                target_ms = registry.modules.get(target_module)
                if target_ms is not None and target_qual in target_ms.assignments:
                    assignment = target_ms.assignments[target_qual]
                    if assignment.call is not None:
                        ctor = symbols.dotted_name(assignment.call.func)
                        if ctor:
                            ctor_target = registry.resolve_dotted(target_ms, ctor)
                            if (
                                ctor_target
                                and ctor_target[0].split(".")[0] == "sqlalchemy"
                                and ctor_target[1].endswith("declarative_base")
                            ):
                                return True
            else:
                leaf = base.split(".")[-1]
                if leaf == "DeclarativeBase":
                    return True
                if leaf == "Base" and self.module_imports_orm(ms):
                    return True
        return False

    def _fields(self, class_info) -> List[Tuple[str, ast.Call, int, object]]:
        """Yield ``(name, call, line, annotation)`` for class-level call fields."""
        results = []
        for stmt in class_info.node.body:
            target = None
            value = None
            annotation = None
            if isinstance(stmt, ast.Assign):
                if len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
                    target, value = stmt.targets[0].id, stmt.value
            elif isinstance(stmt, ast.AnnAssign):
                if isinstance(stmt.target, ast.Name):
                    target, value, annotation = stmt.target.id, stmt.value, stmt.annotation
            if target is None or not isinstance(value, ast.Call):
                continue
            if symbols.dotted_name(value.func) is None:
                continue
            results.append((target, value, stmt.lineno, annotation))
        return results

    def discover_models(self, registry, ms, builder, diagnostics) -> List[ModelInfo]:
        if not self.module_imports_orm(ms):
            return []
        models: List[ModelInfo] = []
        for class_name in sorted(ms.classes):
            class_info = ms.classes[class_name]
            if not self._is_model(registry, ms, class_info):
                continue
            table_name = _tablename(class_info.node)
            node_id = f"database_model:{ms.module}:{class_name}"
            details = {"framework": "sqlalchemy"}
            if table_name:
                details["table"] = table_name
            builder.add_node(
                Node(
                    id=node_id,
                    type="database_model",
                    label=class_name,
                    details=details,
                    source=SourceLocation(ms.path, class_info.start, class_info.end),
                    evidence=[
                        Evidence(
                            kind="sqlalchemy_declarative_class",
                            description="Class inherits from a SQLAlchemy declarative base",
                            source=SourceLocation(ms.path, class_info.start),
                        )
                    ],
                )
            )
            builder.register_symbol(ms.module, class_name, node_id)

            fields: List[FieldInfo] = []
            for field_name, call, line, annotation in self._fields(class_info):
                dotted = symbols.dotted_name(call.func)
                leaf = dotted.split(".")[-1]
                if leaf in COLUMN_FACTORIES:
                    hint = _find_foreign_key(call)
                    field_info = FieldInfo(
                        name=field_name,
                        type_str=_annotation_type(annotation),
                        line=line,
                        kind="foreign_key" if hint else "column",
                        target_hint=hint,
                    )
                elif leaf in RELATIONSHIP_FACTORIES:
                    hints = _annotation_strings(annotation)
                    field_info = FieldInfo(
                        name=field_name,
                        type_str=None,
                        line=line,
                        kind="relationship",
                        target_hint=_first_const_str(call) or (hints[0] if hints else None),
                    )
                elif leaf == "ForeignKey":
                    field_info = FieldInfo(
                        name=field_name,
                        type_str=_annotation_type(annotation),
                        line=line,
                        kind="foreign_key",
                        target_hint=_first_const_str(call),
                    )
                else:
                    continue
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
                                kind="sqlalchemy_column",
                                description="SQLAlchemy column or relationship declaration",
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
                    table_name=table_name,
                    fields=fields,
                )
            )
        return models

    def resolve_relationships(self, registry, models: List[ModelInfo], builder, diagnostics) -> None:
        index = ModelIndex(models)
        for model in models:
            for field_info in model.fields:
                if field_info.kind not in {"relationship", "foreign_key"} or not field_info.target_hint:
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
                            kind="sqlalchemy_relationship",
                            description=(
                                f"SQLAlchemy {field_info.kind} on {model.name}.{field_info.name} "
                                f"references '{field_info.target_hint}'"
                            ),
                            source=SourceLocation(model.path, field_info.line),
                        )
                    ],
                )
