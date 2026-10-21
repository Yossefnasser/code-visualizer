# Product Specification -- Code Visualizer

## 1. Product summary
Code Visualizer is a VS Code extension that helps developers understand the architecture of an existing codebase. It combines a deterministic code index with AI interpretation: an AI agent explores the repository through bounded tools, identifies architectural components and relationships, and the extension renders the findings as an interactive, navigable graph.

It is intended to help answer questions such as:
- What are the main subsystems and what is each responsible for?
- Which API endpoints, services/business components, and data models exist?
- What meaningful flows connect them, and where in the source is each element defined?
- Which relationships are verified, inferred, or unresolved?

## 2. Target user and primary value
The primary user is a developer opening an unfamiliar or growing codebase. The extension should reduce the effort required to build a mental map of the application without the developer manually drawing the architecture and without the product maintaining a growing collection of hand-written, framework-specific rules.

## 3. MVP user experience
1. The user opens a project in VS Code.
2. The user opens Code Visualizer.
3. On first use, the user selects a model provider and model and stores an API key in VS Code SecretStorage. OpenRouter is the initial provider.
4. The user triggers analysis manually.
5. A deterministic indexer builds a lightweight index of files, symbols, imports, and references. The agent explores the repository in bounded steps, reading targeted source excerpts and following references across modules.
6. The agent submits structured findings; the extension validates them before display.
7. The graph renders. The user selects a node to inspect details and evidence and navigate to source.
8. The user re-runs analysis manually after source changes.

## 4. Default visualization
The default view prioritizes understandable architecture over every symbol in the repository. Primary node categories (identified by the agent, supported by index and hint evidence):
- Subsystem/module groups and the repository overview
- API endpoint / route
- Service or business-logic component
- Database model/table
- Module/file, class, and function for drill-down

Primary relationship categories: route-to-handler, handler-to-service, service-to-model or database operation, model-to-model, and other application-flow relationships the agent can substantiate with evidence.

The UI supports drilling down from the hierarchy to implementation-level items and back. The graph must not become a wall of every variable and import by default.

## 5. Evidence and uncertainty
Every relationship must be grounded in evidence with source locations. Validation is two-tiered:
- **Source-location validation** (deterministic): the referenced file, symbol, and line range exist as cited.
- **Semantic relationship validation** (separate): the claimed relationship itself is supported by code, for example a verified route binding or an ORM declaration. The existence of two symbols never proves a relationship between them.

Statuses:
- `confirmed`: the relationship was deterministically verified.
- `inferred`: plausible and evidence-backed but not verified; the default for AI-only claims.
- `unresolved`: a relevant reference could not be resolved confidently.

Findings the agent cannot substantiate are downgraded or dropped with diagnostics, never presented as confirmed. Do not present an inferred relationship as a guaranteed runtime path.

## 6. Analysis approach
- A single tool-using agent; no multi-agent orchestration in the MVP.
- OpenRouter as the initial model gateway behind a provider abstraction; the model is user-configurable; no free model or free API usage is assumed.
- A deterministic indexer provides file discovery with exclusions, safe reading, a symbol/import/reference index, and framework hints. It supports the agent; it does not interpret architecture.
- Explicit budgets: per-call context, files per turn, turns per subsystem, tokens per run. Budget exhaustion produces partial results plus diagnostics, never silent truncation.
- Hierarchical understanding: repository overview, then subsystems, then modules, then components -- produced incrementally rather than from one prompt.
- Python is the first supported target; the pipeline is language-neutral by design.

## 7. Explicitly out of scope for the MVP
- Automatic refresh and advanced incremental caching (deferred until the end-to-end AI graph works).
- Multi-agent orchestration.
- Languages other than Python.
- Runtime tracing or guaranteed call-graph reconstruction.
- Impact analysis, automated code modification, or code generation.
- MCP server/client integration.
- A hosted/cloud analysis service; accounts, collaboration, hosted storage.
- Elaborate model-discovery or marketplace UX; a practical model-selection flow is enough for now.

## 8. Product quality requirements
- Indexing runs locally on the user's machine; the extension itself sends no telemetry.
- **Privacy boundary:** analysis requires sending selected source excerpts to the configured model provider (OpenRouter and its upstream model vendors). The user must be informed before enabling AI analysis, and configured exclude patterns must be honored.
- Credentials live only in VS Code SecretStorage.
- Analysis must never execute the analyzed application.
- Token usage and estimated cost are recorded and shown per run; budget ceilings stop runs cleanly with partial status.
- Large or unsupported codebases degrade gracefully with useful diagnostics. Coverage may be partial for very large repositories, and the UI must say so; the design does not guarantee scalability for arbitrarily large repositories.
- Clicking an element opens its source when a valid location exists.
- The UI distinguishes unavailable information from an empty result.
- The project is testable in small units; AI-dependent behavior must be testable offline with a mocked provider.

## 9. MVP success criteria (end-to-end proof of concept)
The MVP is useful when it can:
- Let the user configure an OpenRouter API key (SecretStorage) and model, with clear errors for missing or invalid configuration.
- Manually analyze a small real Python repository using bounded agent exploration.
- Produce validated, structured findings: source locations verified; AI-only relationships shown as `inferred`; unverifiable claims downgraded or dropped with diagnostics.
- Render the resulting graph in the existing React Flow UI with evidence, statuses, and node inspection.
- Show token usage and estimated cost for the run, and actionable errors for failures.