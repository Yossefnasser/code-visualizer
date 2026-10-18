# Agent Instructions — Code Visualizer

## Mission
Build `code-visualizer`, a VS Code extension that analyzes a Python backend locally and visualizes its architecture as an interactive graph.

## Read these documents first
Before changing code, read:
1. `docs/PRODUCT_SPEC.md`
2. `docs/ARCHITECTURE.md`
3. `docs/ARCHITECTURE_DATA_MODEL.md`
4. `docs/ROADMAP.md`
5. `docs/DEVELOPMENT_WORKFLOW.md`

Follow the documents as the project's source of truth. If implementation details conflict with them, stop and explain the conflict rather than silently changing the design.

## Core decisions
- The product is a VS Code extension with a React-based webview.
- The visualization uses React Flow (`@xyflow/react`).
- Static source analysis runs locally in a separate Python analyzer process.
- The MVP is rule-based/static analysis; do not add an LLM to the analyzer.
- Initial analysis scope: Python modules/files, FastAPI routes, recognizable links from routes to service/business logic, SQLAlchemy models, and Django ORM models.
- Django ORM support means discovering Django model definitions, not supporting Django URL routing or the entire Django web framework.
- The default graph is high-level: endpoints, services/business logic, and database tables/models. Users can drill down to files, classes, functions, and fields.
- Relationships must be based on evidence. Show uncertainty or unresolved relationships instead of inventing connections.
- MCP integration, AI interpretation, impact analysis, code generation, and broad language/framework support are not MVP requirements.

## Repository boundaries
Keep responsibilities separated:
- `src/`: VS Code extension host code.
- `webview-ui/`: React + TypeScript + React Flow user interface.
- `services/analyzer/`: local Python source analyzer.
- `packages/contracts/`: shared, versioned architecture data contract and examples, unless the repository's existing build setup makes a language-neutral JSON Schema file more appropriate.
- `docs/`: product, architecture, contract, and workflow documentation.

Do not move or rename the existing scaffold without explaining why and updating the docs.

## Working rules
- Work on only the current roadmap milestone unless explicitly asked otherwise.
- Inspect the existing repository before editing it. Do not assume file paths or overwrite existing configuration blindly.
- Prefer small, understandable changes over large rewrites.
- Do not install a dependency unless it is needed for the current milestone. Explain why before adding a major dependency.
- Preserve the existing TypeScript, Vite, Tailwind CSS v4, and React Flow setup unless a verified issue requires a change.
- Use the existing project conventions and scripts where possible.
- Keep UI components focused and reusable. Do not install third-party UI components merely to draw a simple custom node when a small local component will do.
- Do not hardcode fake architecture data into production analyzer flows. Mock data is acceptable for the initial UI milestone and must be clearly labeled as fixture/demo data.
- Never claim a command or test passed unless it was actually run and its result was observed.
- Do not silently swallow analyzer errors. Return actionable error messages to the extension.
- Avoid destructive commands and broad file rewrites.
- Do not add secrets, API keys, or telemetry without explicit approval.

## Required response after each task
Report:
1. What changed.
2. Which files changed.
3. Commands/tests actually run and their results.
4. Any limitations or decisions needed from the user.
5. The next smallest recommended step.

If requirements are ambiguous, ask one focused question before making a consequential architectural decision.
