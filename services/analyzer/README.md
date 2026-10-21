# Python Analyzer

A local, static analyzer for Python backends. It parses source files with the
standard-library `ast` module — it **never imports or executes** the analyzed
project — and emits JSON conforming to `docs/ARCHITECTURE_DATA_MODEL.md`
(`schemaVersion: "1.0"`).

No third-party dependencies; Python 3.10+ (developed and tested on 3.12).

Two modes are available:

- **Analyze mode** (default) — the legacy v1.0 architecture graph from the
  rule-based passes. Retained for now; the rule-based *interpretation* is
  deprecated (see `docs/ARCHITECTURE.md` section 9). The product's architecture
  engine is the AI agent, not this mode.
- **Index mode** (`--index`) — the deterministic **index document** that feeds
  the AI agent (Milestone 3). This is the mode the extension's `IndexService`
  consumes.

## Run

From the repository root (`code-visualizer/`):

```powershell
# PowerShell
$env:PYTHONPATH = "services/analyzer/src"
python -m analyzer <path-to-python-project> [-o output.json] [--exclude DIR ...]
```

```bash
# bash
PYTHONPATH=services/analyzer/src python -m analyzer <path-to-python-project>
```

Output is a single JSON document on stdout (or `--output` file). Logs go to
stderr so stdout stays pure JSON. Exit code is `0` on success (diagnostics do
not change the exit code) and `2` for fatal errors such as a missing root.

## Index mode (Milestone 3)

```powershell
python -m analyzer <path-to-python-project> --index [-o output.json] [--exclude DIR ...]
```

`--index` emits the deterministic **index document** consumed by the
extension host's `IndexService` (the temporary `IndexBackend`; see
`docs/ARCHITECTURE.md`). It is mechanical only — discovery, symbols,
imports/references, and framework hints — and never runs the deprecated
rule-based relationship pass. The document is fully deterministic (no
timestamps), so identical trees produce byte-identical JSON.

Shape (`schemaVersion: "1.0"` for the index document):

| Field | Content |
| --- | --- |
| `schemaVersion` | `"1.0"` |
| `root` | Absolute project root |
| `digest` | Size-capped repo digest: `tree` (pruned directory tree + file paths), `manifest` (per-file path/lineCount/frameworks/imports/symbols summaries), `counts` (files, totalLines, endpoints, models, ormRelationships, references, diagnostics) |
| `files` | Per module: `path`, `module`, `lineCount`, `frameworks`, `imports` (`local`/`module`/`name`), `symbols` (functions/classes with `qualname`, `className`, `startLine`, `endLine`) |
| `endpoints` | FastAPI hint records: `id`, `module`, `methods`, `path`, `sourcePath`, `line` |
| `routeBindings` | `endpointId` → `handlerModule`/`handlerQualname` (deterministically verifiable route→handler bindings) |
| `models` | ORM hint records: `id`, `module`, `name`, `table`, `sourcePath`, `startLine`, `endLine`, `fields[]` (`name`, `kind`, `type`, `targetHint`, `line`) |
| `ormRelationships` | `sourceId`, `targetId`, `kind`, `line` |
| `references` | Resolvable cross-symbol calls: `sourceModule`/`sourceQualname` → `targetModule`/`targetQualname`, `line` |
| `diagnostics` | Same diagnostic records as analyze mode |

Hint entries (`endpoints`, `models`, `ormRelationships`) are reuses of the
existing route/ORM passes — high-confidence, deterministic facts only.
They are raw material for the agent, not architectural interpretation.

## Tests

From `code-visualizer/`:

```bash
python -m unittest discover -s services/analyzer/tests -t services/analyzer
```

Tests use only the standard library, run offline, and analyze committed
fixture projects under `tests/fixtures/`:

| Test module | Covers |
| --- | --- |
| `test_indexer.py` | The deterministic index document: digest shape, symbol/import extraction, references, framework hints, route bindings, and determinism (byte-identical output for identical trees) |
| `test_contract.py` | Analyze-mode output matches the shared contract |
| `test_determinism.py` | Repeated runs produce identical output |
| `test_diagnostics.py` | Parse errors surface as diagnostics without aborting |
| `test_discovery.py` | File discovery and exclusions |
| `test_routes.py` | FastAPI route detection |
| `test_orm_sqlalchemy.py` / `test_orm_django.py` | ORM hint extraction |
| `test_relationships.py` | Legacy rule-based relationship pass (deprecated mode) |

