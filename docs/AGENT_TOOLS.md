# Agent Tool Boundary Specification

This document specifies the tools available to the AI agent during architecture analysis. The agent runs in a bounded loop, using these tools to explore the repository through the deterministic index and targeted file reads.

## Tool Overview

| Tool | Purpose |
|------|---------|
| `repo.overview` | Get the repository digest (tree, manifest, counts) for initial survey |
| `index.query` | Query the index for symbols, imports, references, and framework hints |
| `files.read` | Read targeted source code line ranges |
| `files.search` | Search source code when the index cannot answer |
| `findings.submit` | Submit structured architectural findings with evidence |

---

## 1. `repo.overview`

Returns the size-capped repository digest from the index document. This is the agent's starting point (Stage 1: Survey).

### Input
```json
{}
```

### Output
```json
{
  "tree": ["app/", "app/api/", "app/models/", ...],
  "manifest": [
    {
      "path": "app/api/users.py",
      "lineCount": 15,
      "frameworks": ["fastapi"],
      "imports": 3,
      "symbols": 2
    }
  ],
  "counts": {
    "files": 8,
    "totalLines": 47,
    "endpoints": 2,
    "models": 2,
    "ormRelationships": 2,
    "references": 4,
    "diagnostics": 0
  }
}
```

### Notes
- The digest is capped at 500 entries (see `DIGEST_MAX_ENTRIES` in indexer).
- No source code is sent; only structural summaries.
- The agent uses this to propose subsystems and entry points.

---

## 2. `index.query`

Queries the deterministic index for specific information. The index provides efficient access to symbols, imports, references, and framework hints without reading source files.

### Input
```json
{
  "type": "symbols" | "imports" | "references" | "reverseReferences" | "endpoints" | "models" | "routeBindings" | "ormRelationships" | "files",
  "filter": {
    "module": "app.services.user_service",           // optional: exact module match
    "modulePrefix": "app.services",                  // optional: module prefix match
    "qualname": "get_user",                          // optional: exact qualname match
    "qualnamePrefix": "User",                        // optional: qualname prefix match
    "kind": "class" | "function",                    // optional: for symbols
    "sourceModule": "app.api.users",                 // optional: for references
    "targetModule": "app.services.user_service"      // optional: for references/reverseReferences
  },
  "limit": 100                                       // optional: max results (default 100)
}
```

### Output (varies by type)

#### `type: "symbols"`
```json
{
  "results": [
    {
      "id": "function:app.services.user_service:get_user",
      "kind": "function",
      "name": "get_user",
      "qualname": "get_user",
      "className": null,
      "startLine": 8,
      "endLine": 9,
      "module": "app.services.user_service",
      "path": "app/services/user_service.py"
    }
  ],
  "total": 1
}
```

#### `type: "imports"`
```json
{
  "results": [
    {
      "module": "app.api.users",
      "imports": [
        { "local": "get_user", "module": "app.services.user_service", "name": "get_user" }
      ]
    }
  ],
  "total": 1
}
```

#### `type: "references"`
```json
{
  "results": [
    {
      "sourceModule": "app.api.users",
      "sourceQualname": "get_user_endpoint",
      "targetModule": "app.services.user_service",
      "targetQualname": "get_user",
      "line": 15
    }
  ],
  "total": 1
}
```

#### `type: "reverseReferences"`
```json
{
  "results": [
    {
      "sourceModule": "app.api.users",
      "sourceQualname": "get_user_endpoint",
      "targetModule": "app.services.user_service",
      "targetQualname": "get_user",
      "line": 15
    }
  ],
  "total": 1
}
```

#### `type: "endpoints"`
```json
{
  "results": [
    {
      "id": "endpoint:app.api.users:GET:/users",
      "module": "app.api.users",
      "methods": ["GET"],
      "path": "/users",
      "sourcePath": "app/api/users.py",
      "line": 9
    }
  ],
  "total": 1
}
```

#### `type: "models"`
```json
{
  "results": [
    {
      "id": "database_model:app.models.user:User",
      "module": "app.models.user",
      "name": "User",
      "table": "users",
      "sourcePath": "app/models/user.py",
      "startLine": 7,
      "endLine": 12,
      "fields": [
        { "name": "id", "kind": "column", "type": "int", "targetHint": null, "line": 10 }
      ]
    }
  ],
  "total": 1
}
```

#### `type: "routeBindings"`
```json
{
  "results": [
    {
      "endpointId": "endpoint:app.api.users:GET:/users",
      "handlerModule": "app.api.users",
      "handlerQualname": "list_users_endpoint"
    }
  ],
  "total": 1
}
```

#### `type: "ormRelationships"`
```json
{
  "results": [
    {
      "sourceId": "database_model:app.models.user:Post",
      "targetId": "database_model:app.models.user:User",
      "kind": "sqlalchemy_relationship",
      "line": 20
    }
  ],
  "total": 1
}
```

#### `type: "files"`
```json
{
  "results": [
    {
      "path": "app/services/user_service.py",
      "module": "app.services.user_service",
      "language": "python",
      "lineCount": 9,
      "frameworks": [],
      "imports": [...],
      "symbols": [...]
    }
  ],
  "total": 1
}
```

### Notes
- All results are sorted deterministically (by module, qualname, line).
- The `limit` parameter prevents excessive result sets.
- The agent should prefer `index.query` over `files.read` when the index can answer the question.

---

## 3. `files.read`

Reads a specific line range from a source file. Used when the agent needs to see actual code (e.g., function bodies, decorator details, complex logic).

### Input
```json
{
  "path": "app/services/user_service.py",
  "startLine": 1,
  "endLine": 50
}
```

