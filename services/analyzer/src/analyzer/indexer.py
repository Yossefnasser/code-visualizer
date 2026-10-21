"""Deterministic index document for the AI analysis pipeline.

The indexer is the mechanical half of the product's code understanding: it
discovers files, extracts symbols, imports, and resolvable call references,
and collects high-confidence framework hints (FastAPI routes, SQLAlchemy and
Django models). It deliberately does NOT interpret architecture and it does
NOT run the deprecated rule-based relationship pass
(``relationships.analyze_relationships``).

The output document is consumed by the extension host's ``IndexService``
(see ``docs/ARCHITECTURE.md``, IndexBackend). Its shape is documented in
``services/analyzer/README.md`` ("Index mode").

Hint extraction deliberately reuses the existing, tested passes (``routes``
and the ORM adapters) through a collecting builder instead of growing new
framework rules. Do not add new framework-specific detection here; new
framework coverage is the AI agent's job.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Sequence

from . import discovery, parsing, routes, symbols
from .analyzer import _create_class_nodes, _create_module_and_function_nodes
from .builder import AnalysisBuilder
from .models import AnalyzerError, Diagnostic
from .orm import DjangoAdapter, SQLAlchemyAdapter

INDEX_SCHEMA_VERSION = "1.0"

KNOWN_FRAMEWORKS = frozenset({"fastapi", "flask", "django", "sqlalchemy", "starlette"})


class _HintCollector(AnalysisBuilder):
    """A builder that behaves normally but exposes what it collected."""

    def collected_nodes(self):
        return list(self._nodes.values())

    def collected_edges(self):
        return list(self._edges.values())


def _count_lines(abs_path: str) -> int:
    try:
        with open(abs_path, "rb") as handle:
            data = handle.read()
    except OSError:
        return 0
    if not data:
        return 0
    count = data.count(b"\n")
    if not data.endswith(b"\n"):
        count += 1
    return count


DIGEST_MAX_ENTRIES = 500


def _build_digest(files_doc, endpoints, models_doc, orm_relationships, references, diagnostics):
    """Size-capped repo digest for the agent survey (ARCHITECTURE.md stage 0).

    Contains a pruned directory tree, per-file manifest summaries, and hint
    counts -- enough for an initial repository survey without sending file
    contents anywhere.
    """
    directories = sorted(
        {
            "/".join(f["path"].split("/")[:-1]) + "/"
            for f in files_doc
            if "/" in f["path"]
        }
    )
    tree = (directories + [f["path"] for f in files_doc])[:DIGEST_MAX_ENTRIES]
    manifest = [
        {
            "path": f["path"],
            "lineCount": f["lineCount"],
            "frameworks": f["frameworks"],
            "imports": len(f["imports"]),
            "symbols": len(f["symbols"]),
        }
        for f in files_doc[:DIGEST_MAX_ENTRIES]
    ]
    return {
        "tree": tree,
        "manifest": manifest,
        "counts": {
            "files": len(files_doc),
            "totalLines": sum(f["lineCount"] for f in files_doc),
            "endpoints": len(endpoints),
            "models": len(models_doc),
            "ormRelationships": len(orm_relationships),
            "references": len(references),
            "diagnostics": len(diagnostics),
        },
    }


def build_index(root: str, extra_excludes: Optional[Sequence[str]] = None) -> Dict[str, Any]:
    """Build the deterministic index document for the project at ``root``."""
    root_path = os.path.abspath(root)
    if not os.path.isdir(root_path):
        raise AnalyzerError(f"Project root does not exist or is not a directory: {root_path}")

    diagnostics: List[Diagnostic] = []
    files, skipped_dirs = discovery.discover_python_files(root_path, extra_excludes)
    for directory in skipped_dirs:
        diagnostics.append(
            Diagnostic(
                severity="info",
                code="skipped_directory",
                message=f"Excluded directory not analyzed: {directory}",
            )
        )

    registry = symbols.SymbolRegistry()
    module_of_path: Dict[str, str] = {}
    for rel_path in files:
        abs_path = os.path.join(root_path, rel_path.replace("/", os.sep))
        tree = parsing.parse_file(abs_path, rel_path, diagnostics)
        if tree is None:
            continue
        module_name = symbols.module_name_from_path(rel_path) or os.path.basename(root_path)
        registry.add(symbols.collect_module_symbols(rel_path, module_name, tree))
        module_of_path[rel_path] = module_name

    # -- per-file metadata ---------------------------------------------------
    files_doc: List[Dict[str, Any]] = []
    for module_name in sorted(registry.modules):
        ms = registry.modules[module_name]
        abs_path = os.path.join(root_path, ms.path.replace("/", os.sep))
        frameworks = sorted(
            {
                (ref.module or "").split(".")[0]
                for ref in ms.imports.values()
                if ref.module
            }
            & KNOWN_FRAMEWORKS
        )
        symbols_doc: List[Dict[str, Any]] = []
        for class_name in sorted(ms.classes):
            class_info = ms.classes[class_name]
            symbols_doc.append(
                {
                    "kind": "class",
                    "name": class_info.name,
                    "qualname": class_info.name,
                    "startLine": class_info.start,
                    "endLine": class_info.end,
                    "bases": list(class_info.bases),
                }
            )
        for qualname in sorted(ms.functions):
            function_info = ms.functions[qualname]
            symbols_doc.append(
                {
                    "kind": "function",
                    "name": function_info.name,
                    "qualname": function_info.qualname,
                    "className": function_info.class_name,
                    "startLine": function_info.start,
                    "endLine": function_info.end,
                }
            )
        symbols_doc.sort(key=lambda item: (item["startLine"], item["qualname"]))
        imports_doc = [
            {
                "local": ms.imports[name].local,
                "module": ms.imports[name].module,
                "name": ms.imports[name].name,
            }
            for name in sorted(ms.imports)
        ]
        files_doc.append(
            {
                "path": ms.path,
                "module": module_name,
                "lineCount": _count_lines(abs_path),
                "frameworks": frameworks,
                "imports": imports_doc,
                "symbols": symbols_doc,
            }
        )

    # -- framework hints via the existing passes -----------------------------
    collector = _HintCollector()
    _create_module_and_function_nodes(registry, collector)
    adapters = [SQLAlchemyAdapter(), DjangoAdapter()]
    discovered: List[tuple] = []
    for adapter in adapters:
        models = []
        for module_name in sorted(registry.modules):
            models.extend(
                adapter.discover_models(registry, registry.modules[module_name], collector, diagnostics)
            )
        discovered.append((adapter, models))
    model_keys = {(model.module, model.name) for _, models in discovered for model in models}
    _create_class_nodes(registry, collector, exclude=model_keys)
    for adapter, models in discovered:
        adapter.resolve_relationships(registry, models, collector, diagnostics)
    routes.detect_fastapi_routes(registry, collector, diagnostics)

    endpoints, route_bindings, models_doc, orm_relationships = _extract_hints(collector, module_of_path)

    # -- resolvable call references for every function -----------------------
    references: List[Dict[str, Any]] = []
    for module_name in sorted(registry.modules):
        ms = registry.modules[module_name]
        for qualname in sorted(ms.functions):
            function_info = ms.functions[qualname]
            for call in function_info.calls:
                resolved = registry.resolve_call(ms, function_info, call)
                if resolved is None:
                    continue
                target_module, target_qual = resolved
                if (target_module, target_qual) == (module_name, qualname):
                    continue
                references.append(
                    {
                        "sourceModule": module_name,
                        "sourceQualname": qualname,
                        "targetModule": target_module,
                        "targetQualname": target_qual,
                        "line": call.line,
                    }
                )
    references.sort(
        key=lambda r: (r["sourceModule"], r["sourceQualname"], r["line"], r["targetModule"], r["targetQualname"])
    )

    digest = _build_digest(files_doc, endpoints, models_doc, orm_relationships, references, diagnostics)

    return {
        "schemaVersion": INDEX_SCHEMA_VERSION,
        "root": root_path,
        "digest": digest,
        "files": files_doc,
        "endpoints": endpoints,
        "routeBindings": route_bindings,
        "models": models_doc,
        "ormRelationships": orm_relationships,
        "references": references,
        "diagnostics": [
            diagnostic.to_dict()
            for diagnostic in sorted(diagnostics, key=lambda d: d.sort_key())
        ],
    }


def _extract_hints(collector: _HintCollector, module_of_path: Dict[str, str]):
    """Extract hint records from the nodes/edges produced by the hint passes."""
    endpoints: List[Dict[str, Any]] = []
    route_bindings: List[Dict[str, Any]] = []
    models: List[Dict[str, Any]] = []
    orm_relationships: List[Dict[str, Any]] = []
    fields_by_model: Dict[str, List[Dict[str, Any]]] = {}

    for node in collector.collected_nodes():
        if node.type == "endpoint":
            source = node.source
            endpoints.append(
                {
                    "id": node.id,
                    "module": module_of_path.get(source.path, "") if source else "",
                    "methods": list(node.details.get("methods", [])),
                    "path": node.details.get("path", ""),
                    "sourcePath": source.path if source else "",
                    "line": source.start_line if source else None,
                }
            )
        elif node.type == "database_field":
            model_id = node.details.get("model")
            if isinstance(model_id, str):
                source = node.source
                fields_by_model.setdefault(model_id, []).append(
                    {
                        "name": node.label,
                        "kind": node.details.get("kind"),
                        "type": node.details.get("type"),
                        "targetHint": node.details.get("targetHint"),
                        "line": source.start_line if source else None,
                    }
                )
        elif node.type == "database_model":
            source = node.source
            models.append(
                {
                    "id": node.id,
                    "module": module_of_path.get(source.path, "") if source else "",
                    "name": node.label,
                    "table": node.details.get("table"),
                    "sourcePath": source.path if source else "",
                    "startLine": source.start_line if source else None,
                    "endLine": source.end_line if source else None,
                }
            )

    for model in models:
        model["fields"] = fields_by_model.get(model["id"], [])

    for edge in collector.collected_edges():
        if edge.type == "route_handler":
            parts = edge.target.split(":", 2)
            if len(parts) == 3:
                route_bindings.append(
                    {
                        "endpointId": edge.source,
                        "handlerModule": parts[1],
                        "handlerQualname": parts[2],
                    }
                )
        elif edge.type == "orm_relationship":
            evidence = edge.evidence[0] if edge.evidence else None
            orm_relationships.append(
                {
                    "sourceId": edge.source,
                    "targetId": edge.target,
                    "kind": evidence.kind if evidence else "orm_relationship",
                    "line": evidence.source.start_line if evidence and evidence.source else None,
                }
            )

    endpoints.sort(key=lambda endpoint: endpoint["id"])
    models.sort(key=lambda model: model["id"])
    return endpoints, route_bindings, models, orm_relationships
