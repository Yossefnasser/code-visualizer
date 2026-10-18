# Product Specification — Code Visualizer

## 1. Product summary
Code Visualizer is a VS Code extension that helps developers understand the architecture of an existing Python backend by turning source-code evidence into an interactive, navigable graph.

It is intended to help answer questions such as:
- Which API endpoints exist?
- Which service/business-logic functions appear to handle a request?
- Which database models/tables are involved?
- Where in the source code is each displayed element defined?
- Which relationships are known, inferred, or unresolved?

## 2. Target user and primary value
The primary user is a developer opening an unfamiliar or growing codebase. The extension should reduce the effort required to build a mental map of the backend without requiring the developer to manually draw the architecture.

## 3. MVP user experience
1. The user opens a Python project in VS Code.
2. The user opens Code Visualizer from the extension.
3. The extension identifies or asks for the Python project root.
4. A local Python analyzer inspects supported source files without executing application code.
5. The extension displays a high-level graph.
6. The user selects a node to inspect details and navigate to its source location.
7. The user can refresh/re-run analysis after source changes.

## 4. Default visualization
The default view prioritizes understandable architecture over every symbol in the repository.

Primary node categories:
- API endpoint / route
- Service or business-logic component
- Database model/table
- Module/file, when useful for grouping or drill-down

Primary relationship categories:
- route-to-handler
- handler-to-service/function, when statically supported
- service-to-model or service-to-database operation, when statically supported
- model-to-model relationship, when supported by ORM metadata

The UI should support selecting a node, inspecting its details, and drilling down to implementation-level items such as files, classes, functions, and fields. The graph must not become a wall of every variable and import by default.

## 5. Evidence and uncertainty
Every relationship should be grounded in static evidence. Where the analyzer cannot determine a relationship confidently, it must not fabricate one.

Represent, where applicable:
- evidence kind or reason
- source file and line range
- confidence/status such as `confirmed`, `inferred`, or `unresolved`

Do not present an inferred relationship as a confirmed runtime call. Static analysis cannot guarantee the runtime path of dynamic Python code.

## 6. Supported analysis in the MVP
- Python source files and module structure.
- FastAPI route declarations and their handler functions.
- Recognizable calls from route handlers to service/business-logic functions.
- SQLAlchemy model classes, columns, and recognizable relationships.
- Django ORM model classes, fields, and recognizable relationships.
- Source locations suitable for opening the corresponding file in VS Code.
- Clear diagnostics for unsupported patterns or analysis failures.

ORM support should be implemented behind a common adapter/interface so additional ORMs can be added later without redesigning the graph contract.

## 7. Explicitly out of scope for the MVP
- MCP server/client integration.
- LLM-based code interpretation or autonomous agent workflows.
- Impact analysis and change prediction.
- Automated code modification or code generation.
- Runtime tracing or guaranteed call-graph reconstruction.
- Full support for every Python web framework.
- Django URL routing; Django ORM model discovery is in scope.
- Other programming languages.
- Remote/cloud analysis service.
- Authentication, accounts, collaboration, or hosted storage.

## 8. Product quality requirements
- Analysis runs locally on the user's machine.
- Source code is not uploaded to a remote service by the analyzer.
- Analysis should not execute the analyzed application.
- Large or unsupported codebases should fail gracefully and provide useful diagnostics.
- The graph should remain readable and navigable.
- Clicking an element should lead to its source when a valid source location exists.
- The UI should distinguish unavailable information from an empty result.
- The project should be testable in small units: analyzer parsing, contract validation, extension/analyzer communication, and UI rendering.

## 9. MVP success criteria
The MVP is useful when it can:
- Open in VS Code and display a graph.
- Analyze a small sample FastAPI project.
- Discover supported SQLAlchemy and Django ORM models.
- Show evidence-backed relationships without inventing unsupported ones.
- Let the user inspect a node and navigate to source.
- Display actionable errors if Python is unavailable or analysis fails.
- Re-run analysis on request.
