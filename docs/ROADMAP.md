# Implementation Roadmap

## Ground rules
- Implement one milestone at a time. Do not start the next milestone until the current milestone's acceptance criteria pass or the user explicitly changes priority.
- Product decision (revised): the AI agent is the primary architecture engine. The rule-based Python analyzer is not the primary engine; its mechanical parts support the agent as a temporary IndexBackend, and its interpretation rules are deprecated. Do not expand hand-written, framework-specific rules.
- Current priority: Milestone 3 -- the smallest end-to-end proof of concept.

## Milestone 1 -- Extension shell and UI prototype (DONE)
Extension opens the React Flow webview via `code-visualizer.openVisualizer`; custom node renderers (endpoint, service, database model) render a clearly labeled fixture graph; details panel exists. No analysis integration.

## Milestone 2 -- Mechanical utilities (DONE, re-scoped)
The Python analyzer was completed as a rule-based engine and is now re-scoped: mechanical utilities are retained, framework detection is demoted to hints, and interpretation rules are deprecated. See the disposition table in `docs/ARCHITECTURE.md` section 9. Acceptance criteria (met): the analyzer runs on fixture projects without executing target code; output matches the shared contract; parse errors surface as diagnostics; tests pass.

## Milestone 3 -- End-to-end AI analysis proof of concept (IN PROGRESS)

Goal: configure OpenRouter, run a bounded single-agent analysis over a small real Python repository, validate the findings, and display the result in the existing React Flow UI.

Status legend: `[x]` done and verified, `[~]` partially done, `[ ]` not started.
Detailed progress, decisions, and known gaps are tracked in `docs/MILESTONE_3_STATUS.md`.

Scope (one thin vertical slice, in order):
1. `[x]` `ModelProvider` interface plus `OpenRouterProvider` using plain HTTP (no SDK): configurable model id, timeout, retry policy, and max tokens; request structured output (JSON schema) when the selected model supports it.
   - Done: `src/analysis/modelProvider.ts` (interface, typed error taxonomy, retryability rules) and `src/analysis/openRouterProvider.ts` (chat-completions over `fetch`, bounded timeout, exponential backoff honoring `Retry-After`, 401/400 -> non-retryable, usage/cost parsing, injectable `fetchImpl`/`sleep` for offline tests).
2. `[~]` Credential and settings UX: a command to store the API key in SecretStorage; settings for provider, model, and budgets; a first-run flow that discloses the privacy boundary. Model selection is practical (free-text model id plus a short suggested list documented in this repository); full model discovery is deferred.
   - Done: `Code Visualizer: Set OpenRouter API Key` command (SecretStorage only), settings `codeVisualizer.openRouter.model` and `codeVisualizer.openRouter.structuredOutput`, helper module `src/analysis/openRouterConfig.ts`.
   - Not done: budget settings, the first-run privacy disclosure flow, and the command that actually starts an analysis.
3. `[x]` Minimal IndexService with an IndexBackend implemented by the Python sidecar: file discovery, symbols, imports/references, framework hints, and a repo digest.
   - Done on the sidecar side: `services/analyzer/src/analyzer/indexer.py` emits a deterministic index document v1.1 (digest, files, symbols with stable IDs, imports, references, reverseReferences, framework hints, language field) via `python -m analyzer <root> --index`; 43 analyzer tests pass.
   - Not done: the TypeScript `IndexBackend` interface and `IndexService` that spawns the sidecar and translates queries.
4. `[x]` Agent tool boundary specified: `repo.overview`, `index.query`, `files.read`, `files.search`, `findings.submit` documented in `docs/AGENT_TOOLS.md`.
5. `[x]` Index-to-graph mapping specified in `docs/INDEX_TO_GRAPH_MAPPING.md`.
6. `[ ]` AgentRunner with tools: `repo.overview`, `index.query`, `files.read` (line ranges, per-call budget), and `findings.submit`; a bounded single-agent loop that surveys the repository and explores one or two subsystems.
7. `[ ]` FindingValidator with two-tier validation: deterministic source-location validation against the index; semantic validation gates `confirmed`; AI-only relationships remain `inferred`; unverifiable claims are downgraded or dropped with diagnostics; one repair round-trip for invalid model output.
8. `[ ]` Assemble the result as a contract v2.0 document and render it in the React Flow webview behind the real analysis path (the mock fixture is retained for offline UI development). Manual trigger only.
   - Note: `packages/contracts/` (machine-readable contract v2.0 schema + examples) does not exist yet; the contract is currently specified in `docs/ARCHITECTURE_DATA_MODEL.md` only.

