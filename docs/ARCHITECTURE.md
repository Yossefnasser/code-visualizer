# Technical Architecture -- Code Visualizer

## 1. System overview

```text
VS Code Extension Host (TypeScript)
  |- command registration / activation; webview lifecycle; message bridge
  |- AnalysisController        - manual analysis runs, status, cancellation
  |- IndexService              - file discovery, safe reads, symbol/reference index
  |    \- IndexBackend (interface)
  |         \- PythonIndexBackend (first backend; services/analyzer sidecar)
  |- AgentRunner               - single-agent tool loop
  |    \- AgentTools: repo.overview, index.query, files.read,
  |                   files.search, findings.submit
  |- ModelProvider (interface)
  |    \- OpenRouterProvider (first implementation)
  |- FindingValidator          - source-location + semantic validation
  |- AnalysisCache             - (later milestone) hashed results, partial units
  \- ArchitectureStore         - assembles the architecture data document
                 |
                 | architecture data (contract v2.0 JSON) over the webview bridge
                 v
React Webview (TypeScript)
  |- React Flow canvas, custom node types and edges
  |- detail/inspector panel with evidence, status, and origin
  |- loading / empty / partial / error states
  \- source-navigation messages to the extension host
```

## 2. Responsibilities

### VS Code extension host -- `src/`
Responsible for:
- Registering commands, opening the webview, and bridging typed messages.
- Running manual analysis via the AnalysisController, including status and cancellation.
- Selecting and hosting an IndexBackend; translating index queries.
- Implementing agent tools with privileged file access; enforcing budgets and limits.
- ModelProvider implementations: HTTP calls to OpenRouter, credentials from SecretStorage, timeouts, retries, rate limits, and token accounting.
- Validating findings and assembling the architecture document (contract v2.0).
- Translating webview source-navigation requests into editor navigation.
- Caching and incremental analysis arrive in a later milestone.

It must not contain architecture interpretation or UI logic.

### React webview -- `webview-ui/`
Responsible for:
- Rendering the graph with `@xyflow/react`; custom node renderers and labeled edges.
- Displaying evidence, statuses, and origin (`deterministic` vs `ai`) for nodes and edges.
- Rendering loading, empty, partial, and error states.
- Sending typed messages (open source location, request analysis) to the host.

It must stay provider-agnostic: no OpenRouter or model-provider types.

### Indexer sidecar -- `services/analyzer/` (first IndexBackend)
Responsible for:
- Discovering candidate Python files with deterministic exclusions.
- Safe reading/parsing without executing project code.
- Extracting symbols, imports, assignments, classes, functions, and resolvable calls into a queryable index, including reverse references (who imports/references X).
- Framework hints: FastAPI route decorators and SQLAlchemy/Django model declarations. Hints enrich the index and serve as validation aids; they do not decide what the architecture means.
- A documented JSON protocol for queries from the extension host.

It must not gain new hand-written framework rules. It is a temporary backend behind the IndexBackend interface; see section 9.

### Shared contract -- `packages/contracts/`
Contract v2.0 schema, examples, and validation for both the Python and TypeScript sides. Do not maintain incompatible node/edge shapes per layer.

## 3. AI agent workflow (single agent)

Stage 0 -- Index build (deterministic, no LLM): discovery, parsing, symbol/import/reference index, framework hints, and a size-capped repo digest (pruned directory tree, manifest summaries, hint counts).

Stage 1 -- Survey: the agent receives the digest and proposes subsystems and entry points. The plan is provisional and recorded so partial runs can resume.

Stage 2 -- Per-subsystem exploration loop, bounded by configured budgets:
1. `index.query` for the subsystem's files, symbols, importers, and importees.
2. `files.read` targeted line ranges -- never whole directories, never the whole repository.
3. `files.search` when the index cannot answer a question.
4. `findings.submit` for components and relationships, each with evidence (path + line range).
5. Follow references across modules through the index instead of reading every file.

Termination: subsystem complete, turn budget exhausted, or token budget exhausted. Budget exhaustion marks the unit `partial` with diagnostics -- never silent truncation.

Stage 3 -- Validation: every finding is checked (section 4). Invalid findings are returned to the agent for one bounded repair round; then they are downgraded or dropped with diagnostics.

