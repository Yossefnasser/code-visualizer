/**
 * AgentFinding -> Index Contract v1 adapter.
 *
 * Converts `AgentRunner` output (`AgentFinding[]`) into a structurally valid
 * Index Contract v1 document (`src/analysis/indexContract.ts`).
 *
 * This is a pure translation step: it performs NO semantic validation. It
 * never claims source locations or relationships have been verified, never
 * upgrades `inferred`/`unresolved` to `confirmed`, and never fabricates
 * relationship endpoints or IDs. Findings that cannot be mapped without
 * violating the contract are excluded and reported via diagnostics.
 *
 * Known limitation (by design, not a bug): the current `AgentFinding`
 * shape carries no relationship endpoints (`sourceEntryId`/`targetEntryId`),
 * and the findings JSON schema forbids extra fields. Edge findings therefore
 * cannot be mapped to resolved relationships today; they are reported as
 * `unmappable_edge_missing_endpoints` diagnostics and excluded. If a future
 * finding shape carries endpoints, the adapter will map them (see
 * `EdgeEndpoints`).
 */

import { AgentFinding } from './agentRunner';
import {
  INDEX_CONTRACT_VERSION,
  IndexCoverageScope,
  IndexDiagnostic,
  IndexDocumentV1,
  IndexEntry,
  IndexEntryType,
  IndexRelationshipType,
  validateIndexDocument,
} from './indexContract';

/** Optional endpoint fields a future finding shape may carry. */
export interface EdgeEndpoints {
  readonly sourceEntryId?: string;
  readonly targetEntryId?: string | null;
}

export interface AdapterOptions {
  readonly project: { readonly root: string; readonly languages: readonly string[] };
  readonly indexer: {
    readonly kind: 'ai' | 'deterministic' | 'hybrid';
    readonly provider?: string;
    readonly model?: string;
  };
  /** Explicit coverage. The adapter never claims complete coverage without evidence. */
  readonly coverage: { readonly scopes: readonly IndexCoverageScope[] };
  readonly diagnostics?: readonly IndexDiagnostic[];
}

export interface AdapterResult {
  readonly document: IndexDocumentV1;
  /** Diagnostics for findings that could not be mapped (excluded, never fabricated). */
  readonly diagnostics: readonly IndexDiagnostic[];
  /** IDs of findings that were excluded. */
  readonly excludedFindingIds: readonly string[];
}

const RELATIONSHIP_TYPES: readonly string[] = [
  'route_handler', 'calls', 'uses_model', 'orm_relationship',
  'imports', 'uses', 'reads', 'writes',
];

/** Node `proposedType` -> Index v1 `entryType`. Unknown types are unmappable. */
const NODE_TYPE_MAP: Readonly<Record<string, IndexEntryType>> = {
  file: 'file',
  module: 'module',
  symbol: 'symbol',
  function: 'symbol',
  class: 'symbol',
  import: 'import',
  reference: 'reference',
  route: 'route',
  endpoint: 'route',
  model: 'model',
  database_model: 'model',
  subsystem: 'subsystem',
  service: 'service',
};

function diagnostic(code: string, message: string): IndexDiagnostic {
  return { severity: 'warning', code, message };
}

/**
 * Convert AgentFinding proposals into an Index Contract v1 document.
 * The result is run through `validateIndexDocument()`; if it is invalid,
 * an Error is thrown (the adapter never returns an invalid document).
 */
export function adaptAgentFindings(
  findings: readonly AgentFinding[],
  options: AdapterOptions
): AdapterResult {
  const entries: IndexEntry[] = [];
  const diagnostics: IndexDiagnostic[] = [...(options.diagnostics ?? [])];
  const excludedFindingIds: string[] = [];
  const seenIds = new Set<string>();

  for (const finding of findings) {
    if (!finding || typeof finding.id !== 'string' || finding.id.length === 0) {
      diagnostics.push(diagnostic('malformed_finding', 'Finding without a valid id was excluded.'));
      continue;
    }
    if (seenIds.has(finding.id)) {
      diagnostics.push(diagnostic('duplicate_finding_id', `Duplicate finding id "${finding.id}" was excluded.`));
      excludedFindingIds.push(finding.id);
      continue;
    }
    seenIds.add(finding.id);

    if (finding.type === 'node') {
      const entryType = NODE_TYPE_MAP[finding.proposedType];
      if (!entryType) {
        diagnostics.push(diagnostic('unmappable_node_type', `Node finding "${finding.id}" has unknown proposedType "${finding.proposedType}" and was excluded.`));
        excludedFindingIds.push(finding.id);
        continue;
      }
      entries.push({
        id: finding.id,
        kind: 'interpretation',
        entryType,
        label: finding.label,
        details: { description: finding.description },
        ...(finding.source ? { source: finding.source } : {}),
        evidence: finding.evidence.map((item) => ({
          kind: item.kind,
          description: item.description,
          ...(item.source ? { source: item.source } : {}),
        })),
        provenance: 'ai',
        status: finding.status,
        ...(finding.confidence !== undefined ? { confidence: finding.confidence } : {}),
      });
      continue;
    }

    if (finding.type === 'edge') {
      if (!RELATIONSHIP_TYPES.includes(finding.proposedType)) {
        diagnostics.push(diagnostic('unmappable_edge_type', `Edge finding "${finding.id}" has unknown proposedType "${finding.proposedType}" and was excluded.`));
        excludedFindingIds.push(finding.id);
        continue;
      }
      const endpoints = finding as AgentFinding & EdgeEndpoints;
      const sourceEntryId = endpoints.sourceEntryId;
      const targetEntryId = endpoints.targetEntryId;
      if (typeof sourceEntryId !== 'string' || sourceEntryId.length === 0) {
        diagnostics.push(diagnostic('unmappable_edge_missing_endpoints', `Edge finding "${finding.id}" carries no source endpoint and was excluded. The current AgentFinding shape has no endpoint fields; endpoints are never fabricated.`));
        excludedFindingIds.push(finding.id);
        continue;
      }
      const resolved = typeof targetEntryId === 'string' && targetEntryId.length > 0;
      entries.push({
        id: finding.id,
        kind: 'interpretation',
        entryType: 'relationship',
        label: finding.label,
        details: {
          relationshipType: finding.proposedType as IndexRelationshipType,
          sourceEntryId,
          targetEntryId: resolved ? targetEntryId : null,
          resolutionStatus: resolved ? 'resolved' : 'unresolved',
          description: finding.description,
        },
        ...(finding.source ? { source: finding.source } : {}),
        evidence: finding.evidence.map((item) => ({
          kind: item.kind,
          description: item.description,
          ...(item.source ? { source: item.source } : {}),
        })),
        provenance: 'ai',
        status: finding.status,
        ...(finding.confidence !== undefined ? { confidence: finding.confidence } : {}),
      });
      continue;
    }

    diagnostics.push(diagnostic('malformed_finding', `Finding "${finding.id}" has unknown type and was excluded.`));
    excludedFindingIds.push(finding.id);
  }

  const document: IndexDocumentV1 = {
    indexVersion: INDEX_CONTRACT_VERSION,
    project: options.project,
    indexer: options.indexer,
    coverage: options.coverage,
    entries,
    diagnostics,
  };

  const errors = validateIndexDocument(document);
  if (errors.length > 0) {
    throw new Error(
      `Adapted Index Contract v1 document is invalid: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`
    );
  }

  return { document, diagnostics, excludedFindingIds };
}
