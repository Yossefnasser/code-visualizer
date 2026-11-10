# Milestone 3 Status -- End-to-End AI Analysis Proof of Concept

This document records what has actually been implemented for ROADMAP Milestone 3,
what was verified, and what remains. It is a work log, not a design document:
the design lives in `docs/ARCHITECTURE.md`, `docs/ARCHITECTURE_DATA_MODEL.md`,
and `docs/PRODUCT_SPEC.md`.

Last updated: 2026-11-10 (Index Contract v1 implementation, `AgentFinding` adapter,
and the in-progress `IndexToGraphMapper` documented; test suite re-verified).

---

## 1. Progress summary

| # | Milestone 3 scope item | Status |
| --- | --- | --- |
| 1 | `ModelProvider` interface + `OpenRouterProvider` (plain HTTP) | **Done** |
| 2 | Credential + settings UX | **Partial** |
| 3 | `IndexService` over the Python sidecar | **Done** (sidecar + `IndexBackend`/`PythonIndexBackend`/`IndexService`) |
| 4 | Agent tool boundary specification | **Done** (`docs/AGENT_TOOLS.md`) |
| 5 | Index-to-graph mapping specification | **Done** (`docs/INDEX_TO_GRAPH_MAPPING.md`) |
| 6 | `AgentRunner` + agent tools | **Done** (bounded loop; `findings.submit` is a final-JSON output, not a tool -- see §2.5) |
| 7 | `FindingValidator` (two-tier validation) | Not started |
| 8 | Contract v2.0 document + real rendering path | Not started (real analysis path); **Partial** -- prototype rendering of the mapped Index Contract example is wired (§2.11); the upstream machinery is in place (§2.9-§2.10) |
| 9 | Index Contract v1 machine-readable schema + TS validator | **Done** (2026-11-09, §2.9) |
| 10 | `AgentFinding` → Index Contract v1 adapter | **Done** (2026-11-09, §2.9) |
| 11 | `IndexToGraphMapper` (deterministic, no LLM) | **Done** (committed 2026-11-10); wired into the prototype display path (§2.11) |

Legend: **Done** = implemented and verified by a run command; **Partial** = part of the
item exists; **Not started** = no code yet.

---

## 2. What was built

### 2.1 Provider layer (scope item 1 -- done)

**`src/analysis/modelProvider.ts`** -- the provider abstraction every other
component depends on.

- `ModelProvider` interface: `id` plus `complete(request, options)`.
- `ModelRequest` carries `messages`, optional `maxTokens`, `temperature`, and an
  optional `jsonSchema` (`name`, `schema`, `strict`).
- `ModelResponse` carries `content`, `usage` (prompt/completion/total tokens plus
  optional `costUSD`), `finishReason`, and the served `model` id.
- `ModelProviderError` with a typed `kind` taxonomy:
  `authentication`, `rate_limit`, `timeout`, `network`, `server`,
  `invalid_request`, `invalid_response`, `cancelled`, `unknown`. It optionally
  carries the HTTP `status` and a `retryAfterMs` hint.
- `isRetryableProviderError()` encodes which failures are transient
  (rate limit, timeout, network, server, invalid response). Authentication and
  invalid-request failures are **not** retried.
- `CompleteOptions.signal` provides cooperative cancellation.

**`src/analysis/openRouterProvider.ts`** -- the first `ModelProvider`
implementation, over plain `fetch` (no SDK, per `AGENTS.md`).

- POSTs to `https://openrouter.ai/api/v1/chat/completions` by default
  (`baseUrl` is overridable for tests).
- Sends `response_format: { type: "json_schema", json_schema: {...} }` only when
  the request carries a schema **and** `structuredOutput` is enabled; otherwise
  the field is omitted entirely. When structured output is requested it also
  sends `provider: { require_parameters: true }` so only endpoints that
  advertise the feature are used.
- Bounded per-attempt timeout (default 60 s) via `AbortController`; a timeout is
  reported as `timeout` and retried per policy.
- Retries transient failures with exponential backoff (base 500 ms, capped at
  8 s). A `Retry-After` header (seconds or HTTP date) overrides the backoff.
- 401/403 -> `authentication`, 400 -> `invalid_request`, 429 -> `rate_limit`,
  5xx -> `server`; none of these leak the API key or the full request payload.
- Parses `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens`,
  and `usage.cost` (estimated USD). Missing or malformed usage degrades to zeros
  rather than failing the call.
