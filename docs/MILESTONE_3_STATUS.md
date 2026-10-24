# Milestone 3 Status -- End-to-End AI Analysis Proof of Concept

This document records what has actually been implemented for ROADMAP Milestone 3,
what was verified, and what remains. It is a work log, not a design document:
the design lives in `docs/ARCHITECTURE.md`, `docs/ARCHITECTURE_DATA_MODEL.md`,
and `docs/PRODUCT_SPEC.md`.

Last updated: 2026-10-21.

---

## 1. Progress summary

| # | Milestone 3 scope item | Status |
| --- | --- | --- |
| 1 | `ModelProvider` interface + `OpenRouterProvider` (plain HTTP) | **Done** |
| 2 | Credential + settings UX | **Partial** |
| 3 | `IndexService` over the Python sidecar | **Partial** (sidecar side done; index v1.1 complete) |
| 4 | Agent tool boundary specification | **Done** (`docs/AGENT_TOOLS.md`) |
| 5 | Index-to-graph mapping specification | **Done** (`docs/INDEX_TO_GRAPH_MAPPING.md`) |
| 6 | `AgentRunner` + agent tools | Not started |
| 7 | `FindingValidator` (two-tier validation) | Not started |
| 8 | Contract v2.0 document + real rendering path | Not started |

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
  the field is omitted entirely.
- Bounded per-attempt timeout (default 60 s) via `AbortController`; a timeout is
  reported as `timeout` and retried per policy.
- Retries transient failures with exponential backoff (base 500 ms, capped at
  8 s). A `Retry-After` header (seconds or HTTP date) overrides the backoff.
- 401 -> `authentication`, 400 -> `invalid_request`, 429 -> `rate_limit`,
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
`npm test` reports **12 passing**.

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
including the updated `services/analyzer/tests/test_indexer.py` with tests for
stable symbol IDs, language field, and reverse references.

**Still missing on the extension side:** the `IndexBackend` TypeScript interface,
the `IndexService` that spawns the sidecar and translates queries, and the
agent-facing query surface (`index.query`).


---

### 2.4 Agent tool boundary specification (scope item 4 -- done)

**`docs/AGENT_TOOLS.md`** specifies the five tools available to the AI agent:

1. `repo.overview` — returns the repository digest (tree, manifest, counts) for initial survey
2. `index.query` — queries the deterministic index for symbols, imports, references, reverseReferences, endpoints, models, routeBindings, ormRelationships, files
3. `files.read` — reads targeted source line ranges (max 200 lines per call)
4. `files.search` — searches source code with regex when the index cannot answer
5. `findings.submit` — submits structured findings (nodes/edges) with evidence for validation

Each tool has defined input/output shapes, constraints, and budget enforcement. The specification includes the tool invocation protocol, error handling, and implementation notes for the extension host.

### 2.5 Index-to-graph mapping specification (scope item 5 -- done)

**`docs/INDEX_TO_GRAPH_MAPPING.md`** specifies how the deterministic index (v1.1) and validated AI findings map to the architecture graph contract (v2.0). Key mappings:

- Index entries → graph nodes: files→modules, symbols→functions/classes, framework hints→endpoints/database_models
- Index references → graph edges: routeBindings→route_handler (confirmed), ormRelationships→orm_relationship (confirmed), references→calls (inferred), imports→imports (confirmed, hidden)
- AI findings → architectural nodes/edges with origin: "ai" and status: "inferred" by default
- Validation rules: source-location validation for all findings; semantic validation only for confirmed relationships
- Default graph vs drill-down: high-level view shows subsystems, endpoints, services, database_models; functions/classes/imports hidden until drill-down
- Hierarchy construction: deterministic module hierarchy + AI-identified subsystem hierarchy
- Evidence propagation: deterministic evidence kinds + ai_observation with validated flag
- Partial analysis units for budget-exhausted runs

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
6. **The index document is deterministic.** No timestamps, sorted outputs. This
   makes runs reproducible and lets the future cache key on content.

---

## 5. Known gaps and risks