Stage 4 -- Roll-up: merge validated findings, dedupe shared components, assemble the hierarchy, and emit the contract v2.0 document.

Stage 5 (later milestone) -- Incremental refresh: re-index changed files, invalidate affected scopes via the reverse-reference graph, and re-run the agent only for those scopes.

Structured outputs are requested from the model. Invalid JSON triggers up to N repair round-trips with validation errors attached; persistent failure leaves the unit partial with a diagnostic. A failed subsystem never corrupts the whole run.

Explicit limits (all configurable): per-call context cap, max files per turn, max turns per subsystem, max total tokens per run. No single prompt receives the whole repository, and no single model call is assumed to understand an arbitrarily large codebase. Very large repositories may exceed budgets; the result is partial coverage, honestly reported. This design bounds cost and degrades gracefully, but does not guarantee scalability for arbitrarily large repositories.

## 4. Validation
Two tiers, deliberately separated:

- **Source-location validation (deterministic).** Every cited file, symbol, and line range is checked against the index: the path exists inside the workspace and the symbol exists at or near the cited lines. This validates that evidence points at real code; it does not validate relationships.

- **Semantic relationship validation (separate).** A relationship may only be `confirmed` when the relationship itself is deterministically verifiable from code -- for example a verified route-to-handler decorator binding, an ORM relationship declaration, or a call resolved directly through the index. AI-only claims remain `inferred` even when both endpoints and their source locations are valid, because the existence of two symbols does not prove a relationship between them.

Uncertainty is recorded, never smoothed over: unverifiable relationships become `unresolved` or are dropped with diagnostics.

## 5. Communication flow
1. The user triggers analysis manually (the MVP trigger).
2. AnalysisController validates the workspace root and runs the index build via the IndexBackend.
3. AgentRunner runs the agent loop with the tools above; findings are submitted incrementally.
4. FindingValidator checks each finding; repair or downgrade as needed.
5. ArchitectureStore assembles the architecture document (contract v2.0) and sends it to the webview.
6. The webview renders nodes/edges with statuses and origin; the user inspects evidence and opens source locations (paths validated by the host).
7. Re-running analysis repeats the flow; partial failures surface in status and diagnostics.

## 6. Repository layout

```text
code-visualizer/
|- AGENTS.md
|- package.json                     # VS Code extension project
|- src/
|  |- extension.ts                  # entry point: commands, webview lifecycle
|  \- analysis/                     # AI analysis pipeline
|     |- modelProvider.ts           # provider interface + typed error taxonomy
|     |- openRouterProvider.ts      # first ModelProvider (plain HTTP)
|     \- openRouterConfig.ts        # SecretStorage + settings readers
|     (planned: index service, agent runner, validation, cache, store)
|- webview-ui/                      # React + Vite + React Flow UI
|  \- src/fixtures/                 # mock-architecture.ts (UI-only fixture)
|- services/
|  \- analyzer/                     # Python indexer sidecar (first IndexBackend)
|     \- src/analyzer/indexer.py    # deterministic index document (--index)
|- docs/                            # design docs + MILESTONE_3_STATUS.md
```

`packages/contracts/` (machine-readable contract v2.0 schema and examples) is
referenced by the design but **does not exist yet**; the contract currently
exists only as the specification in `docs/ARCHITECTURE_DATA_MODEL.md`.

This is a target layout; check the actual project before relocating anything.

## 6a. Implementation status

The design in this document is the target. What is actually implemented and
verified today is tracked in `docs/MILESTONE_3_STATUS.md` and summarized in
`docs/ROADMAP.md` (Milestone 3). Do not assume a component described here
exists; check the status document.

## 7. Security, privacy, and reliability
- OpenRouter API keys are stored only in VS Code SecretStorage; never in code, settings files, logs, or the cache.
- Privacy: when analysis runs, source excerpts the agent selects are sent to the configured model provider (OpenRouter and its upstream vendors). The user is informed before enabling AI analysis; configured exclude patterns are honored by the index and by agent reads. The extension itself sends no telemetry.
- Treat workspace source and analysis output as untrusted input; validate webview messages and source paths; avoid embedding source text as HTML.
- Never execute the analyzed project.
- Dispose child processes, listeners, and webview resources appropriately.
- All model-dependent behavior must be testable offline behind a mocked ModelProvider; never call real model APIs in tests.
- Cost control: token usage is recorded per run and per unit; configurable budget ceilings stop runs with partial status.