- A response without usable completion text raises `invalid_response`; malformed
  JSON bodies are retried as transient failures.
- `fetchImpl` and `sleep` are injectable, so every test runs offline and
  instantly.

**Verified:** `src/test/openRouterProvider.test.ts` covers success with usage and
cost mapping, `json_schema` presence/omission, 429 with `Retry-After` then
success, 401 without retry, 400 surfacing as `invalid_request`, timeout after
retries, cancellation mapping to `cancelled`, network failure then success,
missing API key rejection, and malformed JSON retry then `invalid_response`.

### 2.2 Credential and settings UX (scope item 2 -- partial)

- Command `Code Visualizer: Set OpenRouter API Key`
  (`code-visualizer.setOpenRouterApiKey`, contributed in `package.json`) prompts
  with a masked input box and stores the trimmed key in VS Code
  **SecretStorage** under the key `codeVisualizer.openrouter.apiKey`. The value
  is never written to settings, logged, or included in any diagnostic.
- `src/analysis/openRouterConfig.ts` centralizes configuration reads:
  `getOpenRouterApiKey(context)`, `getOpenRouterModel()`, `getStructuredOutput()`.
- Settings (`package.json` -> `contributes.configuration`):
  - `codeVisualizer.openRouter.model` -- string, default `openai/gpt-4o-mini`.
  - `codeVisualizer.openRouter.structuredOutput` -- boolean, default `true`
    (turn off for models that do not support `response_format` json_schema).

**Still missing:** budget settings (max tokens / turns / files per turn), the
first-run privacy disclosure, a suggested-model list, and -- most importantly --
any command that starts an analysis.

### 2.3 Deterministic index document (scope item 3 -- sidecar side done)

**`services/analyzer/src/analyzer/indexer.py`** adds a deterministic index mode
that supports the agent without interpreting architecture.

- `build_index(root, extra_excludes)` emits a document with
  `schemaVersion: "1.1"` containing:
  - `language` -- primary language of the indexed project (`"python"`).
  - `digest` -- a size-capped survey of the repository: pruned directory `tree`,
    per-file `manifest` summaries (path, line count, frameworks, import count,
    symbol count) and aggregate `counts` (files, total lines, endpoints, models,
    ORM relationships, references, diagnostics). Capped at 500 entries.
  - `files` -- per module: `path`, `module`, `language`, `lineCount`, `frameworks`, `imports`,
    and `symbols` (functions/classes with stable `id`, `qualname`, `className`, `startLine`,
    `endLine`, `bases` for classes).
  - `endpoints` -- FastAPI hint records (`id`, `module`, `methods`, `path`,
    `sourcePath`, `line`).
  - `routeBindings` -- `endpointId` -> `handlerModule`/`handlerQualname`. These are
    deterministically verifiable route-to-handler bindings and are the basis for
    semantic validation (the only route relationships that may become
    `confirmed`).
  - `models` -- ORM hint records with `fields[]`.
  - `ormRelationships` -- `sourceId`, `targetId`, `kind`, `line`.
  - `references` -- resolvable cross-symbol calls
    (`sourceModule`/`sourceQualname` -> `targetModule`/`targetQualname`, `line`).
  - `reverseReferences` -- reverse reference index: `targetModule:targetQualname`
    -> list of references pointing to it (sorted).
  - `diagnostics` -- the same diagnostic records as analyze mode.
- The output is fully deterministic (no timestamps), so identical trees produce
  byte-identical JSON -- a prerequisite for the caching milestone.
- The indexer deliberately **reuses** the existing, tested route/ORM passes
  through a collecting builder. No new framework rules were added, and the
  deprecated rule-based relationship pass is not executed in index mode.

**CLI:** `python -m analyzer <root> --index [-o out.json] [--exclude DIR ...]`
(stdout stays pure JSON; logs go to stderr).

**Verified:** 43 analyzer tests pass
(`python -m unittest discover -s services/analyzer/tests -t services/analyzer`),
including `services/analyzer/tests/test_indexer.py` with tests for
stable symbol IDs, language field, and reverse references.

### 2.4 Extension-side index access (scope item 3 -- done, added 2026-11-08)

