# First Vertical Slice Implementation Proposal

This document proposes the smallest practical end-to-end implementation that will:
1. Run the indexer from the extension
2. Let an agent query the index and inspect source files
3. Submit structured findings
4. Validate findings
5. Render real findings in the webview

---

## Scope Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Index document (v1.1) | ✅ Done | Python sidecar emits complete index |
| Agent tool boundary | ✅ Specified | `docs/AGENT_TOOLS.md` |
| Index-to-graph mapping | ✅ Specified | `docs/INDEX_TO_GRAPH_MAPPING.md` |
| **IndexBackend + IndexService** | 🔄 **Next** | TypeScript interface + sidecar spawn |
| **AnalysisController + analyze command** | 🔄 **Next** | Manual trigger, status, cancellation |
| **AgentRunner** | 🔄 **Next** | Bounded loop with 5 tools |
| **FindingValidator** | 🔄 **Next** | Two-tier validation |
| **ArchitectureStore + v2.0 document** | 🔄 **Next** | Merge index + AI findings |
| **Webview real rendering path** | 🔄 **Next** | Replace mock fixture |

---

## Proposed Implementation Order

### Step 1: IndexBackend Interface + IndexService (1-2 days)

**Files to create:**
- `src/analysis/indexBackend.ts` — TypeScript interface
- `src/analysis/pythonIndexBackend.ts` — Implementation spawning Python sidecar
- `src/analysis/indexService.ts` — High-level query API for AgentRunner

**IndexBackend Interface:**
```typescript
interface IndexBackend {
  buildIndex(root: string, excludes?: string[]): Promise<IndexDocument>;
  getDigest(): IndexDigest;
  querySymbols(filter: SymbolFilter): Promise<SymbolResult[]>;
  queryReferences(filter: ReferenceFilter): Promise<ReferenceResult[]>;
  queryReverseReferences(targetKey: string): Promise<ReferenceResult[]>;
  getEndpoints(): EndpointHint[];
  getModels(): ModelHint[];
  getRouteBindings(): RouteBinding[];
  getOrmRelationships(): OrmRelationship[];
  getFiles(): FileDoc[];
}
```

**PythonIndexBackend:**
- Spawns `python -m analyzer <root> --index` via child_process
- Parses JSON stdout (validates schemaVersion === "1.1")
- Caches the parsed document in memory
- Implements query methods by filtering the cached document
- Handles sidecar errors, timeouts, non-zero exit codes

**IndexService:**
- Wraps IndexBackend with higher-level methods for AgentRunner
- `getRepoOverview()` → returns digest for `repo.overview` tool
- `queryIndex(type, filter)` → routes to appropriate backend method
- Manages index lifecycle (build once per analysis run)

**Tests:** Unit tests with fixture index document (no sidecar spawn)

---

### Step 2: AnalysisController + analyze command (1 day)

**Files to create/modify:**
- `src/analysis/analysisController.ts` — orchestrates the analysis run
- `src/extension.ts` — register `code-visualizer.analyze` command

**AnalysisController:**
```typescript
class AnalysisController {
  async run(workspaceRoot: string, options: AnalysisOptions): Promise<AnalysisRun> {
    // 1. Validate workspace, check API key
    // 2. Show privacy disclosure (if first run)
    // 3. Build index via IndexService
    // 4. Run AgentRunner
    // 5. Validate findings via FindingValidator
    // 6. Assemble v2.0 document via ArchitectureStore
    // 7. Send to webview
    // 8. Return run result with status, usage, diagnostics
  }
}
```

**Command:**
- `code-visualizer.analyze` — triggers AnalysisController.run()
- Shows progress notification with cancellation
- On completion: shows success/error, opens webview if not open

**Privacy Disclosure:**
- Modal dialog on first analysis run
- States: "Code Visualizer will send selected source code excerpts to OpenRouter (and its upstream model vendors) for architecture analysis. Your configured exclude patterns will be honored."
- "Don't show again" checkbox → stored in globalState

---

### Step 3: AgentRunner (2-3 days)

**Files to create:**
- `src/analysis/agentRunner.ts` — bounded single-agent loop
- `src/analysis/agentTools.ts` — tool implementations

**AgentRunner Loop:**
```typescript
class AgentRunner {
  async run(indexService: IndexService, provider: ModelProvider, options: AgentOptions): Promise<AgentFindings> {
    // Stage 1: Survey - repo.overview
    const digest = await this.tools.repoOverview();
    
    // Stage 2: Plan subsystems (single model call with structured output)
    const plan = await this.proposeSubsystems(digest);
    
    // Stage 3: Explore each subsystem (bounded by budgets)
    for (const subsystem of plan.subsystems) {
      await this.exploreSubsystem(subsystem);
      if (this.budgets.exhausted()) break;
    }
    
    return this.collectedFindings;
  }
}
```

