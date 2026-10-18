"""Handler-to-service and service-to-model relationship extraction.

Relationships are only created when a statically resolvable reference exists.
Calls that cannot be resolved become ``unresolved`` edges pointing at explicit
placeholder nodes plus diagnostics; nothing is fabricated.
"""

from __future__ import annotations

from typing import List, Set, Tuple

from . import symbols
from .builder import AnalysisBuilder
from .models import Diagnostic, Evidence, Node, SourceLocation
from .symbols import FunctionInfo, ModuleSymbols, SymbolRegistry


def analyze_relationships(
    registry: SymbolRegistry,
    builder: AnalysisBuilder,
    diagnostics: List[Diagnostic],
    handler_keys: Set[Tuple[str, str]],
    model_keys: Set[Tuple[str, str]],
) -> None:
    scanned = _functions_to_scan(registry, handler_keys)
    unresolved_seen: Set[Tuple[str, str, str]] = set()

    for ms, function_info in scanned:
        source_node_id = builder.lookup_symbol(function_info.module, function_info.qualname)
        if source_node_id is None:
            continue
        for call in function_info.calls:
            resolved = registry.resolve_call(ms, function_info, call)
            if resolved is None:
                _maybe_unresolved(registry, ms, function_info, call, builder, diagnostics, unresolved_seen)
                continue
            target_module, target_qual = resolved
            if (target_module, target_qual) == (function_info.module, function_info.qualname):
                continue

            # Direct reference to an ORM model class (e.g. ``User.query.get(...)``).
            model_head = target_qual.split(".")[0]
            if (target_module, model_head) in model_keys:
                model_id = builder.lookup_symbol(target_module, model_head)
                if model_id is not None:
                    builder.add_edge(
                        "uses_model",
                        source_node_id,
                        model_id,
                        "inferred",
                        [
                            Evidence(
                                kind="orm_model_reference",
                                description=f"Function references ORM model '{target_module}.{model_head}'",
                                source=SourceLocation(ms.path, call.line),
                            )
                        ],
                    )
                continue

            target_id = builder.lookup_symbol(target_module, target_qual)
            if target_id is not None:
                builder.add_edge(
                    "calls",
                    source_node_id,
                    target_id,
                    "inferred",
                    [
                        Evidence(
                            kind="function_call",
                            description="Handler contains a call to the resolved function",
                            source=SourceLocation(ms.path, call.line),
                        )
                    ],
                )
            else:
                _maybe_unresolved(registry, ms, function_info, call, builder, diagnostics, unresolved_seen)


def _functions_to_scan(registry: SymbolRegistry, handler_keys) -> List[Tuple[ModuleSymbols, FunctionInfo]]:
    """Route handlers plus top-level functions in service-like modules."""
    result = []
    for module in sorted(registry.modules):
        ms = registry.modules[module]
        for qualname in sorted(ms.functions):
            function_info = ms.functions[qualname]
            if function_info.class_name is not None:
                continue
            if (module, qualname) in handler_keys or symbols.is_service_module(module):
                result.append((ms, function_info))
    return result


def _unresolved_target(registry: SymbolRegistry, ms: ModuleSymbols, call) -> Tuple[str, str, str]:
    """Return ``(node_id, module, qualname)`` for an unresolvable imported call."""
    if call.kind == "name":
        ref = ms.imports.get(call.name or "")
        if ref is None:
            return None
        module = ref.module
        qualname = ref.name or call.name
    else:
        head = (call.base or "").split(".")[0]
        ref = ms.imports.get(head)
        if ref is None:
            return None
        if ref.name is None:
            module = ref.module
            tail = (call.base or "").split(".")[1:]
            qualname = ".".join(tail + [call.attr])
        else:
            module = ref.module
            qualname = f"{ref.name}.{call.attr}"
    if not module:
        module = "unresolved"
        node_id = f"function:unresolved:{ms.module}:{qualname}"
    else:
        node_id = f"function:{module}:{qualname}"
    return (node_id, module, qualname)


def _maybe_unresolved(registry, ms, function_info, call, builder, diagnostics, unresolved_seen) -> None:
    """Record an ``unresolved`` calls edge only when the name was imported."""
    target = _unresolved_target(registry, ms, call)
    if target is None:
        return
    node_id, module, qualname = target
    source_node_id = builder.lookup_symbol(function_info.module, function_info.qualname)
    if source_node_id is None:
        return

    builder.add_node(
        Node(
            id=node_id,
            type="function",
            label=qualname,
            details={"unresolved": True, "reason": "symbol not found in analyzed sources"},
            evidence=[
                Evidence(
                    kind="unresolved_reference",
                    description=f"Call target '{module}.{qualname}' could not be resolved by static analysis",
                )
            ],
        )
    )
    builder.add_edge(
        "calls",
        source_node_id,
        node_id,
        "unresolved",
        [
            Evidence(
                kind="unresolved_reference",
                description=f"Call to '{module}.{qualname}' could not be resolved to an analyzed declaration",
                source=SourceLocation(ms.path, call.line),
            )
        ],
    )
    key = (module, qualname, ms.module)
    if key not in unresolved_seen:
        unresolved_seen.add(key)
        diagnostics.append(
            Diagnostic(
                severity="info",
                code="unresolved_call",
                message=(
                    f"Could not resolve call target '{module}.{qualname}' referenced in "
                    f"{ms.path} at line {call.line}."
                ),
            )
        )
