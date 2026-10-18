"""AST symbol extraction: imports, assignments, classes, functions, and calls.

Everything here operates on already-parsed ASTs. Nothing in this package
imports or executes the analyzed project.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field
from typing import Dict, List, Optional

SERVICE_MODULE_SEGMENTS = frozenset({"services", "service", "business", "logic"})
SERVICE_MODULE_SUFFIXES = ("_service", "_services", "_logic", "_business")


@dataclass
class ImportRef:
    """A binding from a local name to an external symbol or module."""

    local: str
    module: Optional[str]  # absolute module path when known, else None
    name: Optional[str]  # original name for from-imports; None for plain imports


@dataclass
class AssignmentRef:
    """A module-level assignment, tracked so router/service instances can be resolved."""

    name: str
    call: Optional[ast.Call]
    line: int


@dataclass
class CallRef:
    """A call expression found inside a function body."""

    kind: str  # "name" or "attr"
    name: Optional[str] = None  # for kind == "name"
    base: Optional[str] = None  # for kind == "attr": dotted base expression
    attr: Optional[str] = None  # for kind == "attr"
    line: int = 0


@dataclass
class ClassInfo:
    name: str
    module: str
    node: ast.ClassDef
    bases: List[str]
    start: int
    end: int


@dataclass
class FunctionInfo:
    module: str
    qualname: str
    name: str
    node: object  # ast.FunctionDef or ast.AsyncFunctionDef
    class_name: Optional[str]
    start: int
    end: int
    calls: List[CallRef] = field(default_factory=list)


@dataclass
class ModuleSymbols:
    path: str  # workspace-relative POSIX path
    module: str  # dotted module name derived from the path
    tree: ast.Module
    imports: Dict[str, ImportRef] = field(default_factory=dict)
    assignments: Dict[str, AssignmentRef] = field(default_factory=dict)
    classes: Dict[str, ClassInfo] = field(default_factory=dict)
    functions: Dict[str, FunctionInfo] = field(default_factory=dict)


def dotted_name(node: ast.AST) -> Optional[str]:
    """Return the dotted name of a Name/Attribute chain, else ``None``."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = dotted_name(node.value)
        if base is None:
            return None
        return f"{base}.{node.attr}"
    return None


def is_service_module(module_name: str) -> bool:
    """Heuristic: does this module look like a service/business-logic module?"""
    parts = [part.lower() for part in module_name.split(".") if part]
    if not parts:
        return False
    if any(part in SERVICE_MODULE_SEGMENTS for part in parts):
        return True
    return parts[-1].endswith(SERVICE_MODULE_SUFFIXES)


def module_name_from_path(rel_posix: str) -> str:
    """Derive a dotted module name from a workspace-relative file path."""
    without_ext = rel_posix[:-3] if rel_posix.endswith(".py") else rel_posix
    parts = [part for part in without_ext.split("/") if part]
    if parts and parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def _resolve_relative_base(module_name: str, level: int) -> Optional[str]:
    """Resolve a relative import's base package, or ``None`` if unresolvable."""
    parts = module_name.split(".") if module_name else []
    package = parts[:-1]
    if level <= 1:
        return ".".join(package)
    drop = level - 1
    if len(package) < drop:
        return None
    return ".".join(package[: len(package) - drop])


def collect_module_symbols(path: str, module_name: str, tree: ast.Module) -> ModuleSymbols:
    ms = ModuleSymbols(path=path, module=module_name, tree=tree)

    for stmt in tree.body:
        if isinstance(stmt, ast.Import):
            for alias in stmt.names:
                if alias.asname:
                    ms.imports[alias.asname] = ImportRef(alias.asname, alias.name, None)
                else:
                    top = alias.name.split(".")[0]
                    ms.imports[top] = ImportRef(top, top, None)
        elif isinstance(stmt, ast.ImportFrom):
            base = _resolve_relative_base(module_name, stmt.level or 0) if stmt.level else None
            if stmt.level and base is None:
                continue  # relative import beyond the top-level package: unresolvable
            if stmt.module:
                full = f"{base}.{stmt.module}" if base else stmt.module
                for alias in stmt.names:
                    if alias.name == "*":
                        continue
                    local = alias.asname or alias.name
                    ms.imports[local] = ImportRef(local, full, alias.name)
            else:
                # ``from . import submodule`` binds a submodule, not a symbol.
                for alias in stmt.names:
                    local = alias.asname or alias.name
                    target = f"{base}.{alias.name}" if base else alias.name
                    ms.imports[local] = ImportRef(local, target, None)
        elif isinstance(stmt, (ast.Assign, ast.AnnAssign)):
            target_name = None
            value = stmt.value
            if isinstance(stmt, ast.Assign):
                if len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
                    target_name = stmt.targets[0].id
            else:
                if isinstance(stmt.target, ast.Name):
                    target_name = stmt.target.id
            if target_name is not None:
                call = value if isinstance(value, ast.Call) else None
                ms.assignments[target_name] = AssignmentRef(target_name, call, stmt.lineno)
        elif isinstance(stmt, ast.ClassDef):
            bases = []
            for base_node in stmt.bases:
                dn = dotted_name(base_node)
                if dn:
                    bases.append(dn)
            ms.classes[stmt.name] = ClassInfo(
                name=stmt.name,
                module=module_name,
                node=stmt,
                bases=bases,
                start=stmt.lineno,
                end=stmt.end_lineno or stmt.lineno,
            )
        elif isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
            _register_function(ms, stmt, class_name=None)

    for class_info in list(ms.classes.values()):
        for stmt in class_info.node.body:
            if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                _register_function(ms, stmt, class_name=class_info.name)

    return ms


