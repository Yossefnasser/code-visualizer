# Architecture Data Model Contracts (Index v1 + Graph v2.0)

## 1. Purpose
This document defines two separate, language-neutral contracts:

- **Index Contract v1** (upstream, proposed -- section 16): the standardized representation every Indexer produces. The Indexer is implementation-independent (AI, deterministic parser, or hybrid); a parser is only one possible implementation tool. The initial Indexer implementation is an AI agent. The index distinguishes mechanically observed facts from AI interpretations, each with evidence, source locations, provenance, and uncertainty. **Index Contract v1 does not yet exist as a complete machine-readable specification.**
- **Architecture Graph Contract v2.0** (downstream, normative -- sections 2-13): the final UI-facing output. It is produced only by deterministic mapping from the validated index. No LLM calls are permitted during graph mapping or rendering.

The extension host assembles the v2.0 data from the validated Index Contract v1; the React webview renders it. The v2.0 schema is a design contract; implement a machine-validated JSON Schema (or equivalent validator) before relying on it for integration.

Version 2.0 reflects the AI-first architecture: findings carry an origin, evidence with validation status, a hierarchy, partial-analysis units, and analysis-level status and usage. The contract is provider-neutral: it contains no model-provider-specific fields, and the UI must not depend on the `provider`/`model` values beyond optional display.

## 2. Top-level response
Conceptual example:

```json
{
  "schemaVersion": "2.0",
  "project": { "root": ".", "languages": ["python"] },
  "analysis": { "status": "complete" },
  "nodes": [],
  "edges": [],
  "summaries": {},
  "units": [],
  "diagnostics": []
}
```

