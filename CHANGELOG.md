# Change Log

All notable changes to the "code-visualizer" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added

- OpenRouter provider layer (`src/analysis/modelProvider.ts`,
  `src/analysis/openRouterProvider.ts`): plain-HTTP `ModelProvider` with typed
  errors, bounded retries honoring `Retry-After`, timeouts, cancellation, and
  provider-reported token/cost accounting. No SDK.
- Credential and settings UX: `Code Visualizer: Set OpenRouter API Key`
  command (SecretStorage only) plus `codeVisualizer.openRouter.model` and
  `codeVisualizer.openRouter.structuredOutput` settings
  (`src/analysis/openRouterConfig.ts`).
- Deterministic index document v1.1 (`services/analyzer/src/analyzer/indexer.py`,
  `--index` mode): digest, files/symbols with stable IDs, imports, references,
  reverse references, FastAPI/ORM hints, per-file language field.
- Extension-side index access: `IndexBackend` interface
  (`src/analysis/indexBackend.ts`), `PythonIndexBackend` sidecar spawner with
  typed errors (`src/analysis/pythonIndexBackend.ts`), and `IndexService`
  with repo overview and unified `index.query` surface
  (`src/analysis/indexService.ts`).
- `AgentRunner` (`src/analysis/agentRunner.ts`): bounded single-agent tool
  loop (`repo.overview`, `index.query`, `files.read`, `files.search`) with
  path-safe file access, ripgrep search with fallback, turn/tool-call/timeout
  budgets, and findings returned as final JSON (`inferred`/`unresolved` only).
- Index Contract v1: machine-readable JSON Schema
  (`packages/contracts/index-v1.schema.json`) with complete and partial
  examples, plus TypeScript types and a structural validator with
  cross-reference checks (`src/analysis/indexContract.ts`).
- `AgentFinding` -> Index Contract v1 adapter (`src/analysis/agentFindingAdapter.ts`):
  one finding maps to one interpretation entry; edge findings without real
  endpoints are excluded with diagnostics instead of being fabricated.
- `IndexToGraphMapper` (`src/analysis/indexToGraphMapper.ts`): deterministic,
  LLM-free translation from a validated Index Contract v1 document to the
  Graph v2.0 webview shape; validates input first and never drops unsupported
  entries silently.
- `formatProviderDiagnostic` (`src/analysis/providerDiagnostics.ts`): single
  source of human-readable provider-error diagnostics — one sentence pattern
  per `ModelProviderError.kind` (category, action, sanitized provider
  message), with optional `retryAfterMs`/`status` rendered only when present.
  Available to the command layer (`code-visualizer.analyze`) when it lands; not
  wired into any surface yet.
- `FindingValidator` (`src/analysis/findingValidator.ts`): two-tier validation
  over Index Contract v1 entries against the deterministic index —
  source-location verification with `metadata.sourceLocationValidated` flags,
  a bounded optional repair round with cascade drops, and semantic gating:
  only relationships verifiable against `routeBindings`/`ormRelationships`/
  `references`/`files[].imports` may be or become `confirmed`; everything
  else is demoted to `inferred` with diagnostics. Supporting change:
  `adaptAgentFindings` accepts `externalEntryIds` for relationship endpoints
  resolved by later-merged deterministic facts.
- `toContractEntries` (`src/analysis/indexToContractEntries.ts`): deterministic
  Index v1.1 → Index Contract v1 **fact** entries per
  `docs/INDEX_TO_GRAPH_MAPPING.md` §2.1–2.3/§3.1–3.4 — modules, symbols (with
  class parents), routes, models, and confirmed `route_handler`/
  `orm_relationship`/`calls` edges; `imports` opt-in. An edge is emitted only
  when both endpoints have fact entries (unresolvable ends become diagnostics,
  never dangling or fabricated edges).
- `AnalysisController` (`src/analysis/analysisController.ts`): composes
  build index → agent run → adapt findings → merge facts → two-tier validation
  → Graph v2.0, returning `{ graph, document, metadata }`. Dependency-injected
  and offline-testable; threads `AbortSignal`; deterministic facts win id
  collisions; failed/partial agent runs become honest analysis status plus
  diagnostics (never a fabricated graph or a swallowed error); stable
  `AnalysisError` codes for pipeline failures; per-run token/cost usage is
  recorded in metadata and surfaced as an `analysis_budget` diagnostic.
- Prototype display path: `exampleGraphProvider` loads the committed Index
  Contract example and maps it to Graph v2.0; the extension posts the resulting
  graph to the webview over a new host↔webview message bridge
  (`webviewReady` / `architectureGraph`). Outside VS Code the webview keeps
  rendering the clearly labeled fixture. Semantic relationship types
  (`calls`, `uses_model`, `uses`, `reads`, `writes`) are suppressed for display
  until validation exists, and the suppression count is announced in the
  UI banner. Webview types upgraded to contract v2.0 (`origin`, `parentId`,
  `status`, `analysis`, `units`); Details panel shows provenance and parent.
- Design documentation: agent tool boundary (`docs/AGENT_TOOLS.md`),
  index-to-graph mapping (`docs/INDEX_TO_GRAPH_MAPPING.md`), Milestone 3
  status log (`docs/MILESTONE_3_STATUS.md`), and the vertical-slice proposal
  (`docs/VERTICAL_SLICE_PROPOSAL.md`).
- Offline test suites: 186 extension tests across 13 files (provider, provider
  diagnostics, index
  backend, index service, agent runner, Index Contract, finding adapter,
  index-to-graph mapper, index-to-contract entries, analysis controller,
  example graph provider, finding validator, sample)
  and 43 Python analyzer tests.

### Fixed

- F5 (`Run Extension`) no longer hangs: the pre-launch task now runs the
  one-shot `build` task instead of the background `watch` task.

### Known limitations

- No `code-visualizer.analyze` command yet, so the pipeline is composed but not
  reachable from the UI; the displayed graph is still the mapped Index Contract
  example, not a live analysis. The fixture remains the offline fallback.
  Semantic relationship types are suppressed for display until the live path
  lands.
- AI edge findings from a real model run are excluded (`unmappable_edge_missing_endpoints`):
  the `AgentFinding` schema has no endpoint fields and sets
  `additionalProperties: false`. The controller supports endpoints; the schema
  and prompt do not emit them yet.
- The model-backed repair round-trip for the FindingValidator is still
  unsupplied: `AnalysisController` does not pass a `repair` function yet, so
  unverifiable citations are dropped without a repair attempt.
- The Architecture Graph Contract v2.0 schema
  (`packages/contracts/`) does not exist yet; v2.0 is prose-only in
  `docs/ARCHITECTURE_DATA_MODEL.md` §2-13.
- No privacy disclosure UI, budget settings, or token-budget enforcement yet.
