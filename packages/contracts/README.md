# Shared Contracts

Machine-readable contract specifications for Code Visualizer. These files
are the canonical schemas; the TypeScript types and validator in
`src/analysis/indexContract.ts` mirror them without external dependencies.

| File | Contract | Status |
| --- | --- | --- |
| `index-v1.schema.json` | Architecture Index Contract v1 (`indexVersion: "1.0"`) | Approved design (`docs/ARCHITECTURE_DATA_MODEL.md` §16); schema implemented |
| `examples/index-v1.complete.json` | Complete index example | Validates against the schema |
| `examples/index-v1.partial.json` | Partial index example (pending/failed scopes, unresolved relationship) | Validates against the schema |

The Architecture Graph Contract v2.0 schema does not exist yet; it is
specified in `docs/ARCHITECTURE_DATA_MODEL.md` sections 2-13.

Relationship vocabulary (`route_handler`, `calls`, `uses_model`,
`orm_relationship`, `imports`, `uses`, `reads`, `writes`) is preserved from
`docs/INDEX_TO_GRAPH_MAPPING.md`. `parentId` expresses hierarchy only; it is
not a substitute for `relationship` entries.