def _register_function(ms: ModuleSymbols, node, class_name: Optional[str]) -> None:
    qualname = node.name if class_name is None else f"{class_name}.{node.name}"
    calls: List[CallRef] = []
    _collect_calls(node.body, calls)
    ms.functions[qualname] = FunctionInfo(
        module=ms.module,
        qualname=qualname,
        name=node.name,
        node=node,
        class_name=class_name,
        start=node.lineno,
        end=node.end_lineno or node.lineno,
        calls=calls,
    )


def _collect_calls(body, calls: List[CallRef]) -> None:
    for stmt in body:
        _collect_calls_in_node(stmt, calls)


def _collect_calls_in_node(node, calls: List[CallRef]) -> None:
    for child in ast.iter_child_nodes(node):
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            continue  # nested scopes are not attributed to the enclosing handler
        if isinstance(child, ast.Call):
            func = child.func
            if isinstance(func, ast.Name):
                calls.append(CallRef(kind="name", name=func.id, line=child.lineno))
            elif isinstance(func, ast.Attribute):
                base = dotted_name(func.value)
                calls.append(CallRef(kind="attr", base=base, attr=func.attr, line=child.lineno))
        _collect_calls_in_node(child, calls)


class SymbolRegistry:
    """All parsed modules plus name-resolution helpers over them."""

    def __init__(self) -> None:
        self.modules: Dict[str, ModuleSymbols] = {}

    def add(self, ms: ModuleSymbols) -> None:
        self.modules[ms.module] = ms

    def resolve_dotted(self, ms: ModuleSymbols, dotted: Optional[str]):
        """Resolve a dotted name used in ``ms`` to ``(module, qualname)``.

        Returns ``None`` when the head name is neither imported nor defined
        locally (treated as a builtin or dynamic reference).
        """
        if not dotted:
            return None
        parts = dotted.split(".")
        rest = parts[1:]
        name0 = parts[0]

        ref = ms.imports.get(name0)
        if ref is not None:
            if ref.name is None:
                # Plain module binding (``import x`` or ``from .pkg import mod``):
                # walk remaining parts through modules that exist in the project.
                mod = ref.module
                index = 0
                while mod is not None and index < len(rest) and f"{mod}.{rest[index]}" in self.modules:
                    mod = f"{mod}.{rest[index]}"
                    index += 1
                if mod is None:
                    return None
                if index == len(rest) and rest:
                    return (mod, rest[-1])
                if index == len(rest):
                    return (mod, name0)
                return (mod, ".".join(rest[index:]))
            # from-import binding: it may name a submodule of the source module.
            sub = f"{ref.module}.{ref.name}"
            if rest and sub in self.modules:
                return (sub, ".".join(rest))
            if rest:
                return (ref.module, f"{ref.name}.{'.'.join(rest)}")
            return (ref.module, ref.name)

        if name0 in ms.classes or name0 in ms.functions:
            return (ms.module, ".".join([name0] + rest))

        if name0 in ms.assignments and rest:
            # Instance attribute pattern: ``service = UserService(); service.get()``
            assignment = ms.assignments[name0]
            if assignment.call is not None:
                ctor = dotted_name(assignment.call.func)
                if ctor:
                    ctor_target = self.resolve_dotted(ms, ctor)
                    if ctor_target is not None:
                        ctor_mod, ctor_qual = ctor_target
                        ctor_ms = self.modules.get(ctor_mod)
                        if ctor_ms is not None:
                            class_name = ctor_qual.split(".")[0]
                            if class_name in ctor_ms.classes:
                                return (ctor_mod, f"{class_name}.{'.'.join(rest)}")
            return None

        return None

    def resolve_call(self, ms: ModuleSymbols, function_info: Optional[FunctionInfo], call: CallRef):
        """Resolve a :class:`CallRef` to ``(module, qualname)``, or ``None``."""
        if call.kind == "name":
            return self.resolve_dotted(ms, call.name)
        if call.kind == "attr":
            base = call.base
            if not base or call.attr is None:
                return None
            if base == "self" and function_info is not None and function_info.class_name:
                return (ms.module, f"{function_info.class_name}.{call.attr}")
            return self.resolve_dotted(ms, f"{base}.{call.attr}")
        return None