**Tool Implementations:**
- `repo.overview` → `indexService.getRepoOverview()`
- `index.query` → `indexService.queryIndex(type, filter)`
- `files.read` → `vscode.workspace.fs.readFile` + line range extraction (with exclude check)
- `files.search` → ripgrep via child_process (or simple grep fallback)
- `findings.submit` → validates structure, adds to collected findings

**Budgets (configurable via settings):**
- `maxTokensPerRun`: 50000
- `maxTurnsPerSubsystem`: 10
- `maxFilesPerTurn`: 5
- `maxLinesPerRead`: 200
- `maxQueryResults`: 100

**Structured Output:**
- Use `json_schema` response_format for all model calls
- Schema for: subsystem plan, findings submission
- Repair round on validation failure (max 1 retry)

---

### Step 4: FindingValidator (1-2 days)

**Files to create:**
- `src/analysis/findingValidator.ts` — two-tier validation

**Validation Pipeline:**
```typescript
class FindingValidator {
  validate(findings: AgentFindings, index: IndexDocument): ValidationResult {
    const results = [];
    
    for (const node of findings.nodes) {
      results.push(this.validateNode(node, index));
    }
    for (const edge of findings.edges) {
      results.push(this.validateEdge(edge, index));
    }
    
    return { accepted, rejected, repairRequired, diagnostics };
  }
  
  private validateNode(node, index) {
    // 1. Source-location validation
    if (node.source) {
      const file = index.files.find(f => f.path === node.source.path);
      if (!file) return { valid: false, error: "File not in index" };
      // Check symbol exists near cited lines
    }
    
    // 2. ID uniqueness
    // 3. ParentId references valid node
    
    return { valid: true };
  }
  
  private validateEdge(edge, index) {
    // 1. Source-location validation (both endpoints exist)
    // 2. Semantic validation for "confirmed" status
    if (edge.status === "confirmed") {
      if (edge.type === "route_handler") {
        // Must exist in index.routeBindings
      } else if (edge.type === "orm_relationship") {
        // Must exist in index.ormRelationships
      } else if (edge.type === "calls") {
        // Must exist in index.references AND agent validated semantics
      } else if (edge.type === "imports") {
        // Must exist in index.files[].imports
      } else {
        return { valid: false, error: "Only route_handler, orm_relationship, calls, imports can be confirmed" };
      }
    }
    
    // 3. AI-only edges must be "inferred" or "unresolved"
    if (edge.origin === "ai" && edge.status === "confirmed") {
      return { valid: false, error: "AI-only edges cannot be confirmed", downgrade: "inferred" };
    }
    
    return { valid: true };
  }
}
```

**Repair Round:**
- If validation fails, return errors to agent
- Agent gets one retry with `findings.submit` (repair mode)
- On second failure: downgrade or drop with diagnostic

---

### Step 5: ArchitectureStore + v2.0 Document Assembly (1 day)

**Files to create:**
- `src/analysis/architectureStore.ts` — merges index + validated findings

**Merge Logic:**
```typescript
class ArchitectureStore {
  assemble(index: IndexDocument, validatedFindings: ValidatedFindings, analysisMeta: AnalysisMeta): ArchitectureGraph {
    const nodes = [...this.mapIndexNodes(index), ...validatedFindings.nodes];
    const edges = [...this.mapIndexEdges(index), ...validatedFindings.edges];
    
    // Deduplicate by ID (index nodes win for deterministic ones)
    // Build hierarchy (parentId from module structure + AI subsystems)
    // Add summaries for subsystem/module nodes
    // Create units for partial runs
    
    return {
      schemaVersion: "2.0",
      project: { root: index.root, languages: [index.language] },
      analysis: analysisMeta,
      nodes: dedupe(nodes),
      edges: dedupe(edges),
      summaries: this.buildSummaries(nodes),
      units: this.buildUnits(validatedFindings),
      diagnostics: [...index.diagnostics, ...validatedFindings.diagnostics]
    };
  }
}
```

**Index → Graph Mapping (per `docs/INDEX_TO_GRAPH_MAPPING.md`):**
- Files → module nodes (deterministic)
- Symbols → function/class nodes (deterministic, hidden by default)
- Endpoints → endpoint nodes (deterministic)
- Models → database_model nodes (deterministic)
- RouteBindings → route_handler edges (confirmed)
- OrmRelationships → orm_relationship edges (confirmed)
- References → calls edges (inferred)
- Imports → imports edges (confirmed, hidden)
- AI findings → nodes/edges with origin: "ai", status: "inferred"