| Fixture | Covers |
| --- | --- |
| `fastapi_app` | FastAPI endpoints + handler→service calls + service→SQLAlchemy-model usage |
| `sqlalchemy_only` | SQLAlchemy declarative models, columns, relationships, foreign keys |
| `django_app` | Django ORM models and fields (models only — no URL routing) |
| `ambiguous` | Unresolvable imported calls, unimported names, unrecognized router objects |
| `broken_syntax` | Parse errors that do not abort analysis of other files |
| `with_excluded` | `.venv`, `__pycache__`, `node_modules` exclusion and deterministic output |

## What is detected

- **Modules, classes, functions** — module/class/function nodes with source
  locations and deterministic IDs.
- **FastAPI routes** — decorators such as `@app.get("/path")`, `@router.post(...)`,
  `@app.api_route("/x", methods=[...])` where the decorated name is bound to a
  `FastAPI()` or `APIRouter()` instance in the analyzed project (including via
  imports). Emits an `endpoint` node and a `confirmed` `route_handler` edge.
- **Handler/service relationships** — calls inside route handlers (and top-level
  functions in service modules) resolved through the module's import table:
  `inferred` `calls` edges, `inferred` `uses_model` edges for ORM model
  references, and `unresolved` `calls` edges to explicit placeholder nodes when
  an imported symbol cannot be found. Names that are neither imported nor
  defined (builtins/dynamic) produce nothing.
- **SQLAlchemy models** — classes on a declarative base (`Base = declarative_base()`,
  `DeclarativeBase`), or with `__tablename__`; `Column`/`mapped_column` fields,
  `relationship(...)` and `ForeignKey(...)` targets resolved to `confirmed`
  `orm_relationship` edges.
- **Django ORM models** — classes deriving from `django.db.models.Model`;
  standard field types; `ForeignKey`/`OneToOneField`/`ManyToManyField`
  relationships. Django URL routing is explicitly out of scope.

### Service classification rule (deprecated)

> **Deprecated.** Naming modules "services" by filename is architecture
> interpretation, which now belongs to the AI agent. This rule is retained only
> so the legacy analyze mode keeps working until the rule-engine decommission
> step (Milestone 6). Do not extend it, and do not add new rules of this kind.
> Index mode does not use it.

A module is treated as *service/business logic* when any dotted segment is one
of `service`, `services`, `business`, `logic`, or its last segment ends with
`_service(s)`, `_logic`, or `_business`. Top-level functions in such modules
become `service` nodes; other functions become `function` nodes.

## ID conventions

Deterministic, derived from node type and qualified symbol:

- `module:{module}` — e.g. `module:app.services.user_service`
- `function:{module}:{qualname}` / `service:{module}:{qualname}`
- `class:{module}:{Name}`
- `endpoint:{module}:{METHODS}:{path}` — e.g. `endpoint:app.api.users:GET:/users`
- `database_model:{module}:{Name}`
- `database_field:{module}:{Class}.{field}`
- `unresolved` placeholders reuse the `function:` shape of the would-be target.

Module names are derived from workspace-relative paths (a `__init__.py`
contributes its package name). IDs are stable within one analysis result; they
are not guaranteed stable across refactors (per contract §8).

## Diagnostics

| Code | Severity | Meaning |
| --- | --- | --- |
| `parse_error` | error | File could not be parsed; analysis continues with other files |
| `read_error` | error | File could not be read |
| `unsupported_route_pattern` | warning | Route-like decorator not statically recognizable |
| `unresolved_call` | info | Imported call target not found in analyzed sources |
| `unresolved_orm_relationship` | warning | ORM relationship target could not be resolved |
| `skipped_directory` | info | Excluded directory was not analyzed |

## Limitations

- Call resolution is name/import-based; dynamic patterns (`getattr`, monkey
  patching, string-based dispatch) are not resolved and produce no edges.
- `include_router` composition is not merged; endpoints are reported at their
  router-definition site.
- Decorated handlers nested inside functions or classes are not treated as
  routes (module-level handlers only).
- ORM base detection relies on statically recognizable declarative patterns;
  custom declarative registries may be missed.
- The process protocol with the extension host (stdin/stdout JSON) is a
  Milestone 3 concern; the CLI is a standalone entry point for now.