Required top-level fields:
- `schemaVersion`: contract version string (`"2.0"`).
- `project`: metadata about the analyzed project; `languages` is a list (v1.0's singular `language` is accepted during transition).
- `analysis`: run-level status and accounting (section 3).
- `nodes`, `edges`, `diagnostics`: as in v1.0, plus new fields below.
- `summaries` (optional): map of node id to a short human-readable summary for drill-down.
- `units` (optional): partial-analysis units (section 9).

## 3. Analysis block
- `id`: stable identifier for this analysis run.
- `status`: `complete`, `partial`, or `failed`. Partial is a normal outcome when budgets are exhausted or a subsystem failed.
- `provider`, `model`: what produced the findings; informational only.
- `startedAt`, `completedAt`: ISO 8601 timestamps.
- `usage` (optional): `{ "inputTokens", "outputTokens", "requests", "estimatedCostUsd" }` for cost transparency.
- `coverage` (optional): `{ "scopesExplored", "scopesPending", "filesIndexed", "filesTotal" }`.

## 4. Node shape
Each node has:
- `id`, `type`, `label`, `details` (optional), `source` (optional), `evidence` (optional) -- as in v1.0.
- `origin` (new): `deterministic`, `ai`, or `hybrid`. `hybrid` means AI interpretation confirmed or enriched by deterministic evidence.
- `parentId` (new, optional): the id of the parent node in the hierarchy (subsystem/module). Absent for repository-level nodes.

Node types: `endpoint`, `service`, `function`, `class`, `module`, `database_model`, `database_field`, and the new `subsystem`. The agent may introduce further types behind schema validation; the UI must tolerate unknown types and skip or generically render them.

Keep node `type` values independent of React component names. The UI maps domain node types to React Flow renderers.

Example (AI-origin service node):

```json
{
  "id": "service:app.services.orders:OrderService",
  "type": "service",
  "label": "Order service",
  "origin": "ai",
  "parentId": "subsystem:app.services",
  "details": { "responsibility": "Creates and fulfills customer orders" },
  "source": { "path": "app/services/orders.py", "startLine": 20, "endLine": 88 },
  "evidence": [
    {
      "kind": "ai_observation",
      "description": "Class holds order placement and fulfillment logic used by checkout endpoints",
      "metadata": { "model": "<configured model>", "sourceLocationValidated": true }
    }
  ]
}
```

## 5. Edge shape
Each edge has:
- `id`, `source`, `target`, `type`, `status`, `evidence` -- as in v1.0.
- `origin` (new): `deterministic`, `ai`, or `hybrid`.

Relationship types: `route_handler`, `calls`, `uses_model`, `orm_relationship`, `imports` (imports stay out of the default view). The agent may introduce further types (for example `uses`, `reads`, `writes`) behind schema validation; the UI must tolerate unknown types.

## 6. Status semantics (revised in v2.0)
- `confirmed`: the **relationship itself** was deterministically verified from code -- for example a verified route-to-handler decorator binding, an ORM relationship declaration, or a call resolved directly through the index. It must NOT be used merely because both endpoints exist and their source locations validate.
- `inferred`: plausible and evidence-backed but not verified. This is the default and expected status for AI-only relationship claims, even when both endpoints and cited source locations are valid. The existence of two symbols does not prove a relationship between them.
- `unresolved`: a relevant reference was found but the target could not be resolved confidently.

Do not use `confirmed` to imply guaranteed runtime behavior; it means the stated static relationship was directly verified in the analyzed code.

## 7. Source location
Unchanged from v1.0: workspace-relative POSIX path, one-based inclusive `startLine`/`endLine`. The extension host validates and resolves paths safely before opening files.

## 8. Evidence record
- `kind`, `description`, `source` (optional), `metadata` (optional) -- as in v1.0.
- Deterministic kinds (`fastapi_route_decorator`, `function_call`, `sqlalchemy_relationship`, `django_relationship`, `unresolved_reference`, ...) are retained.
- New kind `ai_observation`: an AI-origin claim. Its `metadata` should include `{ "model": string, "sourceLocationValidated": boolean }`, where `sourceLocationValidated: true` means the cited source location was verified against the index. It does **not** mean the AI claim is semantically correct. An `ai_observation` whose cited location cannot be verified must not claim `sourceLocationValidated: true`, and an edge supported only by unverified AI claims must not be `confirmed`. (Renamed from the ambiguous `metadata.validated` in earlier drafts; see Index Contract v1 section 16.6.)

## 9. Partial analysis: units
Each unit:
- `id`: stable unit identifier.
- `scope`: what the unit covers (for example a subsystem path or top-level directory).
- `status`: `complete`, `partial`, `pending`, or `failed`.
- `diagnostics`: unit-scoped diagnostic references.

Units let a partial run state precisely which scopes are missing, enable resumable runs, and provide the merge key for later incremental analysis.

## 10. Diagnostics
Each diagnostic includes `severity` (`info`, `warning`, `error`), `code` (stable machine-readable id), `message`, optional `source`, and the new optional `scope` attributing it to a unit/scope. Examples: a parse error, a rejected AI finding, a budget-exhausted scope, a failed model request, an unresolved relationship.

## 11. Identity and stability
- IDs must be unique within one result; prefer deterministic ids derived from type and qualified symbol/path.
- Node ids referenced by `parentId` and `summaries` must resolve within the same result.
- Do not promise stable ids across arbitrary refactors unless explicitly designed and tested.
- Never use array position as identity.
- UI-only React Flow fields (position, selection, measured dimensions) stay out of the contract.

## 12. Default graph vs drill-down
The data must support a high-level view, hierarchy navigation, and detail drill-down. The webview decides which node categories and edges are visible at each zoom/drill-down level; the contract stays layout-agnostic.

## 13. Migration notes (v1.0 -> v2.0)
- **Additive changes:** `analysis` block, `origin` on nodes/edges, `parentId` on nodes, `summaries`, `units`, `diagnostics.scope`, node type `subsystem`, evidence kind `ai_observation`, `project.languages` list.
- **Semantic change (breaking):** `confirmed` now requires deterministic verification of the relationship itself, not just endpoint/source existence. This is why the major version is bumped rather than staying additive.
- UI parsing must tolerate unknown node/edge types and missing optional fields (existing behavior).
- v1.0 producers (the indexer sidecar's standalone output) can be wrapped into v2.0 by emitting `analysis.status: "complete"` and `origin: "deterministic"` on all nodes/edges.
- No migration of stored documents is required yet: nothing persists results across sessions in the current implementation.

## 14. Contract implementation checklist
- [ ] Add a machine-readable schema/validator for v2.0.
- [ ] Add realistic sample responses: one complete, one partial (with `units` and `analysis.status: "partial"`).
- [ ] Validate output in Python tests and parse/validate safely in TypeScript.
- [ ] Add tests for unknown node/edge types, missing optional fields, and `ai_observation` evidence that lacks a validated source location.
- [ ] Increment `schemaVersion` for incompatible changes.

## 15. Current implementation state (as of 2026-11-09)

- `packages/contracts/` **does not exist yet**. This document is the only
  normative source for the v2.0 shape; the checklist in section 14 is still open.
- The webview still types the **v1.0** shape in
  `webview-ui/src/types/architecture.ts` (`schemaVersion: "1.0"`, singular
  `project.language`, no `origin`/`parentId`/`analysis`/`units`/`summaries`).
  Those types must be updated to v2.0 before real analysis output is rendered.
- The Python sidecar emits **two different documents**, and they must not be
  confused:
  - *Analyze mode* (`python -m analyzer <root>`) -> the legacy **v1.0**
    architecture graph, produced by the deprecated rule-based passes. Retained
    for now; it is not the product's architecture engine.
  - *Index mode* (`python -m analyzer <root> --index`) -> the **deterministic
    index document** (`schemaVersion: "1.1"` for the *index* format, which is
    distinct from both Index Contract v1 and the architecture contract
    version). It contains `digest`, `files`, `endpoints`, `routeBindings`,
    `models`, `ormRelationships`, `references`, `reverseReferences`,
    `language`, and `diagnostics`. The index document is an *input* to the
    agent, not a v2.0 analysis result. It is the output of the
    transitional/reference backend, **not** Index Contract v1.
- The Python index document is fully deterministic (no timestamps), so
  identical trees produce byte-identical JSON.
- The v2.0 analysis document (what the extension must ultimately produce and
  send to the webview) has **not been produced by any code yet**.
- Agent tool boundary is specified in `docs/AGENT_TOOLS.md` and implemented in
  `src/analysis/agentRunner.ts` (four tools; findings are final JSON, not a
  `findings.submit` tool call). The agent's `AgentFinding` proposal shape
  (`id`, `type: node|edge`, `proposedType`, `label`, `description`, `source`,
  `evidence`, `status: inferred|unresolved`) is an intermediate format, not
  the v2.0 node/edge shape. Decision (2026-11-09): each `AgentFinding` maps
  to one Index Contract v1 interpretation entry (see section 16.4); the
  validator/store step translates validated entries into v2.0 nodes/edges.
- Index-to-graph mapping is specified in `docs/INDEX_TO_GRAPH_MAPPING.md`;
  its `IndexService` checklist item is done (`src/analysis/indexService.ts`).
- **Index Contract v1 does not exist yet** as a machine-readable
  specification. Section 16 is a proposal to be approved before
  implementation. The Python index v1.1 and `AgentFinding` are its two
  migration sources (section 16.5).

## 16. Index Contract v1 (approved 2026-11-09)

### 16.1 Purpose and status
Index Contract v1 is the language-neutral representation every Indexer
produces, whether the Indexer is AI-based, deterministic parser-based, or
hybrid. The initial implementation is AI-first: an AI agent explores the
repository and produces index entries. A parser is only one possible
implementation tool. This section was approved on 2026-11-09; the canonical
machine-readable schema is `packages/contracts/index-v1.schema.json` and the
TypeScript types + structural validator are `src/analysis/indexContract.ts`.
It does not replace the v2.0 contract (sections 2-13), which remains the
final UI-facing output produced by deterministic mapping.

### 16.2 Top-level shape (approved 2026-11-09)
```json
{
  "indexVersion": "1.0",
  "project": { "root": ".", "languages": ["python"] },
  "indexer": { "kind": "ai", "provider": "openrouter", "model": "<configured model>" },
  "coverage": { "scopes": [] },
  "entries": [],
  "diagnostics": []
}
```
- `indexVersion`: Index Contract version (`"1.0"`), distinct from the
  Python reference backend's `"1.1"` and from Graph Contract `"2.0"`.
- `indexer.kind`: `ai` | `deterministic` | `hybrid`. `provider`/`model`
  are informational provenance for AI indexers.
- `coverage`: partial-coverage record (section 16.10). Required at the top
  level; `scopes` may be empty only when the whole repository is one scope.
- `entries`: fact and interpretation entries (section 16.3).
- `diagnostics`: indexer-level diagnostics (parse errors, budget
  exhaustion, unresolved references).

Canonical machine-readable schema: `packages/contracts/index-v1.schema.json`.
TypeScript types + structural validator: `src/analysis/indexContract.ts`.
Examples: `packages/contracts/examples/index-v1.complete.json` and
`index-v1.partial.json`.

### 16.3 Entry shape (proposed)
Every entry carries:
- `id`: unique within one index (see section 16.7 for identity rules).
- `kind`: `fact` | `interpretation`. Facts are mechanically observed
  (files, symbols, imports, references, route bindings, ORM declarations).
  Interpretations are AI-identified (subsystems, services, responsibilities,
  architectural relationships).
- `entryType`: language-neutral category, e.g. `file`, `module`, `symbol`,
  `import`, `reference`, `route`, `model`, `subsystem`, `service`,
  `relationship`. Framework-specific detail goes in `details`, never in
  the entry type vocabulary.
- `label`, `details` (optional): human-readable name and structured
  attributes (responsibility, methods, table, etc.).
- `source` (optional): workspace-relative POSIX `path` + one-based
  inclusive `startLine`/`endLine`.
- `evidence[]`: `{ kind, description, source?, metadata? }`. AI evidence
  uses `kind: "ai_observation"` with
  `metadata: { model, sourceLocationValidated }` (see section 16.6).
- `provenance`: `deterministic` | `ai` | `hybrid`.
- `status`: `confirmed` | `inferred` | `unresolved` (see section 16.4).
- `confidence` (optional, interpretations only): 0-1 estimate of confidence
  in the AI interpretation (see section 16.5).
- `parentId` (optional): hierarchy link (subsystem/module/class).

### 16.4 Status semantics (proposed)
`status` applies to every entry category, not just relationships:

- `confirmed`: the entry's claim was deterministically verified.
  - For a **fact** (file, symbol, import, route binding, ORM declaration):
    the structure was mechanically observed at the cited source location.
  - For a **resolved reference**: the reference target was resolved
    deterministically (e.g. import-table resolution to a known symbol).
  - For a **relationship**: the relationship itself was deterministically
    verified (decorator binding, ORM declaration, resolved call).
- `inferred`: the entry is plausible and evidence-backed but not
  deterministically verified. This is the default for AI interpretations.
- `unresolved`: the entry was investigated but could not be resolved
  confidently (e.g. a reference whose target is unknown). This is distinct
  from a scope that was never investigated (see section 16.8 coverage).

Three distinctions that must not be conflated:

1. A **mechanically observed reference** (a call site exists at line N) is a
   fact and is `confirmed` as an observation. Uncertainty about its
   architectural significance does not downgrade the observation itself.
2. A **successfully resolved reference** (the call site resolves to a known
   target symbol) is also `confirmed` as a resolution fact.
3. An **architectural relationship inferred from that reference** (e.g.
   "endpoint delegates to service") is an interpretation and remains
   `inferred` unless the relationship itself is deterministically verified.

Do not mark a mechanically observed fact as `inferred` merely because its
architectural significance is uncertain. The fact stays `confirmed`; the
interpretation built on it stays `inferred`.

### 16.5 Confidence semantics (proposed)
`confidence` is an optional 0-1 estimate of confidence in an AI
interpretation. It is **not** an uncertainty score, **not** a calibrated
probability, and it **cannot** independently upgrade an entry to
`confirmed`. Omit it when the agent cannot provide a meaningful estimate.
It is meaningful only for `kind: "interpretation"` entries.

### 16.6 Evidence validation (proposed)
AI evidence carries `metadata.sourceLocationValidated: true|false`, set by
the validator. `true` means the cited source location was verified against
the index (the file/symbol/lines exist as cited). It does **not** mean the
AI claim is semantically correct. An entry whose cited location cannot be
verified must not claim `sourceLocationValidated: true`, and an entry
supported only by unverified AI claims must not be `confirmed`. This field
replaces the ambiguous `metadata.validated` used in earlier drafts; the
same rename applies to Graph Contract v2.0 evidence (section 8).

Example -- fact entry (route binding):
```json
{
  "id": "route:endpoint:app.api.users:GET:/users->function:app.api.users:list_users_endpoint",
  "kind": "fact",
  "entryType": "route",
  "label": "GET /users -> list_users_endpoint",
  "source": { "path": "app/api/users.py", "startLine": 9, "endLine": 9 },
  "evidence": [{ "kind": "fastapi_route_decorator", "description": "Decorator binds GET /users to list_users_endpoint" }],
  "provenance": "deterministic",
  "status": "confirmed"
}
```

Example -- fact entry (observed reference; the observation is confirmed,
the architectural significance is a separate interpretation):
```json
{
  "id": "reference:app.api.users:list_users_endpoint->app.services.user_service:list_users:15",
  "kind": "fact",
  "entryType": "reference",
  "label": "list_users_endpoint calls list_users",
  "source": { "path": "app/api/users.py", "startLine": 15, "endLine": 15 },
  "evidence": [{ "kind": "function_call", "description": "Call site observed and resolved to app.services.user_service:list_users" }],
  "provenance": "deterministic",
  "status": "confirmed"
}
```

Example -- interpretation entry (service):
```json
{
  "id": "service:app.services.user_service:UserService",
  "kind": "interpretation",
  "entryType": "service",
  "label": "User service",
  "details": { "responsibility": "User management business logic" },
  "parentId": "subsystem:app.services",
  "source": { "path": "app/services/user_service.py", "startLine": 1, "endLine": 40 },
  "evidence": [{ "kind": "ai_observation", "description": "Module holds user query logic used by API endpoints", "source": { "path": "app/services/user_service.py", "startLine": 1, "endLine": 40 }, "metadata": { "model": "<configured model>", "sourceLocationValidated": false } }],
  "provenance": "ai",
  "status": "inferred",
  "confidence": 0.8
}
```

### 16.7 `AgentFinding` mapping (decided; adapter implemented 2026-11-09)
`AgentFinding` (`src/analysis/agentRunner.ts`) is the agent's intermediate
proposal format. Each finding maps to exactly one Index Contract v1
interpretation entry. The adapter is `src/analysis/agentFindingAdapter.ts`
(`adaptAgentFindings`); it runs the result through `validateIndexDocument()`
and throws if invalid. It performs no semantic validation.

**Known limitation:** the current `AgentFinding` shape carries no
relationship endpoints, and the findings JSON schema forbids extra fields.
Edge findings therefore cannot be mapped to resolved relationships today;
the adapter excludes them with an `unmappable_edge_missing_endpoints`
diagnostic rather than fabricating endpoints. Node findings map fully.

| `AgentFinding` field | Index v1 entry field |
| --- | --- |
| `id` | `id` (preserved) |
| `type: "node"` | `kind: "interpretation"`, `entryType` from `proposedType` |
| `type: "edge"` | `kind: "interpretation"`, `entryType: "relationship"`, `details.relationshipType` from `proposedType`, `details.source`/`details.target` from the finding's endpoints |
| `proposedType` | `entryType` (nodes) or `details.relationshipType` (edges) |
| `label`, `description` | `label`, `details.description` |
| `source` | `source` (validated by the validator) |
| `evidence[]` | `evidence[]` (kinds preserved; `ai_observation` gains `metadata.sourceLocationValidated` after validation) |
| `status: inferred\|unresolved` | `status` (preserved; never `confirmed` at proposal time) |
| `confidence` | `confidence` (0-1 estimate; see section 16.5) |

`AgentFinding` is never a v2.0 node/edge directly. Validation checks the
entry's evidence and consistency; deterministic mapping then produces v2.0
nodes/edges per `docs/INDEX_TO_GRAPH_MAPPING.md`.

### 16.8 Migration map: Python index v1.1 -> Index Contract v1
| Python v1.1 field | Index v1 entry |
| --- | --- |
| `files[]` (+ `module`, `language`, `lineCount`, `frameworks`) | `entryType: "file"` / `"module"`, `kind: "fact"`, `provenance: "deterministic"`, `status: "confirmed"` |
| `files[].symbols[]` | `entryType: "symbol"`, `kind: "fact"`, `status: "confirmed"` |
| `files[].imports[]` | `entryType: "import"`, `kind: "fact"`, `status: "confirmed"` |
| `references[]` / `reverseReferences` | `entryType: "reference"`, `kind: "fact"`, `status: "confirmed"` (observed + resolved reference; architectural significance is a separate interpretation entry, `inferred`) |
| `endpoints[]` + `routeBindings[]` | `entryType: "route"`, `kind: "fact"`, `status: "confirmed"` |
| `models[]` (+ `fields[]`) | `entryType: "model"`, `kind: "fact"`, `status: "confirmed"` |
| `ormRelationships[]` | `entryType: "relationship"`, `kind: "fact"`, `status: "confirmed"` |
| `digest` | Not an entry; becomes survey metadata (`indexer` + counts) or a `repo.overview` payload |
| `diagnostics[]` | `diagnostics[]` (preserved) |

The Python sidecar remains the transitional/reference backend producing
v1.1 until an Index Contract v1 producer exists. Do not expand its
framework-specific rules or remove it yet.

### 16.9 Identity (proposed)
Three distinct notions, never conflated:

- **Unique ID within one index:** every entry `id` is unique within a single
  index document. This is the only identity guarantee. Prefer deterministic
  ids derived from type + qualified symbol/path.
- **Cross-run stable identity:** the same logical entity keeps the same id
  across runs. This is **not** promised unless the mechanism supports it.
  Deterministic backends can derive stable ids from qualified names; AI
  indexers cannot guarantee stability across runs (renames, rewording, and
  model variance break it). Consumers must not rely on cross-run stability
  for AI-produced entries without additional correlation logic.
- **Source freshness / evidence validity:** whether the cited source still
  matches the entry. An entry's `sourceLocationValidated` reflects the
  index build time; it does not guarantee the source is unchanged later.
  Freshness is a cache/invalidation concern (later milestone), not an
  identity property.

### 16.10 Partial index coverage (proposed)
The index carries a `coverage` record alongside `entries`:

```json
{
  "coverage": {
    "scopes": [
      { "id": "scope:app.services", "scope": "app/services/", "status": "complete" },
      { "id": "scope:app.models", "scope": "app/models/", "status": "partial", "diagnostics": [{ "code": "budget_exhausted", "message": "Token budget reached" }] },
      { "id": "scope:app.api", "scope": "app/api/", "status": "pending" },
      { "id": "scope:legacy", "scope": "legacy/", "status": "failed", "diagnostics": [{ "code": "indexer_error", "message": "Parse failed" }] }
    ]
  }
}
```

- `complete`: the scope was fully investigated; its entries are final.
- `partial`: the scope was investigated but budgets ran out; entries exist
  but coverage is incomplete.
- `pending`: the scope was never investigated (no entries). This is
  distinct from an investigated-but-`unresolved` relationship (an entry
  with `status: "unresolved"`).
- `failed`: investigation was attempted and failed (diagnostics explain why).

Mapping to Graph Contract v2.0: each index scope becomes a v2.0 `unit`
with the same status (`complete`/`partial`/`pending`/`failed`); scope
counts roll up into `analysis.coverage` (`scopesExplored`,
`scopesPending`, `filesIndexed`, `filesTotal`). Pending/failed scopes
render as placeholder nodes with diagnostics, never as silent gaps.

### 16.11 Open questions for Index Contract v1
- Exact entry-type vocabulary and which types are facts vs interpretations.
- Whether `reverseReferences` is a stored field or a derived query.
- Whether AI-produced entry ids can be made stable enough for caching, or
  whether caching must key on source hashes instead.