## 8. Architecture principles
- AI owns architecture interpretation; deterministic utilities support it and never substitute for it.
- Provider abstraction: the application is not coupled to OpenRouter.
- Language-neutral agent workflow, data contract, and provider interface; Python is only the first target.
- Evidence-backed output with two-tier validation and honest uncertainty.
- Bounded exploration; graceful partial results; no silent truncation.
- Single agent; multi-agent orchestration only if a documented design demonstrates the need.
- Stable, versioned contract; the UI is independent of model providers and of internal analyzer implementation.

## 9. Migration notes for `services/analyzer/` (former rule-based engine)
The rule-based analyzer is no longer the primary architecture engine. Disposition of each component:

| Component | Disposition | Reason |
| --- | --- | --- |
| `discovery.py` | Retained | Mechanical file discovery with deterministic exclusions; needed by any index backend. |
| `parsing.py` | Retained | Safe read/parse with diagnostics; never executes target code. |
| `symbols.py` (registry, imports, call refs, dotted-name resolution) | Retained (refactored) | Forms the core of the symbol/import/reference index the agent queries. |
| `symbols.is_service_module` and service-classification constants | Deprecated, then removed | Naming modules "services" by filename is architecture interpretation; the agent owns classification. |
| `models.py` | Retained (extended) | SourceLocation/Evidence/Node/Edge/Diagnostic map onto contract v2.0 with small additions. |
| `builder.py` | Retained | Deduplicating graph accumulator with evidence merging; used by hints and roll-up. |
| `__main__.py` CLI | Retained for now | Testable indexer entry point; superseded by the documented IndexBackend protocol. |
| `routes.py` (FastAPI route detection) | Demoted to hint/validator | High-precision deterministic pattern; kept as index hints and a semantic-validation aid. Frozen: do not clone this pattern for new frameworks. |
| `orm/` adapters (SQLAlchemy, Django) | Demoted to hint/validator | Same rationale; frozen to no new framework adapters. |
| `relationships.py` | Split | Call-resolution logic folds into the index's reference graph; rule-based relationship semantics (what counts as architecturally meaningful) is removed -- the agent decides. |
| `analyzer.py` orchestration | Refactored | Becomes the deterministic index pass feeding the agent, not the final graph producer. |
| Tests asserting service classification or rule-based relationship semantics | Reworked | Mechanical tests stay green; interpretive assertions become hint-provider tests. |

New framework/language support comes from AI interpretation plus, where justified, high-confidence deterministic hints -- not from growing rule code. Removal of deprecated interpretation code is tracked in the roadmap (Milestone 6 decommission step).

## 10. Agent tool boundary

The agent's toolset is specified in `docs/AGENT_TOOLS.md`. The five tools are:

1. `repo.overview` — returns the repository digest for initial survey
2. `index.query` — queries the deterministic index (symbols, imports, references, hints)
3. `files.read` — reads targeted source line ranges
4. `files.search` — searches source when the index cannot answer
5. `findings.submit` — submits structured findings with evidence

The `IndexBackend` interface (implemented by the Python sidecar) provides the query surface for `index.query`. The extension host implements the other tools with privileged file access and budget enforcement.

## 11. Index-to-graph mapping

The mapping from the deterministic index (v1.1) and validated AI findings to the architecture graph contract (v2.0) is specified in `docs/INDEX_TO_GRAPH_MAPPING.md`. Key principles:

- Index entries describe discoverable source structures (files, symbols, imports)
- References describe observed structural connections (calls, imports)
- AI findings express interpreted architectural relationships
- Validation determines whether findings satisfy evidence requirements
- Graph mapping determines which information appears as nodes and edges
- `confirmed` status requires deterministic verification of the relationship itself
- AI-only relationships remain `inferred` even when both endpoints exist
- Default graph shows high-level architecture; drill-down reveals implementation detail