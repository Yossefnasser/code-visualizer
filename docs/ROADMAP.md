# Implementation Roadmap

## Ground rules
Implement one milestone at a time. Do not start the next milestone until the current milestone's acceptance criteria pass or the user explicitly changes priority.

## Milestone 1 — Extension shell and UI prototype
Goal: open the VS Code extension and render a small, clearly labeled fixture graph in the React Flow webview.

Scope:
- Inspect the existing extension scaffold and scripts.
- Ensure the extension can open its webview.
- Build a minimal React Flow canvas.
- Create small custom node renderers for endpoint, service, and database model.
- Database model node should visually suggest a database/table (a cylinder-like top/shape is fine) and show the model/table name clearly.
- Add a simple selected-node details panel if it fits the milestone.
- Keep mock graph data in a dedicated fixture file.

Acceptance criteria:
- Extension launches in the VS Code Extension Development Host.
- The command opens the webview.
- A fixture graph with at least one endpoint, one service, and one database model renders.
- Edges connect the expected nodes.
- No analyzer integration is required yet.
- UI build succeeds using the existing project scripts.
- The fixture data is clearly marked as mock data.

## Milestone 2 — Python analyzer independently
Goal: create a local Python analyzer that emits normalized graph JSON for a small fixture project.

Scope:
- Create analyzer package structure and documented run command.
- Discover Python files while skipping common virtual environment/cache/build directories.
- Parse with `ast`; do not execute project code.
- Discover FastAPI routes in common statically recognizable decorator forms.
- Define ORM adapter interface.
- Add SQLAlchemy model discovery.
- Add Django ORM model discovery.
- Emit diagnostics for parse failures and unsupported patterns.
- Add unit tests and a sample output fixture.

Acceptance criteria:
- Analyzer runs on a sample repository without requiring the target project to be imported/executed.
- Supported route/model declarations are discovered in tests.
- Output matches the shared contract.
- Parse errors are reported as diagnostics and do not necessarily abort all analysis.
- Tests pass.

## Milestone 3 — Connect analyzer to extension
Goal: replace the mock graph with analyzer output.

Scope:
- Document and implement the process protocol.
- Extension host starts the analyzer and captures structured output.
- Logs cannot corrupt the JSON protocol.
- Handle missing Python, analyzer failure, malformed output, and cancellation.
- Pass valid graph data to the webview.
- Add loading, empty, and error states.

Acceptance criteria:
- An example FastAPI project produces a graph in the extension.
- Invalid/missing analyzer setup produces a useful error.
- UI does not crash on an empty graph or diagnostics.
- The extension host does not execute target application code.

## Milestone 4 — Usable architecture explorer
Goal: make the graph useful beyond a demo.

Scope:
- Node detail inspector with source/evidence.
- Open source file and line from a node/evidence.
- High-level graph by default.
- Drill-down to functions/classes/files/fields.
- Basic filters and graph refresh.
- Improve layout and readability for medium-sized sample projects.

Acceptance criteria:
- Selecting a node reveals relevant metadata and evidence.
- Source navigation opens the expected file and line.
- Users can return from drill-down to the high-level graph.
- Relationships display their evidence status.
- Refresh shows current analysis results and handles errors.

## Later milestones — Not part of MVP
- MCP integration for AI coding agents.
- AI-assisted interpretation or summarization.
- Impact analysis for proposed code changes.
- More frameworks, languages, and ORMs.
- Runtime tracing or dynamic analysis.
- Advanced filtering, persistence, and performance optimization.

Do not implement later features without explicit approval.