**`src/analysis/indexBackend.ts`** -- the `IndexBackend` interface and the
TypeScript types for the index document (v1.1): `IndexDocument`, `IndexDigest`,
`FileDoc`, `SymbolRef`, `EndpointHint`, `RouteBinding`, `ModelHint`,
`OrmRelationshipHint`, `CallReference`, `IndexDiagnostic`, `IndexQueryFilter`,
`BuildIndexOptions`, plus the typed `IndexBackendError` (`python_not_found`,
`process_failed`, `timeout`, `invalid_json`, `unsupported_schema_version`,
`validation_failed`, `cancelled`, `unknown`) and the injectable
`ProcessExecutor` abstraction.

**`src/analysis/pythonIndexBackend.ts`** -- `PythonIndexBackend` implements
`IndexBackend` by spawning `python -m analyzer <root> --index [--exclude DIR ...]`
with `PYTHONPATH=services/analyzer/src`:

- Parses and validates the JSON stdout (schema version must be `"1.1"`, all
  required top-level fields present, language must be `"python"`).
- Caches the parsed document in memory; query methods (`querySymbols`,
  `queryImports`, `queryReferences`, `queryReverseReferences`, `getEndpoints`,
  `getRouteBindings`, `getModels`, `getOrmRelationships`, `getFiles`,
  `getDiagnostics`) filter the cached document deterministically with a default
  limit of 100.
- Handles spawn failures (`python_not_found`), non-zero exits
  (`process_failed`), timeouts (default 5 min), oversized stdout (10 MB cap),
  and cooperative cancellation via `AbortSignal` (kills the child process).
- `executor`, `pythonExecutable`, `pythonArgs`, and `timeoutMs` are injectable
  for offline tests.

**`src/analysis/indexService.ts`** -- `IndexService` wraps an `IndexBackend`
(received by dependency injection; it does not instantiate backends) and adds:

- Lifecycle: `buildIndex()` / `refreshIndex()` / `hasIndex()`, with
  `IndexNotBuiltError` thrown by every accessor before the first build.
- `getRepoOverview()` -- assembles the `repo.overview` payload (schema version,
  root, language, digest, counts including derived symbol/import totals, and
  diagnostics).
- `queryIndex({ type, filter, targetKey })` -- the unified `index.query`
  surface for all nine query types (`symbols`, `imports`, `references`,
  `reverseReferences`, `endpoints`, `models`, `routeBindings`,
  `ormRelationships`, `files`); `reverseReferences` requires `targetKey`.
- `IndexServiceInterface` -- the minimal surface `AgentRunner` depends on, so
  tests can fake the service without implementing the whole class.

**Verified:** `src/test/pythonIndexBackend.test.ts` (23 tests: success path,
cached document, invalid JSON, wrong schema version, missing fields, non-zero
exit, unknown executor errors, paths with spaces, excludes, cancellation,
symbol filtering/limit, reverse references, all hint getters, custom
executable/args/timeout) and `src/test/indexService.test.ts` (27 tests:
build/overview/digest lifecycle, all nine query types, filtering, limits,
error propagation, cancellation, excludes).

### 2.5 AgentRunner (scope item 6 -- done, added 2026-11-08)

**`src/analysis/agentRunner.ts`** -- `AgentRunner` runs a bounded single-agent
loop over a `ModelProvider` and an `IndexServiceInterface`:

- **Tools implemented:** `repo.overview`, `index.query`, `files.read`,
  `files.search`. `findings.submit` is **not** a tool call: the agent returns
  findings as a final JSON document matching the `agent_findings` schema
  (`AgentFinding[]` with `id`, `type` (`node`/`edge`), `proposedType`, `label`,
  `description`, `source`, `evidence`, `status`, optional `confidence`).
  Findings can only be `inferred` or `unresolved` -- the runner rejects any
  finding marked `confirmed` at parse time, since only the (not yet built)
  validator may promote a relationship.
- **Loop:** system prompt (with prompt-injection guard: repository content is
  data, never instructions) -> model call -> parse tool calls or final
  findings -> execute tools -> append results -> repeat. Structured output
  (`FINDINGS_SCHEMA`) is forced on the last turn.
- **Budgets (constructor options, defaults):** `maxTurns` 10, `maxToolCalls` 20,
  `maxToolOutputChars` 10000 (oversized tool results are replaced with a
  truncation marker), `totalTimeoutMs` 5 min. Token usage and provider-reported
  cost are accumulated across turns. Budget/timeout/cancellation/provider
  failures end the run as `partial` (or `failed`) with diagnostics -- never
  silent truncation. There is **no per-subsystem loop and no token-budget
  ceiling** yet; those arrive with the validator/store work.