| Gap | Impact | Next step |
| --- | --- | --- |
| No analysis command exists yet | The user cannot trigger a run | Add `code-visualizer.analyze` plus `AnalysisController` |
| `packages/contracts/` does not exist | The v2.0 contract is prose-only; no machine validation | Add the JSON Schema + complete/partial examples |
| Webview types are still contract **v1.0** (`webview-ui/src/types/architecture.ts`) | v2.0 fields (`origin`, `parentId`, `analysis`, `units`, `summaries`) are not typed in the UI | Update the UI types when the real document is produced |
| No privacy disclosure UI | Product requirement (AGENTS.md, PRODUCT_SPEC §8) unmet | Show the disclosure before the first analysis |
| No budget settings or enforcement | Runs can be unbounded in cost | Add token/turn budgets as part of the AgentRunner |
| `IndexService` does not exist | The sidecar is not yet reachable from the extension | Implement `IndexBackend` + spawn/parse the `--index` output |
| The webview currently renders a **fixture** graph (`webview-ui/src/fixtures/mock-architecture.ts`) | The UI has never displayed real analyzer output | Wire the real document through the message bridge |
| No source navigation from a node | Detail panel is incomplete | Implement validated path resolution + `vscode.window.showTextDocument` |

---

## 6. Verification log

Commands actually run, with observed results:

| Command | Result |
| --- | --- |
| `npm run compile` | exit 0 -- `check-types` ok, `lint` ok, `vite build` (182 modules, 3.55 s), esbuild `[watch] build finished` |
| `npm test` | **12 passing** -- 11 `OpenRouterProvider` tests + 1 sample test; exit 0. One earlier run ended with exit code `3221225477` (0xC0000005, access violation) *after* reporting "12 passing" -- a flaky VS Code test-host teardown on this machine, not a test failure. Re-running gives exit 0. |
| `python -m unittest discover -s services/analyzer/tests -t services/analyzer` | **Ran 43 tests -- OK** (3 new tests for v1.1: symbol IDs, language field, reverse references) |
| `python -m analyzer services/analyzer/tests/fixtures/fastapi_app --index` | Valid JSON with keys `digest, files, endpoints, routeBindings, models, ormRelationships, references, reverseReferences, diagnostics, root, schemaVersion, language`; schemaVersion: "1.1"; language: "python"; digest counts: 8 files, 47 lines, 2 endpoints, 2 models, 2 ORM relationships, 4 references, 0 diagnostics; 2 route bindings; symbols have stable IDs; reverseReferences present and sorted |
| JSON parse check of `.vscode/launch.json` + `.vscode/tasks.json` | exit 0; `preLaunchTask = build` |
| F5 in the Extension Development Host | Verified manually by the user: the build task runs and the Extension Development Host opens |

Not yet verified (no implementation exists): a real OpenRouter call, the agent
loop, validation behaviour, and rendering of a real analysis result.

---

## 7. Recommended next steps (smallest first)

1. **`IndexBackend` + `IndexService`** -- spawn `python -m analyzer <root> --index`,
   parse the JSON document (v1.1), expose `getDigest()`, `querySymbols()`,
   `queryReferences()`, `queryReverseReferences()`, `getEndpoints()`, `getModels()`,
   `getRouteBindings()`, `getOrmRelationships()`, `getFiles()`. Offline-testable
   with a fixture index document.
2. **`AnalysisController` + `code-visualizer.analyze` command** -- manual trigger,
   status output, cancellation; it composes the provider, index, runner, and
   validator when those exist.
3. **Privacy disclosure** before the first analysis (a modal that states which
   excerpts are sent to the provider).
4. **`packages/contracts/`** -- machine-readable v2.0 schema plus one complete and
   one partial example, validated in both Python and TypeScript.
5. **`AgentRunner`** with `repo.overview`, `index.query`, `files.read`, and
   `findings.submit`, bounded by turn/token budgets (per `docs/AGENT_TOOLS.md`).
6. **`FindingValidator`** -- source-location validation against the index; semantic
   validation only for `routeBindings` and other verifiable facts; everything else
   stays `inferred` or is dropped with diagnostics (per `docs/INDEX_TO_GRAPH_MAPPING.md`).

7. **Framework hints stay frozen.** The indexer reuses the existing FastAPI and
   ORM passes; new framework coverage is the agent's job, per `AGENTS.md`.
8. **The rule-based relationship pass is not run in index mode.** The agent owns
   relationship interpretation; the index only supplies verifiable facts.



