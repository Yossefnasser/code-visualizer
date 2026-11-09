# Agent Tool Boundary Specification

This document specifies the tools available to the AI agent during architecture analysis. The agent **is** the initial Indexer: it runs in a bounded loop, explores the repository through the Index Contract v1 index and targeted file reads, and produces Index Contract v1 entries (facts + interpretations). The Python sidecar (index v1.1) is a transitional/reference backend that supplies mechanically observed facts and proves the query surface; it is not the primary Indexer. See `docs/ARCHITECTURE_DATA_MODEL.md` section 16 for the Index Contract v1 proposal.

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

Queries the index for specific information. The index provides efficient access to symbols, imports, references, and framework hints without reading source files.

**Current implementation (transitional backend interface):** the query surface is `IndexService.queryIndex()` over the Python reference backend's index v1.1 document (`src/analysis/indexService.ts`, `src/analysis/pythonIndexBackend.ts`). It is a transitional backend interface, **not** the final language-neutral Index Contract query API. Query types and filters mirror the Python v1.1 shape (nine types: `symbols`, `imports`, `references`, `reverseReferences`, `endpoints`, `models`, `routeBindings`, `ormRelationships`, `files`).

**Proposed future behavior:** a normalized, language-neutral query surface over Index Contract v1 entries, separating agent-facing queries from backend-specific representations. The agent would query entry categories (`file`, `symbol`, `reference`, `route`, `model`, `relationship`, `subsystem`, `service`) with language-neutral filters, and each backend (AI, deterministic parser, hybrid) would translate those queries into its own representation. Backend-specific fields (e.g. Python module names, FastAPI hint shapes) would never leak into the agent-facing API. This surface does not exist yet; see the migration map in `docs/ARCHITECTURE_DATA_MODEL.md` section 16.5.

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

### Current implementation (actual behavior)

`findings.submit` is **not** an incrementally invoked tool. The agent returns
findings once, as final JSON, on its last turn. The runner
(`src/analysis/agentRunner.ts`, `FINDINGS_SCHEMA`) structurally validates the
document and rejects any finding marked `confirmed`. The actual
`AgentFinding` structure is:

```json
{
  "findings": [
    {
      "id": "service:app.services.orders:OrderService",
      "type": "node",
      "proposedType": "service",
      "label": "Order service",
      "description": "Creates and fulfills customer orders",
      "source": { "path": "app/services/orders.py", "startLine": 20, "endLine": 88 },
      "evidence": [
        {
          "kind": "ai_observation",
          "description": "Class holds order placement and fulfillment logic used by checkout endpoints",
          "source": { "path": "app/services/orders.py", "startLine": 20, "endLine": 88 }
        }
      ],
      "status": "inferred",
      "confidence": 0.8
    }
  ]
}
```

- `type` is `"node"` or `"edge"`; `proposedType` is the proposed component or
  relationship type (e.g. `service`, `endpoint`, `calls`, `uses_model`).
- `status` is `"inferred"` or `"unresolved"` only -- never `"confirmed"`.
- `confidence` is an optional 0-1 estimate of confidence in the AI
  interpretation (not a calibrated probability; it cannot upgrade an entry
  to `confirmed`). Omit it when no meaningful estimate exists.
- Evidence items carry `kind`, `description`, and optional `source`. There
  is no `metadata.validated` field at proposal time; the validator sets
  `sourceLocationValidated` (see below).

**Decision (2026-11-09):** each `AgentFinding` maps to one Index Contract v1
interpretation entry (see `docs/ARCHITECTURE_DATA_MODEL.md` section 16.4) --
it is not an Architecture Graph Contract v2.0 node/edge directly. Validation
checks each entry; deterministic mapping then produces v2.0 nodes/edges.

### Proposed future behavior (not implemented)

An incremental `findings.submit` tool call during exploration, returning
per-submission validation feedback (`accepted` / `rejected` /
`validationErrors` / `repairRequired`) with one bounded repair round. This
does not exist yet; do not treat the output shape below as current behavior.

```json
{
  "accepted": ["service:app.services.orders:OrderService"],
  "rejected": [],
  "validationErrors": [],
  "repairRequired": false
}
```

### Validation Flow (proposed)
1. **Source-location validation** (deterministic): Every cited file, symbol, and line range is checked against the index. The validator sets `sourceLocationValidated: true/false` on the evidence. This verifies that evidence exists at the cited location; it does **not** verify the semantic correctness of the AI claim.
2. **Semantic validation** (separate): Relationships that can be deterministically verified (route bindings, ORM declarations, resolved calls) may be upgraded to `confirmed`. AI-only claims remain `inferred`.
3. **Repair round**: If validation fails, the finding is returned with errors for one bounded repair attempt.
4. **Final disposition**: Accepted, downgraded (e.g., `confirmed` → `inferred`), or dropped with diagnostics.

### Notes
- Finding IDs must be unique within the analysis run.
- `status` must be `inferred` or `unresolved` at proposal time; `confirmed` is assigned only by the validator.
- Evidence `kind` values: `fastapi_route_decorator`, `function_call`, `sqlalchemy_relationship`, `django_relationship`, `unresolved_reference`, `ai_observation`, etc.
- For `ai_observation`, `metadata.sourceLocationValidated: true` means the cited source location was verified against the index. It does not mean the AI claim is semantically correct.

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

## Implementation Status (2026-11-09)

Implemented in `src/analysis/agentRunner.ts` (`AgentRunner`), backed by
`src/analysis/indexService.ts` (`IndexService`) and
`src/analysis/pythonIndexBackend.ts` (`PythonIndexBackend`):

| Tool | Status | Notes |
| --- | --- | --- |
| `repo.overview` | Implemented | `IndexService.getRepoOverview()`; throws `IndexNotBuiltError` before the first build |
| `index.query` | Implemented | `IndexService.queryIndex()` for all nine types; `reverseReferences` requires `targetKey`; default limit 100 |
| `files.read` | Implemented | `DefaultFileAccess`: workspace-relative POSIX paths only, traversal rejected, 200-line cap. Exclude-pattern enforcement against the index is **not** done yet |
| `files.search` | Implemented | `DefaultSearchAccess`: ripgrep with a Node.js fallback walk; common exclusions hardcoded. Exclude-pattern enforcement is **not** done yet |
| `findings.submit` | Implemented as final JSON, not a tool call | The agent's last turn returns an `agent_findings` document (`AgentFinding[]`); the runner validates its structure and rejects `confirmed` statuses. The `AgentFinding` shape is a proposal format, not the contract v2.0 node/edge shape -- translation happens in the (not yet built) validator/store step |

**Budgets actually enforced today** (constructor options on `AgentRunner`):
`maxTurns` (default 10), `maxToolCalls` (default 20), `maxToolOutputChars`
(default 10000, oversized results replaced with a truncation marker),
`totalTimeoutMs` (default 5 min). Token usage and provider-reported cost are
accumulated and reported in `AgentRunResult.metadata`, but there is **no
token-budget ceiling** and no per-subsystem loop yet. Budget exhaustion ends
the run as `partial` with diagnostics.