- **File access:** `DefaultFileAccess.readFile` validates workspace-relative
  POSIX paths (rejects absolute paths and `..`/`.` traversal, verifies the
  resolved path stays inside the workspace) and caps reads at 200 lines.
  `DefaultSearchAccess.search` shells out to ripgrep (`rg`) with common
  exclusions and falls back to a Node.js filesystem walk when `rg` is absent.
  Both are injectable (`FileAccess` / `SearchAccess`) for tests. Exclude
  patterns from the index are **not** yet enforced on reads/searches.
- **Result:** `AgentRunResult` with `findings` and `metadata` (`turns`,
  `toolCalls`, `totalTokens`, `totalCostUSD`, `durationMs`, `status`,
  `terminationReason`, `diagnostics`).

**Verified:** `src/test/agentRunner.test.ts` (11 tests, all offline against a
`FakeModelProvider` and fake index/file/search access: basic tool round trip,
index query, unknown tool, malformed `files.read` args, tool-call limit,
provider failure, cancellation, malformed final JSON, invalid findings schema,
`confirmed` rejection, provider-interface compatibility).

### 2.6 Agent tool boundary specification (scope item 4 -- done)

**`docs/AGENT_TOOLS.md`** specifies the five tools available to the AI agent:

1. `repo.overview` — returns the repository digest (tree, manifest, counts) for initial survey
2. `index.query` — queries the deterministic index for symbols, imports, references, reverseReferences, endpoints, models, routeBindings, ormRelationships, files
3. `files.read` — reads targeted source line ranges (max 200 lines per call)
4. `files.search` — searches source code with regex when the index cannot answer
5. `findings.submit` — submits structured findings (nodes/edges) with evidence for validation

Each tool has defined input/output shapes, constraints, and budget enforcement. The specification includes the tool invocation protocol, error handling, and implementation notes for the extension host.

**Implementation note (2026-11-08):** `findings.submit` is specified as a tool
but is implemented as the agent's final JSON output (see §2.5). The
`AgentFinding` shape is an intermediate proposal format, not the contract v2.0
node/edge shape; the validator/store step must translate it.

### 2.8 Documentation alignment pass (2026-11-09 -- docs only, no code)

Agreed direction locked in and aligned across `docs/ARCHITECTURE.md`,
`docs/ARCHITECTURE_DATA_MODEL.md`, `docs/INDEX_TO_GRAPH_MAPPING.md`,
`docs/AGENT_TOOLS.md`, and `docs/ROADMAP.md`:

- **AI-first indexing:** the AI agent (`AgentRunner`) is the initial Indexer.
  The Indexer is implementation-independent; a parser is only one possible
  implementation tool.
- **Index Contract v1** (upstream, proposed in
  `docs/ARCHITECTURE_DATA_MODEL.md` section 16): every Indexer (AI,
  deterministic parser, or hybrid) must produce the same language-neutral
  representation, distinguishing mechanically observed facts from AI
  interpretations with evidence, source locations, provenance, and
  uncertainty. It does not yet exist as a complete machine-readable
  specification.
- **Architecture Graph Contract v2.0** (downstream, normative) is produced
  only by deterministic mapping from the validated index. No LLM calls
  during graph mapping or rendering.
- **Validation** is deterministic and two-tiered; validating a source
  location never proves a semantic relationship.
- **`AgentFinding` decision:** each proposal maps to one Index Contract v1
  interpretation entry (see `ARCHITECTURE_DATA_MODEL.md` section 16.4); it
  is never a v2.0 node/edge directly.
- **Python sidecar:** transitional/reference backend behind `IndexBackend`
  (index v1.1). Do not expand its framework-specific rules or remove it yet.

No source code was changed in this pass. Implementation of Index Contract v1
and the validator/store steps is pending design approval.

### 2.7 Index-to-graph mapping specification (scope item 5 -- done)

**`docs/INDEX_TO_GRAPH_MAPPING.md`** specifies how the deterministic index (v1.1) and validated AI findings map to the architecture graph contract (v2.0). Key mappings:

