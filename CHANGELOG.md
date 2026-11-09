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
- Design documentation: agent tool boundary (`docs/AGENT_TOOLS.md`),
  index-to-graph mapping (`docs/INDEX_TO_GRAPH_MAPPING.md`), Milestone 3
  status log (`docs/MILESTONE_3_STATUS.md`), and the vertical-slice proposal
  (`docs/VERTICAL_SLICE_PROPOSAL.md`).
- Offline test suites: 73 extension tests across 5 files (provider, index
  backend, index service, agent runner, sample) and 43 Python analyzer tests.

### Fixed

- F5 (`Run Extension`) no longer hangs: the pre-launch task now runs the
  one-shot `build` task instead of the background `watch` task.

### Known limitations

- No `code-visualizer.analyze` command, `FindingValidator`, or
  `ArchitectureStore` yet; the webview still renders the labeled mock fixture
  and its types still describe contract v1.0.
- No privacy disclosure UI, budget settings, or token-budget enforcement yet.