---

### Step 6: Webview Real Rendering Path (1 day)

**Files to modify:**
- `webview-ui/src/types/architecture.ts` — update to v2.0 types
- `src/extension.ts` — send v2.0 document to webview
- `webview-ui/src/App.tsx` — handle real document vs mock

**Type Updates (webview-ui/src/types/architecture.ts):**
```typescript
// Add to ArchitectureNode
origin: 'deterministic' | 'ai' | 'hybrid';
parentId?: string;

// Add to ArchitectureEdge
origin: 'deterministic' | 'ai' | 'hybrid';

// Update ArchitectureGraph
schemaVersion: "2.0";
project: { root: string; languages: string[] };
analysis: { id: string; status: 'complete' | 'partial' | 'failed'; ... };
summaries?: Record<string, string>;
units?: AnalysisUnit[];
```

**Message Bridge:**
- Extension sends `architectureGraph` message with v2.0 document
- Webview replaces mock fixture with real data
- UI renders with evidence, status, origin indicators
- Click node → show details panel with evidence
- Click source location → `vscode.window.showTextDocument`

---

## Configuration Requirements

**New Settings (package.json):**
```json
{
  "codeVisualizer.analysis.maxTokensPerRun": { "type": "number", "default": 50000 },
  "codeVisualizer.analysis.maxTurnsPerSubsystem": { "type": "number", "default": 10 },
  "codeVisualizer.analysis.maxFilesPerTurn": { "type": "number", "default": 5 },
  "codeVisualizer.analysis.maxLinesPerRead": { "type": "number", "default": 200 },
  "codeVisualizer.privacy.disclosureAccepted": { "type": "boolean", "default": false, "scope": "global" }
}
```

---

## Test Strategy

**Offline Tests (no real API calls):**
1. IndexService tests with fixture index document
2. AgentRunner tests with mocked ModelProvider (returns canned responses)
3. FindingValidator tests with various valid/invalid findings
4. ArchitectureStore tests with known index + findings → expected graph
5. Webview component tests with v2.0 fixture data

**Integration Test (manual):**
- Run `code-visualizer.analyze` on `services/analyzer/tests/fixtures/fastapi_app`
- Verify webview shows real graph with endpoints, services, models
- Verify evidence panel shows source locations
- Verify clicking node navigates to source

---

## Estimated Effort

| Step | Component | Estimate |
|------|-----------|----------|
| 1 | IndexBackend + IndexService | 1-2 days |
| 2 | AnalysisController + analyze command | 1 day |
| 3 | AgentRunner + tools | 2-3 days |
| 4 | FindingValidator | 1-2 days |
| 5 | ArchitectureStore + v2.0 assembly | 1 day |
| 6 | Webview real rendering + types | 1 day |
| **Total** | | **7-10 days** |

---

## Dependencies Between Steps

```
Step 1 (IndexService) ──┐
                        ├──→ Step 3 (AgentRunner needs IndexService)
Step 2 (Controller) ────┤
                        ├──→ Step 4 (Validator needs IndexDocument)
                        ├──→ Step 5 (Store needs Index + Validated Findings)
                        └──→ Step 6 (Webview needs v2.0 Document)
```

**Can be parallelized:**
- Step 2 (Controller) can start after Step 1 basic structure
- Step 4 (Validator) can be developed with fixture index document
- Step 6 (Webview types) can start immediately

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Model output doesn't match json_schema | Structured output with repair round; fallback to text parsing with validation |
| Agent explores too many files | Strict budget enforcement in AgentRunner; hard limits on tool calls |
| Index build slow on large repos | Digest is capped at 500 entries; index queries are in-memory filters |
| Webview types diverge from contract | Single source of truth: `docs/ARCHITECTURE_DATA_MODEL.md`; generate types if needed |
| Privacy disclosure UX complex | Start with simple modal; enhance in Milestone 5 |

---

## Success Criteria for Vertical Slice

1. ✅ User runs `Code Visualizer: Analyze` command
2. ✅ Index builds (shows progress)
3. ✅ Agent runs bounded exploration (shows turn count / token usage)
4. ✅ Findings validated (source locations checked, confirmed/inferred set correctly)
5. ✅ Webview renders real graph with:
   - Subsystems, endpoints, services, database models
   - Edges with status badges (confirmed/inferred)
   - Evidence panel on node click
   - Source navigation on location click
6. ✅ Token usage and estimated cost displayed
7. ✅ Partial status shown if budgets exhausted
8. ✅ All automated tests pass (npm test, python unittest)

---

## Next Action

Begin **Step 1: IndexBackend + IndexService** as the foundation for all subsequent work. This is the smallest change that unblocks the rest of the vertical slice.