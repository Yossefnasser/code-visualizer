/**
 * Shared shape of the architecture graph contract v2.0.
 * Mirrors `docs/ARCHITECTURE_DATA_MODEL.md` §2-13 and the Graph v2.0 types
 * exported by `src/analysis/indexToGraphMapper.ts` in the extension host.
 *
 * These types describe graph data, not React Flow presentation. The UI
 * maps domain node types to React Flow node renderers. Parsing must
 * tolerate unknown node/edge types and missing optional fields.
 */

export type ArchitectureNodeType =
  | 'endpoint'
  | 'service'
  | 'function'
  | 'class'
  | 'module'
  | 'database_model'
  | 'database_field'
  | 'subsystem';

export type RelationshipType =
  | 'route_handler'
  | 'calls'
  | 'uses_model'
  | 'orm_relationship'
  | 'imports'
  | 'uses'
  | 'reads'
  | 'writes';

export type EvidenceStatus = 'confirmed' | 'inferred' | 'unresolved';

export type GraphOrigin = 'deterministic' | 'ai' | 'hybrid';

export interface SourceLocation {
  /** Workspace-relative path using "/" separators. */
  path: string;
  /** One-based first relevant line, inclusive. */
  startLine: number;
  /** One-based last relevant line, inclusive, if known. */
  endLine?: number;
}

export interface Evidence {
  kind: string;
  description: string;
  source?: SourceLocation;
  metadata?: Record<string, unknown>;
}

export interface ArchitectureNode {
  id: string;
  type: ArchitectureNodeType;
  label: string;
  details?: Record<string, unknown>;
  source?: SourceLocation;
  evidence?: Evidence[];
  /** Where the node came from (v2.0). */
  origin?: GraphOrigin;
  /** Hierarchy: id of the parent module/subsystem node (v2.0). */
  parentId?: string;
  status?: EvidenceStatus;
  confidence?: number;
}

export interface ArchitectureEdge {
  id: string;
  source: string;
  target: string;
  type: RelationshipType;
  status: EvidenceStatus;
  evidence?: Evidence[];
  /** Where the edge came from (v2.0). */
  origin?: GraphOrigin;
}

export interface ArchitectureDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  source?: SourceLocation;
  /** Unit/scope attribution (v2.0). */
  scope?: string;
}

export interface ArchitectureCoverageScope {
  id: string;
  scope: string;
  status: 'complete' | 'partial' | 'pending' | 'failed';
  diagnostics?: ArchitectureDiagnostic[];
}

export interface AnalysisCoverage {
  scopesExplored: number;
  scopesPending: number;
  filesIndexed: number;
  filesTotal: number;
}

export interface ArchitectureAnalysis {
  status: 'complete' | 'partial' | 'failed';
  coverage?: AnalysisCoverage;
}

export interface ArchitectureGraph {
  schemaVersion: string;
  // `languages` is the v2.0 shape; legacy documents carry a singular `language`
  // (accepted during transition per ARCHITECTURE_DATA_MODEL.md §13).
  project: { root: string; languages?: string[]; language?: string };
  analysis?: ArchitectureAnalysis;
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  summaries?: Record<string, string>;
  units?: ArchitectureCoverageScope[];
  diagnostics: ArchitectureDiagnostic[];
}

/** Data payload carried by every React Flow node rendered from a graph node. */
export type ArchitectureNodeData = { node: ArchitectureNode } & Record<string, unknown>;
