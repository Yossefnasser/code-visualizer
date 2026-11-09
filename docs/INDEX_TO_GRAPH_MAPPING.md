# Index-to-Graph Mapping Specification

This document specifies how the validated Index Contract v1 and the
architecture graph contract (v2.0) relate. The mapping is **deterministic**:
no LLM calls are permitted during graph mapping or rendering. The mapping
preserves clear distinctions between:

1. **Fact entries** — mechanically observed source structures (files, symbols, imports, references)
2. **Interpretation entries** — AI-identified architectural relationships (from `AgentFinding` proposals)
3. **Validation** — evidence requirements for each status
4. **Graph mapping** — what appears as nodes and edges in the UI

**Status note (2026-11-09):** Index Contract v1 is proposed in
`docs/ARCHITECTURE_DATA_MODEL.md` section 16 and does not yet exist as a
machine-readable specification. The Python sidecar's index v1.1 is the
transitional/reference backend output and a migration source, not Index
Contract v1. The rules below are written against Index Contract v1 entries;
where they cite Python v1.1 fields (`files[]`, `references[]`, etc.), the
migration map in `ARCHITECTURE_DATA_MODEL.md` section 16.5 applies.

---

## 1. Conceptual Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                    ARCHITECTURE GRAPH (v2.0)                    │
│  Nodes: subsystem, endpoint, service, function, class, module, │
│         database_model, database_field                          │
│  Edges: route_handler, calls, uses_model, orm_relationship,    │
│         imports, uses, reads, writes                            │
│  Each has: origin (deterministic/ai/hybrid), status            │
│         (confirmed/inferred/unresolved), evidence              │
└─────────────────────────────────────────────────────────────────┘
                               ▲
                               │ Deterministic mapping (no LLM)
                               │
┌─────────────────────────────────────────────────────────────────┐
│              VALIDATED INDEX CONTRACT v1 (proposed)             │
│  Fact entries: files, symbols, imports, references, routes,    │
│  models, ORM relationships (mechanically observed)              │
│  Interpretation entries: subsystems, services, relationships   │
│  (AI-identified, from AgentFinding proposals)                   │
│  Each entry: evidence, source, provenance, status, uncertainty  │
└─────────────────────────────────────────────────────────────────┘
                               ▲
                               │ Deterministic validation (no LLM)
                               │
┌─────────────────────────────────────────────────────────────────┐
│              INDEXER (initial: AI agent / AgentRunner)          │
│  Produces Index v1 entries: facts + interpretations             │
│  Reference backend: Python sidecar (index v1.1, transitional)   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Index Entries → Graph Nodes

### 2.1 Files → Module Nodes

| Index Field | Graph Node |
|-------------|------------|
| `files[].module` | `id: "module:{module}"`, `type: "module"`, `label: "{module}"` |
| `files[].path` | `source.path` |
| `files[].lineCount` | `details.lineCount` |
| `files[].frameworks` | `details.frameworks` |

**Rule**: Every indexed module becomes a `module` node. These form the hierarchy backbone.

### 2.2 Symbols → Function/Class Nodes

| Index Field | Graph Node |
|-------------|------------|
| `files[].symbols[]` (kind: function) | `id: "{symbol.id}"`, `type: "function"`, `label: "{name}"` |
| `files[].symbols[]` (kind: class) | `id: "{symbol.id}"`, `type: "class"`, `label: "{name}"` |
| `symbol.startLine`, `symbol.endLine` | `source.startLine`, `source.endLine` |
| `symbol.className` | `parentId: "class:{module}:{className}"` (for methods) |

**Rule**: Symbols become `function` or `class` nodes. By default, these are **not rendered in the top-level graph** — they appear only on drill-down into their parent module.

### 2.3 Framework Hints → Specialized Nodes

| Index Field | Graph Node |
|-------------|------------|
| `endpoints[]` | `id: "{endpoint.id}"`, `type: "endpoint"`, `label: "{methods} {path}"` |
| `models[]` | `id: "{model.id}"`, `type: "database_model"`, `label: "{name}"` |
| `models[].fields[]` | `id: "database_field:{model.module}:{model.name}.{field.name}"`, `type: "database_field"` |

**Rule**: Framework hints are high-confidence deterministic facts. They become nodes with `origin: "deterministic"`.

### 2.4 AI Findings → Architectural Nodes

