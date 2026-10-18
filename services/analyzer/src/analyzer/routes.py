"""FastAPI route discovery from statically recognizable decorator patterns."""

from __future__ import annotations

import ast
from typing import Dict, List, Optional, Set, Tuple

from . import symbols
from .builder import AnalysisBuilder
from .models import Diagnostic, Evidence, Node, SourceLocation

HTTP_METHODS = frozenset({"get", "post", "put", "patch", "delete", "head", "options", "trace"})
FASTAPI_FACTORY_NAMES = {"FastAPI", "APIRouter"}


def _add_diagnostic(diagnostics: List[Diagnostic], severity: str, code: str, message: str,
                    path: Optional[str] = None, line: Optional[int] = None) -> None:
    source = SourceLocation(path, line) if path and line else None
    diagnostics.append(Diagnostic(severity=severity, code=code, message=message, source=source))


def collect_router_names(registry, ms) -> Set[str]:
    """Local names bound to ``FastAPI()`` or ``APIRouter()`` instances."""
    names: Set[str] = set()
    for name, assignment in ms.assignments.items():
        if assignment.call is None:
            continue
        dotted = symbols.dotted_name(assignment.call.func)
        if dotted is None:
            continue
        resolved = registry.resolve_dotted(ms, dotted)
        if resolved is None:
            continue
        target_module, target_qual = resolved
        if target_module.split(".")[0] == "fastapi" and target_qual in FASTAPI_FACTORY_NAMES:
            names.add(name)
    return names


def _is_router_reference(registry, ms, base_dotted, router_names, router_names_by_module) -> bool:
    if base_dotted in router_names:
        return True
    resolved = registry.resolve_dotted(ms, base_dotted)
    if resolved is None:
        return False
    target_module, target_name = resolved
    target_names = router_names_by_module.get(target_module)
    return bool(target_names and target_name in target_names)


def _route_path(call: ast.Call) -> Optional[str]:
    if call.args:
        first = call.args[0]
        if isinstance(first, ast.Constant) and isinstance(first.value, str):
            return first.value
        return None
    for keyword in call.keywords:
        if keyword.arg == "path" and isinstance(keyword.value, ast.Constant) and isinstance(keyword.value.value, str):
            return keyword.value.value
    return None


def _methods_from_call(call: ast.Call) -> List[str]:
    for keyword in call.keywords:
        if keyword.arg != "methods":
            continue
        value = keyword.value
        if isinstance(value, ast.List):
            methods = [
                element.value.upper()
                for element in value.elts
                if isinstance(element, ast.Constant) and isinstance(element.value, str)
            ]
            if methods:
                return methods
    return []


def detect_fastapi_routes(registry, builder: AnalysisBuilder, diagnostics: List[Diagnostic]) -> Set[Tuple[str, str]]:
    """Discover FastAPI routes; returns the set of handler ``(module, qualname)`` keys."""
    router_names_by_module: Dict[str, Set[str]] = {
        module: collect_router_names(registry, ms) for module, ms in registry.modules.items()
    }
    handler_keys: Set[Tuple[str, str]] = set()

    for module in sorted(registry.modules):
        ms = registry.modules[module]
        router_names = router_names_by_module[module]
        functions = [f for f in ms.functions.values() if f.class_name is None]
        for function_info in sorted(functions, key=lambda f: (f.start, f.qualname)):
            for decorator in function_info.node.decorator_list:
                created = _handle_decorator(
                    registry, ms, function_info, decorator, router_names,
                    router_names_by_module, builder, diagnostics,
                )
                if created:
                    handler_keys.add((ms.module, function_info.qualname))
    return handler_keys


def _handle_decorator(registry, ms, function_info, decorator, router_names,
                      router_names_by_module, builder, diagnostics) -> bool:
    if not isinstance(decorator, ast.Call):
        if isinstance(decorator, ast.Attribute):
            base = symbols.dotted_name(decorator.value)
            if base and decorator.attr in HTTP_METHODS | {"api_route"} and _is_router_reference(
                registry, ms, base, router_names, router_names_by_module
            ):
                _add_diagnostic(
                    diagnostics, "warning", "unsupported_route_pattern",
                    f"Route decorator on '{function_info.qualname}' in {ms.path} is not a call "
                    "expression; route arguments cannot be determined.",
                    ms.path, decorator.lineno,
                )
        return False

    func = decorator.func
    if not isinstance(func, ast.Attribute):
        return False
    base = symbols.dotted_name(func.value)
    if base is None:
        return False
    attr = func.attr

    if not _is_router_reference(registry, ms, base, router_names, router_names_by_module):
        if attr in HTTP_METHODS or attr == "api_route":
            _add_diagnostic(
                diagnostics, "warning", "unsupported_route_pattern",
                f"Decorator '@{base}.{attr}' on '{function_info.qualname}' in {ms.path} does not "
                "reference a recognized FastAPI app/router instance.",
                ms.path, decorator.lineno,
            )
        return False

    if attr in HTTP_METHODS:
        methods = [attr.upper()]
    elif attr == "api_route":
        methods = _methods_from_call(decorator) or ["GET"]
    else:
        _add_diagnostic(
            diagnostics, "warning", "unsupported_route_pattern",
            f"Unsupported FastAPI decorator '@{base}.{attr}' on '{function_info.qualname}' in {ms.path}.",
            ms.path, decorator.lineno,
        )
        return False

    path = _route_path(decorator)
    if path is None:
        _add_diagnostic(
            diagnostics, "warning", "unsupported_route_pattern",
            f"Route path for '@{base}.{attr}' on '{function_info.qualname}' in {ms.path} is not a "
            "static string literal; using a placeholder.",
            ms.path, decorator.lineno,
        )
        path = "<dynamic>"

    methods_display = "+".join(methods)
    node_id = f"endpoint:{ms.module}:{methods_display}:{path}"
    handler_id = builder.lookup_symbol(ms.module, function_info.qualname)

    builder.add_node(
        Node(
            id=node_id,
            type="endpoint",
            label=f"{methods_display} {path}",
            details={
                "framework": "fastapi",
                "method": methods_display,
                "methods": methods,
                "path": path,
                "handler": function_info.qualname,
            },
            source=SourceLocation(ms.path, function_info.start, function_info.end),
            evidence=[
                Evidence(
                    kind="fastapi_route_decorator",
                    description="FastAPI route decorator discovered by static analysis",
                    source=SourceLocation(ms.path, decorator.lineno),
                    metadata={"decorator": f"{base}.{attr}"},
                )
            ],
        )
    )

    if handler_id is None:
        _add_diagnostic(
            diagnostics, "warning", "unsupported_route_pattern",
            f"Route handler '{function_info.qualname}' in {ms.path} has no corresponding function node.",
            ms.path, function_info.start,
        )
        return False

    builder.add_edge(
        "route_handler",
        node_id,
        handler_id,
        "confirmed",
        [
            Evidence(
                kind="route_decorator_binding",
                description="Route decorator directly references the handler function",
                source=SourceLocation(ms.path, decorator.lineno),
            )
        ],
    )
    return True
