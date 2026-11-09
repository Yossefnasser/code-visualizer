/**
 * Index Contract v1 → Architecture Graph Contract v2.0 mapper.
 *
 * Deterministic, no LLM calls. Pure translation from a validated Index
 * Contract v1 document to the Graph v2.0 shape consumed by the webview.
 *
 * Design references:
 * - Index Contract v1: `docs/ARCHITECTURE_DATA_MODEL.md` §16
 * - Graph v2.0: `docs/ARCHITECTURE_DATA_MODEL.md` §2-13
 * - Mapping rules: `docs/INDEX_TO_GRAPH_MAPPING.md`
 */

import {
  IndexDocumentV1,
  IndexEntry,
  IndexEntryType,
  IndexRelationshipType,
  IndexEntryStatus,
  IndexProvenance,
  IndexCoverageScope,
  IndexDiagnostic,
  validateIndexDocument,
} from './indexContract';

/** Graph v2.0 types (mirroring webview-ui/src/types/architecture.ts). */
export type GraphNodeType =
  | 'endpoint'
  | 'service'
  | 'function'
  | 'class'
  | 'module'
  | 'database_model'
  | 'database_field'
  | 'subsystem';

export type GraphRelationshipType =
  | 'route_handler'
  | 'calls'
  | 'uses_model'
  | 'orm_relationship'
  | 'imports'
  | 'uses'
  | 'reads'
  | 'writes';

export type GraphStatus = 'confirmed' | 'inferred' | 'unresolved';

export interface GraphSourceLocation {
  path: string;
  startLine: number;
  endLine?: number;
}

export interface GraphEvidence {
  kind: string;
  description: string;
  source?: GraphSourceLocation;
  metadata?: Record<string, unknown>;
}

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  details?: Record<string, unknown>;
  source?: GraphSourceLocation;
  evidence?: GraphEvidence[];
  origin?: 'deterministic' | 'ai' | 'hybrid';
  parentId?: string;
  status?: GraphStatus;
  confidence?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: GraphRelationshipType;
  status: GraphStatus;
  evidence?: GraphEvidence[];
  origin?: 'deterministic' | 'ai' | 'hybrid';
}

export interface GraphDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  source?: GraphSourceLocation;
  scope?: string;
}

export interface GraphCoverageScope {
  id: string;
  scope: string;
  status: 'complete' | 'partial' | 'pending' | 'failed';
  diagnostics?: GraphDiagnostic[];
}