| AI Finding | Graph Node |
|------------|------------|
| `type: "service"` | `id: "service:{module}:{qualname}"`, `type: "service"`, `origin: "ai"` |
| `type: "subsystem"` | `id: "subsystem:{path}"`, `type: "subsystem"`, `origin: "ai"` |

**Rule**: The agent identifies services, subsystems, and other architectural concepts. These have `origin: "ai"` (or `hybrid` if confirmed by deterministic evidence).

---

## 3. Index References → Graph Edges

### 3.1 Route Bindings → `route_handler` (Confirmed)

| Index Field | Graph Edge |
|-------------|------------|
| `routeBindings[]` | `source: endpoint.id`, `target: "function:{handlerModule}:{handlerQualname}"`, `type: "route_handler"`, `status: "confirmed"`, `origin: "deterministic"` |

**Rule**: Route bindings are the **only** call relationships that are deterministically verified from decorator bindings. They are always `confirmed`.

### 3.2 ORM Relationships → `orm_relationship` (Confirmed)

| Index Field | Graph Edge |
|-------------|------------|
| `ormRelationships[]` | `source: sourceId`, `target: targetId`, `type: "orm_relationship"`, `status: "confirmed"`, `origin: "deterministic"` |

**Rule**: ORM relationships are declarative and directly verifiable. They are always `confirmed`.

### 3.3 References → `calls` (Fact Confirmed; Architectural Significance Inferred)

| Index Field | Graph Edge |
|-------------|------------|
| `references[]` | `source: "function:{sourceModule}:{sourceQualname}"`, `target: "function:{targetModule}:{targetQualname}"`, `type: "calls"`, `status: "confirmed"` (as an observed + resolved reference fact), `origin: "deterministic"` |

**Rule**: A mechanically observed, successfully resolved reference is a
`confirmed` fact (see `ARCHITECTURE_DATA_MODEL.md` section 16.4). The
**architectural significance** (whether this call represents a meaningful
flow, e.g. endpoint→service delegation) is a separate interpretation entry
and remains `inferred`. Do not downgrade the observed reference to
`inferred` merely because its architectural significance is uncertain.

### 3.4 Imports → `imports` (Hidden by Default)

| Index Field | Graph Edge |
|-------------|------------|
| `files[].imports[]` | `source: "module:{module}"`, `target: "module:{import.module}"`, `type: "imports"`, `status: "confirmed"`, `origin: "deterministic"` |

**Rule**: Imports are structural and confirmed, but **excluded from the default graph view** to reduce noise. Available on drill-down.

---

## 4. AI Findings → Graph Edges

The agent submits edges with `origin: "ai"` and `status: "inferred"` by default.

| AI Edge Type | When Confirmed |
|--------------|----------------|
| `calls` | Only if the agent cites a resolved call from `references` AND validates the source location |
| `uses_model` | Only if the agent cites an ORM relationship or a resolved call to a model method |
| `route_handler` | Never — only deterministic route bindings can be `confirmed` |
| `orm_relationship` | Never — only deterministic ORM declarations can be `confirmed` |
| `uses`, `reads`, `writes` | Never confirmed (semantic interpretations) |

**Key Principle**: The existence of two symbols and a resolved call between them does **not** make the relationship `confirmed`. `confirmed` requires deterministic verification of the relationship itself (decorator binding, ORM declaration, etc.).

---

## 5. Validation Rules

### 5.1 Source-Location Validation (All Entries)

Every entry must cite a `source` location where applicable. The validator checks:

1. The file path exists in the index
2. The symbol exists at or near the cited lines (for symbol-level entries)
3. For relationships: both source and target entries exist in the combined (fact + interpretation) entry set

The validator sets `metadata.sourceLocationValidated: true|false` on AI
evidence. `true` means the cited location exists as cited; it does **not**
mean the AI claim is semantically correct.

**Result**: If validation fails → entry is returned for repair (one round), then dropped with diagnostic.

### 5.2 Semantic Validation (Confirmed Status Only)

A relationship may be `confirmed` **only** when:

| Relationship Type | Verification Method |
|-------------------|---------------------|
| `route_handler` | Exists in `index.routeBindings` |
| `orm_relationship` | Exists in `index.ormRelationships` |
| `calls` | Exists in `index.references` AND agent validates the call site semantics |
| `imports` | Exists in `index.files[].imports` |

All other relationships (including all AI-origin edges) **must** be `inferred` or `unresolved`.