- Index entries → graph nodes: files→modules, symbols→functions/classes, framework hints→endpoints/database_models
- Index references → graph edges: routeBindings→route_handler (confirmed), ormRelationships→orm_relationship (confirmed), references→calls (inferred), imports→imports (confirmed, hidden)
- AI findings → architectural nodes/edges with origin: "ai" and status: "inferred" by default
- Validation rules: source-location validation for all findings; semantic validation only for confirmed relationships
- Default graph vs drill-down: high-level view shows subsystems, endpoints, services, database_models; functions/classes/imports hidden until drill-down
- Hierarchy construction: deterministic module hierarchy + AI-identified subsystem hierarchy
- Evidence propagation: deterministic evidence kinds + ai_observation with validated flag
- Partial analysis units for budget-exhausted runs

### 2.9 Index Contract v1 and the `AgentFinding` adapter (scope items 3/6 support -- done, added 2026-11-09)

Committed in the Milestone 3 vertical-slice commit (`05fa841`); documented here so the
status log matches the repository (previous versions of this section listed these as
open gaps).

**`packages/contracts/`** -- machine-readable contract specifications (now exists):

- `index-v1.schema.json` -- Architecture Index Contract v1 (`indexVersion: "1.0"`);
  the relationship vocabulary is preserved from `docs/INDEX_TO_GRAPH_MAPPING.md`.
- `examples/index-v1.complete.json` and `examples/index-v1.partial.json`
  (the partial example demonstrates pending/failed coverage scopes and an
  unresolved relationship; both validate against the schema).
- `README.md` states that these files are canonical and that the
  Architecture Graph Contract v2.0 schema does not exist yet.

**`src/analysis/indexContract.ts`** -- TS types plus a structural validator without
external dependencies, including cross-reference checks (every relationship's source
and target must reference existing entry IDs; duplicate entry IDs are rejected with
`duplicate id "..."` messages). 20 offline tests in `src/test/indexContract.test.ts`.

**`src/analysis/agentFindingAdapter.ts`** -- translates `AgentFinding[]` proposals
(one finding -> one Index Contract v1 interpretation entry, per
`docs/ARCHITECTURE_DATA_MODEL.md` §16.7). Nodes map fully; edges without endpoints
are excluded with diagnostics (never fabricated); malformed findings are excluded
with diagnostics. 12 offline tests in `src/test/agentFindingAdapter.test.ts`,
including an `AgentRunner` integration test.

### 2.10 `IndexToGraphMapper` (scope item 8 -- in progress, added 2026-11-10)

**`src/analysis/indexToGraphMapper.ts`** (currently uncommitted work-in-progress) --
a deterministic, LLM-free translation from a validated Index Contract v1 document to
the Graph v2.0 shape consumed by the webview (`MapperResult` with `graph` + `warnings`):

- Validates the input with `validateIndexDocument` first; an invalid document throws
  with a message that includes the validation errors (e.g. duplicate entry IDs).
- Entry types `file`/`module` -> `module`, `symbol` -> `function` (or `class` when
  `details.kind` says so), `route` -> `endpoint`, `model` -> `database_model`,
  `subsystem` -> `subsystem`, `service` -> `service`.
- `relationship` entries become edges (`imports`, `calls`, ...) filtered to edges
  whose both endpoints exist; unresolved relationships produce no edge plus a
  warning. Import *facts* (`import` entry type) intentionally map to neither node
  nor edge -- import information reaches the graph as `imports` relationship edges.
- Provenance maps to graph `origin` (`deterministic`/`ai`/`hybrid`); status, source
  locations, evidence, diagnostics, and coverage scopes map 1:1.

**Verified:** 16 offline tests in `src/test/indexToGraphMapper.test.ts`. The file
was committed with a duplicated `indexDoc` declaration in its "duplicate node ids"
test (broke `tsc`) and a stale expectation in the "unsupported entry types" test
(an `import` fact entry is never an "unsupported type"); both were corrected on
2026-11-10. With the corrections, the full suite passes: 124 extension tests
across 8 files, plus 43 Python analyzer tests (see §6).

**Committed (2026-11-10):** `feat: add deterministic Index v1 to Graph v2.0 mapper`
(`26a9c0d`).

### 2.11 Prototype display path: Index Contract example → mapper → webview (scope item 8 -- partial, added 2026-11-10)

The first visual prototype now renders real contract data instead of only the
fixture, without introducing analysis, validation, or new relationship extraction:

- **`src/analysis/exampleGraphProvider.ts`** loads a committed Index Contract v1
  example (`packages/contracts/examples/index-v1.complete.json` by default;
  `packages/` is not excluded by `.vscodeignore`, so it ships in the VSIX),
  validates it with `validateIndexDocument`, and maps it deterministically with
  `mapIndexToGraph`. Typed `ExampleGraphError` codes (`file_not_found`,
  `invalid_json`, `invalid_contract`) surface actionable diagnostics. Mapper
  warnings become `mapper_warning` diagnostics instead of being swallowed.
  9 offline tests in `src/test/exampleGraphProvider.test.ts`, including that the
  complete example's only edge is an AI-inferred `calls` relationship.
- **`src/extension.ts`**: when the webview announces `webviewReady`, the host
  loads the example graph and posts `{ type: "architectureGraph", graph, source }`
  (or `analysisError` on failure) to the panel. Everything is traced in the
  "Code Visualizer" output channel.
- **Webview message bridge** (`webview-ui/src/App.tsx`): first webview side of a
  bridge. `acquireVsCodeApi` posts `webviewReady` and listens for the graph
  message; a memoized guard re-uses one API handle. When opened outside VS Code,
  the clearly labeled `MOCK_DATA_NOTE` fixture remains the fallback (retained for
  offline UI development).
- **Webview contract types** (`webview-ui/src/types/architecture.ts`) upgraded
  from v1.0 to v2.0: `origin`, `parentId`, `status`, `confidence` on nodes,
  `origin` on edges, `subsystem` node type, `uses`/`reads`/`writes` edge types,
  `analysis`/`units`/`summaries` blocks, `project.languages` (legacy singular
  `language` accepted during transition).