export interface ArchitectureGraph {
  schemaVersion: '2.0';
  project: { root: string; languages: string[] };
  analysis: {
    status: 'complete' | 'partial' | 'failed';
    coverage?: {
      scopesExplored: number;
      scopesPending: number;
      filesIndexed: number;
      filesTotal: number;
    };
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
  summaries?: Record<string, string>;
  units: GraphCoverageScope[];
  diagnostics: GraphDiagnostic[];
}

/** Result of the mapping operation. */
export interface MapperResult {
  graph: ArchitectureGraph;
  /** Warnings for entries that could not be mapped (never silently dropped). */
  warnings: string[];
}

/** Map Index entry type → Graph node type. Returns undefined if unsupported. */
function mapEntryTypeToNodeType(entryType: IndexEntryType): GraphNodeType | undefined {
  switch (entryType) {
    case 'file':
    case 'module':
      return 'module';
    case 'symbol':
      return 'function'; // default; class distinction would need details
    case 'route':
      return 'endpoint';
    case 'model':
      return 'database_model';
    case 'subsystem':
      return 'subsystem';
    case 'service':
      return 'service';
    case 'import':
    case 'reference':
    case 'relationship':
      return undefined; // these become edges, not nodes
    default:
      return undefined;
  }
}

/** Map Index relationship type → Graph relationship type. */
function mapRelationshipType(indexType: IndexRelationshipType): GraphRelationshipType {
  // Direct 1:1 mapping for the shared vocabulary
  return indexType;
}

/** Map Index status → Graph status. */
function mapStatus(indexStatus: IndexEntryStatus): GraphStatus {
  return indexStatus;
}

/** Map Index provenance → Graph origin. */
function mapProvenance(prov: IndexProvenance): 'deterministic' | 'ai' | 'hybrid' {
  return prov;
}

/** Convert Index source location → Graph source location. */
function mapSource(source?: { path: string; startLine: number; endLine?: number }): GraphSourceLocation | undefined {
  if (!source) return undefined;
  return { path: source.path, startLine: source.startLine, endLine: source.endLine };
}

/** Convert Index evidence → Graph evidence. */
function mapEvidence(evidence: readonly { kind: string; description: string; source?: { path: string; startLine: number; endLine?: number }; metadata?: Record<string, unknown> }[]): GraphEvidence[] {
  return evidence.map((e) => ({
    kind: e.kind,
    description: e.description,
    source: e.source ? { path: e.source.path, startLine: e.source.startLine, endLine: e.source.endLine } : undefined,
    metadata: e.metadata,
  }));
}

/** Build a Graph node from an Index entry. Returns undefined if entry type is not a node type. */
function buildNode(entry: IndexEntry): GraphNode | undefined {
  const nodeType = mapEntryTypeToNodeType(entry.entryType);
  if (!nodeType) return undefined;

  // For symbol entries, try to distinguish function vs class from details
  let finalNodeType = nodeType;
  if (entry.entryType === 'symbol' && entry.details) {
    const kind = entry.details.kind;
    if (kind === 'class') finalNodeType = 'class';
    else if (kind === 'function') finalNodeType = 'function';
  }

  return {
    id: entry.id,
    type: finalNodeType,
    label: entry.label,
    details: entry.details ? { ...entry.details } : undefined,
    source: mapSource(entry.source),
    evidence: mapEvidence(entry.evidence),
    origin: mapProvenance(entry.provenance),
    parentId: entry.parentId,
    status: mapStatus(entry.status),
    confidence: entry.confidence,
  };
}

/** Build Graph edges from relationship entries. */
function buildEdges(entries: readonly IndexEntry[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const entry of entries) {
    if (entry.entryType !== 'relationship') continue;
    const details = entry.details as {
      relationshipType?: IndexRelationshipType;
      sourceEntryId?: string;
      targetEntryId?: string | null;
      resolutionStatus?: 'resolved' | 'unresolved';
    } | undefined;
    if (!details || !details.relationshipType || !details.sourceEntryId) continue;

    const targetId = details.targetEntryId;
    const resolved = details.resolutionStatus === 'resolved' && targetId !== null && targetId !== undefined;

    if (resolved) {
      edges.push({
        id: entry.id,
        source: details.sourceEntryId,
        target: targetId!,
        type: mapRelationshipType(details.relationshipType),
        status: mapStatus(entry.status),
        evidence: mapEvidence(entry.evidence),
        origin: mapProvenance(entry.provenance),
      });
    }
    // Unresolved relationships: do not create an edge at all (they have no valid target)
    // The mapper will warn about them in the main function
  }
  return edges;
}

/** Map Index diagnostics → Graph diagnostics. */
function mapDiagnostics(diagnostics: readonly IndexDiagnostic[]): GraphDiagnostic[] {
  return diagnostics.map((d) => ({
    severity: d.severity,
    code: d.code,
    message: d.message,
    source: d.source ? { path: d.source.path, startLine: d.source.startLine, endLine: d.source.endLine } : undefined,
    scope: d.scope,
  }));
}

/** Map Index coverage scopes → Graph units. */
function mapCoverage(scopes: readonly IndexCoverageScope[]): GraphCoverageScope[] {
  return scopes.map((s) => ({
    id: s.id,
    scope: s.scope,
    status: s.status,
    diagnostics: s.diagnostics ? mapDiagnostics(s.diagnostics) : undefined,
  }));
}

/** Compute analysis-level coverage summary. */
function computeAnalysisCoverage(scopes: readonly IndexCoverageScope[]): ArchitectureGraph['analysis']['coverage'] {
  const scopesExplored = scopes.filter((s) => s.status === 'complete' || s.status === 'partial').length;
  const scopesPending = scopes.filter((s) => s.status === 'pending').length;
  // We don't have file counts in the index coverage; use 0 as placeholder
  return { scopesExplored, scopesPending, filesIndexed: 0, filesTotal: 0 };
}

/** Determine overall analysis status from coverage. */
function computeAnalysisStatus(scopes: readonly IndexCoverageScope[]): 'complete' | 'partial' | 'failed' {
  if (scopes.length === 0) return 'complete';
  const hasFailed = scopes.some((s) => s.status === 'failed');
  const hasPartial = scopes.some((s) => s.status === 'partial');
  const hasPending = scopes.some((s) => s.status === 'pending');
  // If there are any failed scopes but also other non-failed scopes, the overall is partial
  // (some work was done). Only pure failed (all scopes failed) = failed.
  if (hasFailed) {
    const allFailed = scopes.every((s) => s.status === 'failed');
    if (allFailed) return 'failed';
    return 'partial';
  }
  if (hasPartial || hasPending) return 'partial';
  return 'complete';
}

/**
 * Main mapper function.
 * Input must be a structurally valid Index Contract v1 document.
 * Returns a Graph v2.0 document + warnings for unmapped entries.
 */
export function mapIndexToGraph(indexDoc: IndexDocumentV1): MapperResult {
  const warnings: string[] = [];
  const nodes: GraphNode[] = [];
  const nodeIds = new Set<string>();

  // Validate input document first
  const validationErrors = validateIndexDocument(indexDoc);
  if (validationErrors.length > 0) {
    throw new Error(`Invalid Index Contract v1 document: ${validationErrors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }

  // First pass: build nodes from supported entry types
  for (const entry of indexDoc.entries) {
    const node = buildNode(entry);
    if (node) {
      if (nodeIds.has(node.id)) {
        warnings.push(`Duplicate node id "${node.id}" — skipping duplicate`);
        continue;
      }
      nodes.push(node);
      nodeIds.add(node.id);
    } else {
      // Entry types that don't map to nodes (import, reference, relationship) are expected
      // Relationship entries become edges in the second pass
      if (entry.entryType !== 'import' && entry.entryType !== 'reference' && entry.entryType !== 'relationship') {
        warnings.push(`Unsupported entry type "${entry.entryType}" for id "${entry.id}" — skipped`);
      }
    }
  }

  // Second pass: build edges from relationship entries
  const edges = buildEdges(indexDoc.entries);

  // Filter edges to only those where both source and target nodes exist
  const validEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  if (validEdges.length !== edges.length) {
    warnings.push(`${edges.length - validEdges.length} edge(s) referenced missing nodes and were dropped`);
  }

  // Warn about unresolved relationships (they produce no edges)
  const unresolvedCount = indexDoc.entries.filter(
    (e) => e.entryType === 'relationship' && e.details && (e.details as any).resolutionStatus === 'unresolved'
  ).length;
  if (unresolvedCount > 0) {
    warnings.push(`${unresolvedCount} unresolved relationship(s) produced no edges`);
  }

  // Build graph
  const graph: ArchitectureGraph = {
    schemaVersion: '2.0',
    project: { root: indexDoc.project.root, languages: [...indexDoc.project.languages] },
    analysis: {
      status: computeAnalysisStatus(indexDoc.coverage.scopes),
      coverage: computeAnalysisCoverage(indexDoc.coverage.scopes),
    },
    nodes,
    edges: validEdges,
    summaries: undefined, // not generated by this mapper
    units: mapCoverage(indexDoc.coverage.scopes),
    diagnostics: mapDiagnostics(indexDoc.diagnostics),
  };

  return { graph, warnings };
}