Acceptance criteria:
- `[~]` The user can store an OpenRouter key and choose a model; running the analysis is not yet possible.
- `[ ]` The graph renders in React Flow with evidence and statuses; AI-only relationships display as `inferred`; origin is visible per node/edge.
- `[ ]` Findings with invalid source locations are rejected, repaired, or downgraded; unverifiable relationships are never `confirmed`.
- `[ ]` Invalid or incomplete model responses produce bounded repair attempts, then actionable errors and partial status.
- `[ ]` Token usage and estimated cost for the run are recorded and visible.
- `[x]` All AI tests run offline against a mocked `ModelProvider`; no real API calls in tests.
- `[x]` No new hand-written framework interpretation rules were added.
- `[~]` Secrets appear only in SecretStorage; the privacy disclosure is shown before the first analysis (disclosure flow still to do).

### Tooling: running and debugging the extension
- `npm run compile` performs a full one-shot build: type-check, lint, webview build (`webview-ui`), and the extension bundle (`dist/extension.js`).
- F5 (`Run Extension`) uses the one-shot `build` task (`.vscode/tasks.json`) as its `preLaunchTask` and then opens the Extension Development Host. The background `watch` task is intentionally not used as a pre-launch task because it must signal readiness through a problem matcher and can hang the launch.
- The `Run Extension` launch configuration only exists when this repository is the opened workspace folder.


## Milestone 4 -- Hierarchy and exploration quality
Goal: hierarchical understanding beyond a flat graph.
Scope: subsystem discovery and `subsystem` nodes with `parentId`; summaries per subsystem/module; stronger reference-following across modules; budget tuning; exploring multiple subsystems per run; resuming partial runs via `units`.
Acceptance criteria:
- Results contain repo-overview, subsystem, and module levels suitable for drill-down.
- Partial runs record pending scopes in `units` and can be resumed or cleanly re-explored.
- Relationships that cross module boundaries are traced through the index rather than by reading every file.

## Milestone 5 -- Robustness and provider hardening
Scope: strict structured-output validation with repair rounds for every model call; timeouts, retries, and rate-limit handling; a typed error taxonomy surfaced in the UI; exclude patterns enforced in the index and in agent reads; model-selection polish.
Acceptance criteria:
- Network failures, rate limits, and malformed output produce typed diagnostics and never a silent empty graph.
- Excluded files are never indexed, read by the agent, or sent to the provider.
- Runs respect configured token/time budgets and stop cleanly with partial status.

## Milestone 6 -- Caching and incremental analysis (deferred by decision)
Starts only after the end-to-end AI graph works.
Scope: file-hash cache of per-scope results; invalidation of affected scopes via the reverse-reference graph; partial re-runs and result merging. Includes the rule-engine decommission step: remove deprecated interpretation code (`is_service_module`, rule-based relationship semantics) once AI analysis demonstrates parity.
Acceptance criteria:
- Unchanged scopes are served from cache; a changed file triggers re-analysis only of its affected scope.
- Deprecated rule-based interpretation code is removed or clearly quarantined behind the hint interface.

## Milestone 7 -- Usable architecture explorer
Scope: drill-down UI over the hierarchy; details/evidence panel parity including AI provenance; a diagnostics panel; cost/usage display; refresh UX; layout improvements for medium-sized projects.
Acceptance criteria:
- Selecting a node reveals metadata, evidence, status, and origin.
- Source navigation opens the expected file and line.
- Users can move between hierarchy levels; partial coverage and diagnostics are visible.

## Later milestones -- explicit approval required
- Multi-agent orchestration: only with a documented design showing a single agent cannot meet quality/budget requirements.
- Additional providers (Anthropic, local models) and richer model-discovery UX.
- Additional languages (TypeScript first) and additional hint extractors only where patterns are high-confidence and deterministic.
- Automatic refresh beyond Milestone 6, impact analysis, MCP integration, runtime tracing.

Do not implement later features without explicit approval.