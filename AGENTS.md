# Agent Instructions -- Code Visualizer

## Mission
Build `code-visualizer`, a VS Code extension that helps developers understand the architecture of an existing codebase. An AI agent, supported by a deterministic code index, analyzes the repository and the extension renders the findings as an interactive graph.

## Read these documents first
Before changing code, read:
1. `docs/PRODUCT_SPEC.md`
2. `docs/ARCHITECTURE.md`
3. `docs/ARCHITECTURE_DATA_MODEL.md`
4. `docs/ROADMAP.md`
5. `docs/DEVELOPMENT_WORKFLOW.md`

Follow the documents as the project's source of truth. If implementation details conflict with them, stop and explain the conflict rather than silently changing the design.

The design documents describe the **target**. For what is actually implemented and verified today, read `docs/MILESTONE_3_STATUS.md` (progress log) and the Milestone 3 section of `docs/ROADMAP.md` (status markers). Do not assume a component described in the design docs exists.

## Core decisions
- The product is a VS Code extension with a React-based webview; the graph uses React Flow (`@xyflow/react`).
- **AI-first architecture understanding.** A single, tool-using AI agent is the primary code-understanding engine: it identifies business responsibilities, traces application flows, classifies components, and determines architectural relationships. OpenRouter is the initial model gateway, behind a provider abstraction so the product is not permanently coupled to one provider.
- **Deterministic indexing supports the agent; it never substitutes for AI interpretation.** File discovery, safe file reading, symbol/import/reference indexing, and search live behind a replaceable `IndexBackend` interface. The first backend reuses the existing Python analyzer as a local indexer sidecar. This is temporary scaffolding chosen for speed, not the permanent architecture engine.
- **High-confidence framework hints are retained; interpretation rules are not.** Deterministic extraction of FastAPI route decorators and SQLAlchemy/Django ORM declarations is kept as index hints and validation aids. Do not add new hand-written framework rules. Rule-based service classification (`is_service_module`) and framework-specific relationship heuristics are deprecated as the primary interpretation mechanism and must not grow.
- **Language-neutral design.** The agent workflow, data contract, and provider interface must not assume Python. Python is the first supported target, not a permanent restriction.
- **Two-tier evidence validation.** Verifying that a file, symbol, or source location exists (source-location validation) is different from verifying a relationship (semantic validation). The existence of two symbols does not prove a relationship between them. AI-only relationships remain `inferred` unless the relationship itself can be deterministically verified; only then may they be `confirmed`. Never fabricate evidence; record uncertainty honestly.
- **Manual analysis is the MVP trigger.** Automatic refresh and advanced incremental caching are deferred until a real AI-generated graph works end to end.
- **Credentials and cost.** OpenRouter API keys are stored only in VS Code SecretStorage, never hardcoded or written to settings files. The model is user-configurable; do not assume a free model or free API usage. Token usage and estimated cost are recorded and shown per run.
- **Privacy.** When analysis runs, source excerpts the agent selects are sent to the configured model provider. This must be disclosed to the user before enabling analysis, and configured exclude patterns must be honored. The extension itself sends no telemetry.
- MCP integration, impact analysis, code generation, multi-agent orchestration, and other languages are not MVP requirements.

## Repository boundaries
- `src/`: VS Code extension host code, including the AI analysis pipeline (index service, agent runner, provider layer, validation, cache).
- `webview-ui/`: React + TypeScript + React Flow user interface. Must stay provider-agnostic: no OpenRouter or model-provider types.
- `services/analyzer/`: Python indexer sidecar (the first `IndexBackend`) plus framework hint extractors. Temporary; see the migration notes in `docs/ARCHITECTURE.md` for the retain/demote/deprecate/remove decisions.
- `packages/contracts/`: shared, versioned architecture data contract (v2.0) and examples.
- `docs/`: product, architecture, contract, roadmap, and workflow documentation.

Do not move or rename existing scaffolding without explaining why and updating the docs.

## Working rules
- Work on only the current roadmap milestone. The current priority is the smallest end-to-end proof of concept: OpenRouter configuration, bounded agent exploration of a real Python repository, validated structured findings, and display in the existing React Flow UI.
- Inspect the existing repository before editing it. Do not assume file paths or overwrite existing configuration blindly.
- Prefer small, understandable changes; do not build large generic frameworks before a working vertical slice exists.
- Do not install a dependency unless it is needed for the current milestone; explain why first. The OpenRouter integration must not require an SDK.
- Preserve the existing TypeScript, Vite, Tailwind CSS v4, and React Flow setup unless a verified issue requires a change.
- All AI-dependent behavior must be testable offline through a mocked `ModelProvider`. Never call real model APIs in tests.
- Never claim a validation, command, or test passed unless it was actually run and its result was observed.
- Do not hardcode fake architecture data into production analysis flows. Mock/fixture data is acceptable only in clearly labeled UI fixtures.
- Do not silently swallow analysis errors; surface actionable diagnostics and analysis status.
- Do not add secrets, API keys, or telemetry to code or configuration files.
- Avoid destructive commands and broad file rewrites.

## Required response after each task
Report:
1. What changed.
2. Which files changed.
3. Commands/tests actually run and their results.
4. Any limitations or decisions needed from the user.
5. The next smallest recommended step.

If requirements are ambiguous, ask one focused question before making a consequential architectural decision.