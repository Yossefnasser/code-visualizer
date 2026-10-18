/**
 * Shared shape of the architecture graph contract.
 * Mirrors `docs/ARCHITECTURE_DATA_MODEL.md` (schemaVersion "1.0").
 *
 * These types describe analyzer output, not React Flow presentation. The UI
 * maps domain node types to React Flow node renderers.
 */

export type ArchitectureNodeType =
  | 'endpoint'
  | 'service'
  | 'function'
  | 'class'
  | 'module'
  | 'database_model'
  | 'database_field';

export type RelationshipType =
  | 'route_handler'
  | 'calls'
  | 'uses_model'
  | 'orm_relationship'
  | 'imports';

export type EvidenceStatus = 'confirmed' | 'inferred' | 'unresolved';

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
}

export interface ArchitectureEdge {
  id: string;
  source: string;
  target: string;
  type: RelationshipType;
  status: EvidenceStatus;
  evidence?: Evidence[];
}

export interface ArchitectureDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  source?: SourceLocation;
}

export interface ArchitectureGraph {
  schemaVersion: string;
  project: { root: string; language: string };
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  diagnostics: ArchitectureDiagnostic[];
}

/** Data payload carried by every React Flow node rendered from a graph node. */
export type ArchitectureNodeData = { node: ArchitectureNode } & Record<string, unknown>;