---

## 6. Graph Mapping: Default View vs Drill-Down

### 6.1 Default Graph (High-Level Architecture)

**Nodes shown by default:**
- `subsystem` (AI-identified)
- `endpoint` (from index hints)
- `service` (AI-identified)
- `database_model` (from index hints)
- `module` (top-level packages only)

**Edges shown by default:**
- `route_handler` (confirmed)
- `calls` between endpoint → service, service → service (inferred)
- `uses_model` between service → database_model (inferred)
- `orm_relationship` (confirmed)

**Hidden by default:**
- `function`, `class`, `database_field` nodes
- `imports` edges
- `calls` between functions/classes (implementation detail)

### 6.2 Drill-Down (Module Level)

Clicking a `module` node expands to show:
- `function` and `class` nodes from `index.files[].symbols`
- `imports` edges from `index.files[].imports`
- `calls` edges from `index.references` (filtered to this module)

### 6.3 Drill-Down (Service/Component Level)

Clicking a `service` node shows:
- Constituent `function`/`class` nodes (from AI finding's `parentId` or source location)
- Internal `calls` edges
- Outgoing `uses_model`, `calls` edges

---

## 7. Hierarchy Construction

### 7.1 Module Hierarchy (Deterministic)

```
module:app
  └── module:app.api
  │     └── module:app.api.users
  └── module:app.services
  │     └── module:app.services.user_service
  └── module:app.models
        └── module:app.models.user
```

Built from `index.files[].module` dotted names. Every module node gets `parentId` pointing to its parent package.

### 7.2 Subsystem Hierarchy (AI-Identified)

The agent proposes `subsystem` nodes that group modules by architectural responsibility:

```
subsystem:app.api          (parentId: module:app)
  └── module:app.api.users
  └── module:app.api.orders
subsystem:app.services     (parentId: module:app)
  └── module:app.services.user_service
  └── module:app.services.order_service
subsystem:app.models       (parentId: module:app)
  └── module:app.models.user
```

Subsystems are `origin: "ai"` and have `details.responsibility` describing their role.

### 7.3 Component Parenting

- `endpoint` nodes: `parentId` = their module
- `service` nodes: `parentId` = their subsystem (or module if no subsystem)
- `database_model` nodes: `parentId` = their module (or a `subsystem:data` if identified)
- `function`/`class` nodes: `parentId` = their module (or class for methods)

---

## 8. Evidence Propagation

### 8.1 Deterministic Evidence Kinds

| Kind | Source | Used For |
|------|--------|----------|
| `fastapi_route_decorator` | `endpoints[]` + `routeBindings[]` | `route_handler` edges |
| `sqlalchemy_relationship` | `ormRelationships[]` | `orm_relationship` edges |
| `django_relationship` | `ormRelationships[]` | `orm_relationship` edges |
| `function_call` | `references[]` | `calls` edges (inferred) |
| `import_statement` | `files[].imports[]` | `imports` edges |

### 8.2 AI Evidence Kind

| Kind | Source | Validation |
|------|--------|------------|
| `ai_observation` | Agent's analysis | `metadata.sourceLocationValidated: true` iff source location verified against index. This verifies evidence exists at the cited location; it does **not** verify the semantic correctness of the AI claim |

### 8.3 Hybrid Evidence

When an AI finding aligns with deterministic evidence:
- Edge gets `origin: "hybrid"`
- Evidence array contains both `ai_observation` and deterministic evidence
- Status may be `confirmed` if the deterministic evidence verifies the relationship

---

## 9. Partial Analysis & Units

When budgets are exhausted, the analysis produces a partial result with `units`:

```json
{
  "analysis": { "status": "partial", ... },
  "units": [
    {
      "id": "unit:app.services",
      "scope": "app/services/",
      "status": "complete",
      "diagnostics": []
    },
    {
      "id": "unit:app.models",
      "scope": "app/models/",
      "status": "pending",
      "diagnostics": [{ "code": "budget_exhausted", "message": "Token budget reached" }]
    }
  ]
}
```

**Mapping**: Each unit corresponds to a subsystem or module scope. The graph shows completed units fully; pending units show as placeholder nodes with diagnostics.

---

## 10. Implementation Checklist

- [x] IndexService exposes query methods matching `index.query` tool types (`src/analysis/indexService.ts`, `queryIndex()` for all nine types; `AgentRunner` consumes it via `IndexServiceInterface`)
- [x] Index Contract v1 machine-readable schema + examples (`packages/contracts/index-v1.schema.json`, `packages/contracts/examples/`, types + validator in `src/analysis/indexContract.ts`; approved design in `docs/ARCHITECTURE_DATA_MODEL.md` section 16)
- [ ] FindingValidator implements two-tier validation over Index v1 entries
- [ ] ArchitectureStore deterministically maps validated Index v1 to v2.0 (no LLM)
- [ ] Graph mapper applies default-view filtering (hide functions, imports, etc.)
- [ ] UI supports hierarchy navigation via `parentId`
- [ ] UI shows evidence, status, origin per node/edge
- [ ] Partial units rendered with appropriate visual indicators

**Note (2026-11-09):** `AgentRunner` (`src/analysis/agentRunner.ts`) produces
`AgentFinding` proposals (final JSON, `inferred`/`unresolved` only). Decision:
each proposal maps to one Index Contract v1 interpretation entry (see
`ARCHITECTURE_DATA_MODEL.md` section 16.4). Validation checks the entry;
deterministic mapping then produces v2.0 nodes/edges. `AgentFinding` is never
a v2.0 node/edge directly.

---

## 11. Example: Complete Mapping for fastapi_app Fixture

### Index Nodes (Deterministic)
```
module:app
module:app.api
module:app.api.users
module:app.main
module:app.models
module:app.models.user
module:app.services
module:app.services.user_service

function:app.api.users:list_users_endpoint
function:app.api.users:get_user_endpoint
function:app.services.user_service:list_users
function:app.services.user_service:get_user
class:app.models.user:User
class:app.models.user:Post

endpoint:app.api.users:GET:/users
endpoint:app.api.users:GET:/users/{user_id}

database_model:app.models.user:User
database_model:app.models.user:Post
database_field:app.models.user:User.id
database_field:app.models.user:User.email
database_field:app.models.user:User.posts
database_field:app.models.user:Post.id
database_field:app.models.user:Post.title
database_field:app.models.user:Post.author_id
```

### Index Edges (Deterministic)
```
route_handler: endpoint:app.api.users:GET:/users → function:app.api.users:list_users_endpoint (confirmed)
route_handler: endpoint:app.api.users:GET:/users/{user_id} → function:app.api.users:get_user_endpoint (confirmed)
calls: function:app.api.users:list_users_endpoint → function:app.services.user_service:list_users (inferred)
calls: function:app.api.users:get_user_endpoint → function:app.services.user_service:get_user (inferred)
calls: function:app.services.user_service:list_users → function:app.models.user:User.query.all (inferred)
calls: function:app.services.user_service:get_user → function:app.models.user:User.query.get (inferred)
orm_relationship: database_model:app.models.user:Post → database_model:app.models.user:User (confirmed)
orm_relationship: database_model:app.models.user:User → database_model:app.models.user:Post (confirmed)
imports: module:app.api.users → module:fastapi (confirmed, hidden)
imports: module:app.api.users → module:app.services.user_service (confirmed, hidden)
... etc
```

### AI Findings (Hypothetical)
```
Node: service:app.services.user_service:UserService (ai, parentId: subsystem:app.services)
  Evidence: ai_observation "Module contains user management business logic"

Node: subsystem:app.api (ai, parentId: module:app)
  Evidence: ai_observation "API layer handling HTTP endpoints"

Node: subsystem:app.services (ai, parentId: module:app)
  Evidence: ai_observation "Business logic services"

Edge: calls: endpoint:app.api.users:GET:/users → service:app.services.user_service:UserService (ai, inferred)
  Evidence: ai_observation "Endpoint delegates to service"

Edge: uses_model: service:app.services.user_service:UserService → database_model:app.models.user:User (ai, inferred)
  Evidence: ai_observation "Service uses User model for queries"
```

### Final Default Graph
```
subsystem:app.api
  └── endpoint:app.api.users:GET:/users
  └── endpoint:app.api.users:GET:/users/{user_id}

subsystem:app.services
  └── service:app.services.user_service:UserService

subsystem:app.models
  └── database_model:app.models.user:User
  └── database_model:app.models.user:Post

Edges:
  route_handler (confirmed): endpoint → handler function
  calls (inferred): endpoint → service
  uses_model (inferred): service → database_model
  orm_relationship (confirmed): User ↔ Post