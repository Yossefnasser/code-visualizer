"""Analyzer orchestration: discovery, parsing, adapters, and graph assembly."""

from __future__ import annotations

import ast
import os
from typing import List, Optional, Sequence, Set, Tuple

from . import discovery, parsing, relationships, routes, symbols
from .builder import AnalysisBuilder
from .models import AnalysisResult, Diagnostic, Evidence, Node, SourceLocation
from .orm import DjangoAdapter, ModelInfo, ORMAdapter, SQLAlchemyAdapter
from .symbols import SymbolRegistry, collect_module_symbols, is_service_module, module_name_from_path


def analyze(root: str, extra_excludes: Optional[Sequence[str]] = None) -> dict:
    """Analyze the Python project at ``root`` and return the contract JSON dict."""
    root_path = os.path.abspath(root)
    if not os.path.isdir(root_path):
        raise_analyzer_error(root)

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

    registry = SymbolRegistry()
    for rel_path in files:
        abs_path = os.path.join(root_path, rel_path.replace("/", os.sep))
        tree = parsing.parse_file(abs_path, rel_path, diagnostics)
        if tree is None:
            continue
        module_name = module_name_from_path(rel_path) or os.path.basename(root_path)
        registry.add(collect_module_symbols(rel_path, module_name, tree))

    builder = AnalysisBuilder()
    _create_module_and_function_nodes(registry, builder)

    adapters: List[ORMAdapter] = [SQLAlchemyAdapter(), DjangoAdapter()]
    discovered: List[tuple] = []
    for adapter in adapters:
        models: List[ModelInfo] = []
        for module in sorted(registry.modules):
            models.extend(adapter.discover_models(registry, registry.modules[module], builder, diagnostics))
        discovered.append((adapter, models))

    model_keys: Set[Tuple[str, str]] = {
        (model.module, model.name) for _, models in discovered for model in models
    }
    _create_class_nodes(registry, builder, exclude=model_keys)

    for adapter, models in discovered:
        adapter.resolve_relationships(registry, models, builder, diagnostics)

    handler_keys = routes.detect_fastapi_routes(registry, builder, diagnostics)
    relationships.analyze_relationships(registry, builder, diagnostics, handler_keys, model_keys)

    return builder.result(root, diagnostics).to_dict()


def raise_analyzer_error(root: str):
    from .models import AnalyzerError

    raise AnalyzerError(f"Project root does not exist or is not a directory: {root}")


def _last_line(tree: ast.Module) -> int:
    return max((node.lineno for node in ast.walk(tree) if hasattr(node, "lineno")), default=1)


def _create_module_and_function_nodes(registry: SymbolRegistry, builder: AnalysisBuilder) -> None:
    for module in sorted(registry.modules):
        ms = registry.modules[module]
        builder.add_node(
            Node(
                id=f"module:{ms.module}",
                type="module",
                label=ms.module,
                source=SourceLocation(ms.path, 1, _last_line(ms.tree)),
                evidence=[
                    Evidence(
                        kind="python_module",
                        description="Python source file discovered by static analysis",
                    )
                ],
            )
        )
        for qualname in sorted(ms.functions):
            function_info = ms.functions[qualname]
            node_type = (
                "service"
                if function_info.class_name is None and is_service_module(ms.module)
                else "function"
            )
            node_id = f"{node_type}:{ms.module}:{qualname}"
            details = {"name": function_info.name}
            if function_info.class_name:
                details["class"] = function_info.class_name
            builder.add_node(
                Node(
                    id=node_id,
                    type=node_type,
                    label=qualname,
                    details=details,
                    source=SourceLocation(ms.path, function_info.start, function_info.end),
                    evidence=[
                        Evidence(
                            kind="python_definition",
                            description="Function declaration found by static analysis",
                        )
                    ],
                )
            )
            builder.register_symbol(ms.module, qualname, node_id)


def _create_class_nodes(registry: SymbolRegistry, builder: AnalysisBuilder, exclude: Set[Tuple[str, str]]) -> None:
    for module in sorted(registry.modules):
        ms = registry.modules[module]
        for class_name in sorted(ms.classes):
            if (module, class_name) in exclude:
                continue  # represented as a database_model node by an ORM adapter
            class_info = ms.classes[class_name]
            node_id = f"class:{ms.module}:{class_name}"
            builder.add_node(
                Node(
                    id=node_id,
                    type="class",
                    label=class_name,
                    details={"bases": class_info.bases},
                    source=SourceLocation(ms.path, class_info.start, class_info.end),
                    evidence=[
                        Evidence(
                            kind="python_class",
                            description="Class declaration found by static analysis",
                        )
                    ],
                )
            )
            builder.register_symbol(ms.module, class_name, node_id)
