# Architecture Data Model Contract

## 1. Purpose
This document defines the shared, language-neutral shape of analyzer results. The Python analyzer produces the data; the extension host transports it; the React webview renders it.

The schema below is a design contract. Implement it consistently and add a machine-validated JSON Schema or equivalent validator before relying on it for integration.

## 2. Top-level response
Conceptual example:

```json
{
  "schemaVersion": "1.0",
  "project": {
    "root": ".",
    "language": "python"
  },
  "nodes": [],
  "edges": [],
  "diagnostics": []
}
```

Required top-level fields:
- `schemaVersion`: contract version string.
- `project`: metadata about the analyzed project.
- `nodes`: normalized graph nodes.
- `edges`: normalized graph relationships.
- `diagnostics`: warnings/errors encountered during analysis.

## 3. Node shape
Each node should have:
- `id`: stable identifier within a single analysis result.
- `type`: one of the initial types below.
- `label`: concise display label.
- `details`: optional structured metadata suitable for the inspector.
- `source`: optional source location.
- `evidence`: optional evidence supporting the node's existence.

Initial node types:
- `endpoint`
- `service`
- `function`
- `class`
- `module`
- `database_model`
- `database_field`

Keep node `type` values independent of React component names. The UI maps domain node types to React Flow node renderers.

Example:

```json
{
  "id": "endpoint:app.api.users:list_users",
  "type": "endpoint",
  "label": "GET /users",
  "details": {
    "method": "GET",
    "path": "/users",
    "handler": "list_users"
  },
  "source": {
    "path": "app/api/users.py",
    "startLine": 12,
    "endLine": 18
  },
  "evidence": [
    {
      "kind": "fastapi_route_decorator",
      "description": "FastAPI route decorator discovered by static analysis"
    }
  ]
}
```

## 4. Edge shape
Each edge should have:
- `id`: unique within the response.
- `source`: source node ID.
- `target`: target node ID.
- `type`: relationship type.
- `status`: evidence status.
- `evidence`: zero or more evidence records.

Initial relationship types:
- `route_handler`
- `calls`
- `uses_model`
- `orm_relationship`
- `imports` (optional; do not show every import in the default view)

Evidence status:
- `confirmed`: direct static declaration or explicit supported relationship was found.
- `inferred`: relationship is plausible based on static evidence but not guaranteed at runtime.
- `unresolved`: analysis found a relevant symbol/reference but could not resolve the target confidently.

Do not use `confirmed` to imply that a function definitely executes at runtime. It means the stated static relationship is directly supported by the code pattern that was analyzed.

Example:

```json
{
  "id": "calls:handler:list_users->service:user_service.list_users",
  "source": "endpoint:app.api.users:list_users",
  "target": "service:app.services.user_service:list_users",
  "type": "calls",
  "status": "inferred",
  "evidence": [
    {
      "kind": "function_call",
      "description": "Handler contains a call to the resolved service function",
      "source": {
        "path": "app/api/users.py",
        "startLine": 16,
        "endLine": 16
      }
    }
  ]
}
```

## 5. Source location
A source location should use workspace-relative paths and one-based line numbers:
- `path`: relative path using `/` separators.
- `startLine`: first relevant line, inclusive.
- `endLine`: last relevant line, inclusive, if known.

The extension host must validate and resolve paths safely before opening files. A source location may be absent for generated, unresolved, or project-level nodes.

## 6. Evidence record
Suggested fields:
- `kind`: machine-readable evidence category.
- `description`: short human-readable explanation.
- `source`: optional source location.
- `metadata`: optional structured extra information.

Evidence is important: it lets the UI explain why a node or edge appears and where the analyzer found it.

## 7. Diagnostics
Each diagnostic should include:
- `severity`: `info`, `warning`, or `error`.
- `code`: stable machine-readable identifier.
- `message`: actionable explanation.
- `source`: optional source location.

Examples include a Python parse error, unsupported route declaration pattern, skipped directory, or unresolved relationship.

## 8. Identity and stability
- IDs must be unique within one result.
- Prefer deterministic IDs derived from node type and qualified symbol/path, not display labels alone.
- Do not promise stable IDs across arbitrary refactors unless explicitly designed and tested.
- Never use array position as identity.
- UI-only React Flow fields such as `position`, selection, and measured dimensions should not be required in analyzer output. The webview can derive layout/presentation state separately.

## 9. Default graph vs. drill-down
The analyzer should return enough structured information to support both a high-level view and details. The webview decides which node categories and edges are visible at each zoom/drill-down level. Avoid making the analyzer's data contract depend on a particular screen layout.

## 10. Contract implementation checklist
- [ ] Add a machine-readable schema/validator.
- [ ] Add one realistic sample response.
- [ ] Validate analyzer output in Python tests.
- [ ] Validate or safely parse messages in TypeScript.
- [ ] Add tests for unknown node/edge types and missing optional fields.
- [ ] Increment `schemaVersion` for incompatible changes.
