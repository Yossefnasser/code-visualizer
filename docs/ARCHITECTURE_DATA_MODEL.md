# Architecture Data Model Contract (v2.0)

## 1. Purpose
This document defines the shared, language-neutral shape of architecture analysis results. The extension host assembles the data from the deterministic index and validated AI findings; the React webview renders it. The schema is a design contract; implement a machine-validated JSON Schema (or equivalent validator) before relying on it for integration.

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
      "metadata": { "model": "<configured model>", "validated": true }
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
- New kind `ai_observation`: an AI-origin claim. Its `metadata` should include `{ "model": string, "validated": boolean }`, where `validated: true` means the cited source location was verified against the index. An `ai_observation` whose cited location cannot be verified must not claim `validated: true`, and an edge supported only by unverified AI claims must not be `confirmed`.

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

## 15. Current implementation state (as of 2026-10-20)

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
    index document** (`schemaVersion: "1.0"` for the *index* format, which is
    distinct from the architecture contract version). It contains `digest`,
    `files`, `endpoints`, `routeBindings`, `models`, `ormRelationships`,
    `references`, and `diagnostics`. The index document is an *input* to the
    agent, not a v2.0 analysis result.
- The index document is fully deterministic (no timestamps), so identical trees
  produce byte-identical JSON.
- The v2.0 analysis document (what the extension must ultimately produce and
  send to the webview) has **not been produced by any code yet**.