### Output
```json
{
  "path": "app/services/user_service.py",
  "startLine": 1,
  "endLine": 9,
  "content": "from app.models.user import User\n\n\ndef list_users():\n    return User.query.all()\n\n\ndef get_user(user_id):\n    return User.query.get(user_id)"
}
```

### Constraints
- Maximum line range per call: 200 lines (configurable budget).
- Path must be workspace-relative with POSIX separators.
- The file must exist in the index (validated by the host).
- Exclude patterns are enforced; excluded files cannot be read.

---

## 4. `files.search`

Searches source code for patterns when the index cannot answer (e.g., string literals, comments, dynamic patterns not captured by the AST).

### Input
```json
{
  "pattern": "query\\.filter",
  "path": "app/services/",           // optional: directory prefix
  "filePattern": "*.py",             // optional: glob pattern
  "maxResults": 50                   // optional: default 50
}
```

### Output
```json
{
  "results": [
    {
      "path": "app/services/order_service.py",
      "line": 42,
      "context": "    results = query.filter(Order.status == 'pending').all()"
    }
  ],
  "total": 1
}
```

### Constraints
- Uses ripgrep-compatible regex syntax.
- Respects exclude patterns.
- Maximum results capped to prevent excessive output.
- Should be used sparingly; prefer `index.query` when possible.

---

## 5. `findings.submit`

Submits architectural findings (nodes and edges) with evidence. The agent calls this incrementally during exploration.

### Input
```json
{
  "nodes": [
    {
      "id": "service:app.services.orders:OrderService",
      "type": "service",
      "label": "Order service",
      "origin": "ai",
      "parentId": "subsystem:app.services",
      "details": {
        "responsibility": "Creates and fulfills customer orders"
      },
      "source": {
        "path": "app/services/orders.py",
        "startLine": 20,
        "endLine": 88
      },
      "evidence": [
        {
          "kind": "ai_observation",
          "description": "Class holds order placement and fulfillment logic used by checkout endpoints",
          "source": { "path": "app/services/orders.py", "startLine": 20, "endLine": 88 },
          "metadata": { "model": "openai/gpt-4o-mini", "validated": false }
        }
      ]
    }
  ],
  "edges": [
    {
      "id": "calls:service:app.services.orders:OrderService->endpoint:app.api.checkout:POST:/checkout",
      "source": "service:app.services.orders:OrderService",
      "target": "endpoint:app.api.checkout:POST:/checkout",
      "type": "calls",
      "origin": "ai",
      "status": "inferred",
      "evidence": [
        {
          "kind": "ai_observation",
          "description": "Checkout endpoint calls OrderService.place_order",
          "source": { "path": "app/api/checkout.py", "startLine": 15, "endLine": 15 },
          "metadata": { "model": "openai/gpt-4o-mini", "validated": false }
        }
      ]
    }
  ],
  "diagnostics": []
}
```

### Output
```json
{
  "accepted": [
    "service:app.services.orders:OrderService"
  ],
  "rejected": [],
  "validationErrors": [],
  "repairRequired": false
}
```

### Validation Flow
1. **Source-location validation** (deterministic): Every cited file, symbol, and line range is checked against the index.
2. **Semantic validation** (separate): Relationships that can be deterministically verified (route bindings, ORM declarations, resolved calls) may be upgraded to `confirmed`. AI-only claims remain `inferred`.
3. **Repair round**: If validation fails, the finding is returned with errors for one bounded repair attempt.
4. **Final disposition**: Accepted, downgraded (e.g., `confirmed` → `inferred`), or dropped with diagnostics.

### Notes
- Node/edge IDs must be unique within the analysis run.
- `origin` must be `deterministic`, `ai`, or `hybrid`.
- `status` must be `confirmed`, `inferred`, or `unresolved`.
- Evidence `kind` values: `fastapi_route_decorator`, `function_call`, `sqlalchemy_relationship`, `django_relationship`, `unresolved_reference`, `ai_observation`, etc.
- For `ai_observation`, `metadata.validated: true` means the cited source location was verified against the index.

---

## Tool Invocation Protocol

The agent interacts with tools through a structured message format. The extension host implements each tool with privileged file access and enforces budgets.

### Request
```json
{
  "tool": "index.query",
  "requestId": "req-123",
  "params": { ... }
}
```

### Response
```json
{
  "requestId": "req-123",
  "result": { ... },
  "error": null
}
```

### Error Response
```json
{
  "requestId": "req-123",
  "result": null,
  "error": {
    "code": "BUDGET_EXCEEDED" | "INVALID_PARAMS" | "NOT_FOUND" | "EXCLUDED" | "INTERNAL_ERROR",
    "message": "Human-readable description"
  }
}
```

---

## Budget Enforcement

All tools are subject to configurable budgets:

| Budget | Default | Scope |
|--------|---------|-------|
| Max tokens per run | 50,000 | Entire analysis |
| Max turns per subsystem | 10 | Per subsystem exploration |
| Max files read per turn | 5 | Per agent turn |
| Max lines per `files.read` | 200 | Per call |
| Max `index.query` results | 100 | Per call |
| Max `files.search` results | 50 | Per call |

Budget exhaustion marks the current unit `partial` with diagnostics — never silent truncation.

---

## Implementation Notes for Extension Host

1. **IndexBackend Interface**: The host implements `IndexBackend` with methods corresponding to `index.query` types.
2. **File Access**: `files.read` and `files.search` go through the host with path validation and exclude enforcement.
3. **Cancellation**: All tools respect `AbortSignal` for cooperative cancellation.
4. **Determinism**: Index queries return sorted, deterministic results.
5. **Testability**: All tools are testable offline with fixture index documents and mocked file systems.