- **Semantic relationships are suppressed for display**: the webview renders only
  factual edge types (`route_handler`, `orm_relationship`, `imports`). Edges of
  semantic types (`calls`, `uses_model`, `uses`, `reads`, `writes`) are counted
  and announced in the banner ("N semantic relationship(s) suppressed until
  FindingValidator exists") rather than displayed or silently dropped. For the
  complete example this means the rendered graph shows endpoint and service
  nodes and no edges (its only edge is an AI `calls` relationship).
- **Details panel** (`webview-ui/src/components/panels/details-panel.tsx`):
  adds Provenance (`origin`, `status`, `confidence`) and Parent (`parentId`) rows
  so origin is visible per node. Node selection/un/pane-click behavior unchanged.

**Not done yet:** `FindingValidator` (so no AI relationship can be displayed or
promoted), `AnalysisController` + `code-visualizer.analyze` (no real model call),
the Graph v2.0 machine-readable schema, and dedicated renderers for
`module`/`subsystem`/`function`/`class` nodes (they are skipped by the existing
column layout -- the hierarchy exists in the data and the Details panel, but is
not drawn yet).

---

## 3. Tooling fixes made in this milestone

### 3.1 F5 no longer hangs (fixed and verified by the user)

The `Run Extension` launch configuration used `"preLaunchTask": "${defaultBuildTask}"`,
which resolved to the **background** `watch` task. That task is designed to stay
alive and signal readiness through the `$esbuild-watch` problem matcher; in this
environment it never signalled, so F5 appeared to hang and never opened the
Extension Development Host.

Fix (verified working):

- `.vscode/tasks.json` -- added a one-shot `build` task
  (`"type": "npm", "script": "compile", "problemMatcher": []`) that runs
  type-check -> lint -> webview build -> extension bundle and then exits.
- `.vscode/launch.json` -- `"preLaunchTask"` now points at `build`.

The background `watch` tasks are untouched and remain available for manual use.

### 3.2 Diagnostics that ruled out other causes

- `ELECTRON_RUN_AS_NODE` / `ELECTRON_NO_ATTACH_CONSOLE` are not set in the
  environment, so the VS Code test host runs normally.
- `dist/extension.js` and `webview-ui/dist/index.html` are both produced by
  `npm run compile` (exit code 0), so a missing bundle was not the cause.
- The esbuild wrapper prints `[watch] build started` / `[watch] build finished`
  on every build, which is what the `$esbuild-watch` matcher listens for.
- The `code --extensionDevelopmentPath=...` CLI path hits an ICU launcher error on
  this machine; launching `Code.exe` directly is the documented fallback.

---

## 4. Deliberate design decisions

1. **No provider SDK.** The OpenRouter integration uses `fetch` directly, per
   `AGENTS.md`. This also keeps the bundle small and the error handling
   explicit.
2. **Errors are typed, not stringly.** Callers switch on `ModelProviderError.kind`
   rather than parsing messages, so the UI can show actionable diagnostics
   (missing key, rate limit, timeout, malformed output) without string matching.
3. **Retries are bounded and classified.** Only transient conditions retry.
   A 401 (bad key) or 400 (bad request) fails immediately -- retrying those
   wastes the user's quota and hides the real problem.
4. **`Retry-After` wins over backoff** when the provider sends it, so rate limits
   are respected instead of hammered.
5. **Cost is parsed, never estimated locally.** `usage.cost` from the provider is
   used when present; the extension does not maintain its own price table (it
   would rot).
6. **The Python reference index document is deterministic.** No timestamps,
   sorted outputs. This makes runs reproducible and lets the future cache key
   on content. (AI-produced Index Contract v1 entries are not byte-deterministic;
   determinism is required of validation and graph mapping, not of the AI
   Indexer.)
7. **The sidecar is spawned, not imported.** `PythonIndexBackend` runs
   `python -m analyzer --index` as a child process with a typed error taxonomy
   and an injectable executor, so the extension never depends on Python
   internals and tests never spawn a real interpreter.
8. **Findings are final JSON, not a tool call.** The agent's last turn returns
   the `agent_findings` document; the runner structurally validates it and
   refuses `confirmed` statuses. This keeps the tool surface at four tools and
   defers all promotion decisions to the validator.

---

## 5. Known gaps and risks

| Gap | Impact | Next step |
| --- | --- | --- |
| No analysis command exists yet | The user cannot trigger a run; `AgentRunner`/`IndexService` are unreachable from the UI | Add `code-visualizer.analyze` plus `AnalysisController` |
| `FindingValidator` does not exist | Agent findings are unvalidated proposals; nothing checks source locations or gates `confirmed`; the webview therefore suppresses all semantic relationship types (`calls`, `uses_model`, `uses`, `reads`, `writes`) for display (§2.11) | Implement two-tier validation over Index v1 entries per `docs/INDEX_TO_GRAPH_MAPPING.md` §5 |
| `ArchitectureStore` / v2.0 assembly does not exist | No contract v2.0 document is produced; `AgentFinding` shape is not the contract shape | Deterministically map validated Index v1 to the v2.0 document (no LLM) |
| Graph v2.0 contract has no machine-readable schema (`packages/contracts/` covers Index v1 only) | The v2.0 contract is prose-only; no machine validation of the mapper's output | Add the JSON Schema + complete/partial examples |
| `packages/contracts/` Index-v1 examples do not cover factual/deterministic edge shapes | The prototype renders no edges (the complete example's only relationship is an AI `calls` interpretation) | Extend the examples with `imports`/`route_handler` relationship entries so factual edges are visible in the prototype |
| `module`/`subsystem`/`function`/`class` nodes have no React Flow renderer | Hierarchy (parentId) exists in data and the Details panel but is not drawn; those node types are skipped by the column layout | Add renderers/layout in a later UI milestone (not the prototype) |
| No privacy disclosure UI | Product requirement (AGENTS.md, PRODUCT_SPEC §8) unmet | Show the disclosure before the first analysis |
| No budget settings or token-budget enforcement | `AgentRunner` budgets are constructor defaults only; runs can be unbounded in cost | Add token/turn budgets as settings and enforce them in the runner/controller |
| Exclude patterns not enforced on `files.read`/`files.search` | The agent could read files the index excluded | Check paths against the index/excludes in the file-access layer |
| The webview renders the fixture graph when opened outside VS Code; inside it displays the mapped Index Contract example (§2.11) | The prototype is example-driven, not a real analysis result | Wire `AnalysisController` over the live pipeline; the fixture stays as the offline fallback |
| No source navigation from a node | Detail panel is incomplete | Implement validated path resolution + `vscode.window.showTextDocument` |

---

## 6. Verification log

Commands actually run, with observed results:

| Command | Result |
| --- | --- |
| `npm run compile` | exit 0 -- `check-types` ok, `lint` ok, webview build (`tsc -b && vite build`, 182 modules), esbuild `[watch] build finished` |
| `npm test` | **133 passing, exit 0** (2026-11-10, prototype display path: +9 `exampleGraphProvider` tests; also 2026-11-10: 124 passing after fixing the duplicated `indexDoc` declaration and the stale `import`-entry-type expectation in `src/test/indexToGraphMapper.test.ts`). Earlier runs: 12 passing at the 2026-10-21 checkpoint; suite grew to 73 tests by 2026-11-08. One historical run ended with exit code `3221225477` (0xC0000005) *after* reporting "12 passing" -- a flaky VS Code test-host teardown on this machine, not a test failure; re-running gives exit 0. |
| Webview build (`npm run build` in `webview-ui`) | exit 0 (2026-11-10): `tsc -b` clean, `vite build` 182 modules transformed |
| `git commit` mapper | `26a9c0d feat: add deterministic Index v1 to Graph v2.0 mapper` (2 files, 765 insertions) |
| `npm run check-types` | exit 0 (2026-11-08) |
| `npm run lint` | exit 0 with 93 warnings, 0 errors (2026-11-08; mostly `curly` style warnings in the new analysis files) |
| `python -m unittest discover -s services/analyzer/tests -t services/analyzer` | **Ran 43 tests -- OK** (re-verified 2026-11-10 with exit code 0; also verified 2026-11-08) |
| `python -m analyzer services/analyzer/tests/fixtures/fastapi_app --index` | Valid JSON with keys `digest, files, endpoints, routeBindings, models, ormRelationships, references, reverseReferences, diagnostics, root, schemaVersion, language`; schemaVersion: "1.1"; language: "python"; digest counts: 8 files, 47 lines, 2 endpoints, 2 models, 2 ORM relationships, 4 references, 0 diagnostics; 2 route bindings; symbols have stable IDs; reverseReferences present and sorted |
| JSON parse check of `.vscode/launch.json` + `.vscode/tasks.json` | exit 0; `preLaunchTask = build` |
| F5 in the Extension Development Host | Verified manually by the user: the build task runs and the Extension Development Host opens |

Not yet verified (no implementation exists): a real OpenRouter call, the
validator behaviour, and rendering of a **real** analysis result. The
`AgentRunner` has only been exercised against mocked providers in tests; the
prototype display path renders the committed Index Contract example, not a live
run (see §2.11 for exactly what is displayed and what is suppressed).

---

## 7. Recommended next steps (smallest first)

0. ~~**Approve Index Contract v1**~~ -- **Done (2026-11-09):** the machine-readable
   schema (`packages/contracts/index-v1.schema.json`), TS types + structural
   validator (`src/analysis/indexContract.ts`), and complete/partial examples now
   exist with 20 offline tests.
1. **`FindingValidator`** -- two-tier validation over Index Contract v1
   entries: source-location validation; semantic validation only for
   `routeBindings` and other verifiable facts; everything else stays
   `inferred` or is dropped with diagnostics (per
   `docs/INDEX_TO_GRAPH_MAPPING.md`). Includes translating `AgentFinding`
   proposals into Index v1 interpretation entries (the adapter already does
   the translation; validation is what is missing).
2. **`ArchitectureStore` + Graph v2.0 contract** -- deterministically map
   validated Index v1 to the v2.0 document (no LLM); the `IndexToGraphMapper`
   (§2.10, committed as `26a9c0d`) already implements the pure translation and
   is wired into the prototype display path (§2.11). Still missing: the
   machine-readable v2.0 schema and Graph v2.0 examples, validated in both
   Python and TypeScript.
3. **`AnalysisController` + `code-visualizer.analyze` command** -- manual
   trigger, status output, cancellation; composes the provider, index, runner,
   and validator. Includes the privacy disclosure before the first run.
4. **Budget settings + exclude enforcement** -- expose `maxTokensPerRun` /
   `maxTurnsPerSubsystem` / `maxFilesPerTurn` / `maxLinesPerRead` as settings;
   enforce token budgets in the runner and exclude patterns in
   `files.read`/`files.search`.
5. **Webview real rendering path** -- update `webview-ui/src/types/architecture.ts`
   to v2.0, send the document over the message bridge, render evidence/status/
   origin, and add source navigation.

6. **Framework hints stay frozen.** The Python sidecar is a
   transitional/reference backend; new framework coverage is the AI Indexer's
   job, per `AGENTS.md`. Do not expand its rules or remove it yet.
7. **The rule-based relationship pass is not run in index mode.** The AI
   Indexer owns relationship interpretation; the reference backend only
   supplies verifiable facts.
