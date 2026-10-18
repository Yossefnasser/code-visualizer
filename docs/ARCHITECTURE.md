# Technical Architecture — Code Visualizer

## 1. System overview

```text
VS Code Extension Host (TypeScript)
  ├─ command registration / activation
  ├─ workspace selection and validation
  ├─ webview lifecycle and message bridge
  └─ starts local Python analyzer and handles diagnostics
                 │
                 │ versioned JSON request/response
                 ▼
Local Python Analyzer
  ├─ project/file discovery
  ├─ Python AST-based analysis
  ├─ FastAPI route discovery
  ├─ service/business-logic relationship extraction
  ├─ ORM adapter interface
  │    ├─ SQLAlchemy adapter
  │    └─ Django ORM adapter
  └─ normalized architecture graph + evidence
                 │
                 │ architecture data over extension host
                 ▼
React Webview (TypeScript)
  ├─ React Flow canvas
  ├─ custom node types and edges
  ├─ detail/inspector panel
  ├─ filters and drill-down
  └─ source-navigation messages to extension host
```

## 2. Responsibilities

### VS Code extension host — `src/`
Responsible for:
- Registering commands and opening the visualization.
- Finding and validating the current workspace.
- Creating and disposing the webview.
- Starting the local Python analyzer using a child process.
- Passing structured requests and receiving structured results.
- Translating webview source-navigation requests into VS Code editor navigation.
- Handling errors, cancellation, refresh, and lifecycle cleanup.

It should not contain the Python parsing implementation or React UI logic.

### React webview — `webview-ui/`
Responsible for:
- Rendering the graph with `@xyflow/react`.
- Defining custom node renderers for endpoints, services, and database models.
- Rendering edges with meaningful labels/styles based on relationship metadata.
- Showing selected-node details and evidence.
- Sending typed messages to the extension host.
- Displaying loading, empty, and error states.

It should not directly spawn Python or read arbitrary workspace files. The extension host mediates privileged VS Code operations.

### Python analyzer — `services/analyzer/`
Responsible for:
- Discovering candidate Python files while excluding virtual environments, caches, generated output, and other configured ignored directories.
- Parsing Python source without executing it.
- Extracting supported declarations and evidence.
- Applying framework/ORM-specific adapters.
- Producing normalized output that conforms to the architecture data contract.
- Returning diagnostics for unsupported or ambiguous patterns.

Use Python's `ast` module as the initial foundation. Do not import and execute the target project to inspect it.

### Shared contract — `packages/contracts/`
Responsible for documenting and validating the boundary between the analyzer, extension host, and webview. Prefer a language-neutral JSON representation/schema so Python and TypeScript can share it. Avoid maintaining separate incompatible node/edge shapes in each layer.

## 3. Communication flow
1. The extension host receives an analyze/refresh request.
2. It validates the selected workspace root.
3. It starts or invokes the local analyzer with a structured request.
4. The analyzer emits one structured response with a schema version, graph data, and diagnostics.
5. The extension host validates/parses the response and sends the relevant data to the webview.
6. The webview renders nodes and edges.
7. On node selection, the webview displays details/evidence.
8. On source-open request, the webview sends a message containing a source location; the extension host validates it and opens the file.
9. On refresh, the process repeats and the UI shows loading/errors accurately.

The exact process protocol (stdin/stdout JSON, temporary JSON files, or another approach) must be chosen and documented when implementing the analyzer integration milestone. If using stdout for protocol output, send logs to stderr so logs cannot corrupt JSON.

## 4. Suggested repository layout
Adapt to the actual scaffold rather than blindly recreating it.

```text
code-visualizer/
├─ AGENTS.md
├─ package.json                 # VS Code extension project
├─ src/
│  └─ extension.ts              # extension host entry point
├─ webview-ui/
│  ├─ package.json
│  ├─ vite.config.ts
│  └─ src/
│     ├─ App.tsx
│     ├─ main.tsx
│     ├─ index.css
│     └─ components/
│        ├─ nodes/
│        └─ panels/
├─ services/
│  └─ analyzer/
│     ├─ pyproject.toml
│     ├─ README.md
│     └─ src/
├─ packages/
│  └─ contracts/
│     ├─ architecture.schema.json
│     └─ examples/
└─ docs/
   ├─ PRODUCT_SPEC.md
   ├─ ARCHITECTURE.md
   ├─ ARCHITECTURE_DATA_MODEL.md
   ├─ ROADMAP.md
   └─ DEVELOPMENT_WORKFLOW.md
```

This is a target layout, not permission to relocate files without checking the current project.

## 5. Security and reliability
- Treat workspace source code and analyzer output as untrusted input.
- Never execute project code for static discovery.
- Validate messages crossing the webview boundary.
- Validate source paths before opening them; ensure they resolve within the intended workspace unless an explicit feature permits otherwise.
- Avoid embedding arbitrary source text as HTML.
- Dispose child processes, event listeners, and webview resources appropriately.
- Return useful diagnostics rather than silently ignoring parse failures.

## 6. Architecture principles
- Separate extension host, UI, analyzer, and contract responsibilities.
- Use a stable, versioned data contract.
- Make analysis deterministic where possible.
- Keep analyzer output evidence-backed.
- Keep UI rendering independent from framework-specific parsing.
- Add framework/ORM support through adapters, not special cases scattered across the whole analyzer.
