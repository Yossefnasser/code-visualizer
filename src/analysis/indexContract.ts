/**
 * Index Contract v1 types and structural validator.
 *
 * Canonical specification: `packages/contracts/index-v1.schema.json`
 * (design: `docs/ARCHITECTURE_DATA_MODEL.md` section 16).
 *
 * This module is intentionally dependency-free: the validator is a
 * hand-rolled structural check mirroring the JSON Schema, so the extension
 * host needs no schema-validation package. It validates shape only; it does
 * not verify source locations or semantic correctness (that is the
 * FindingValidator's job, a later milestone).
 */

/** Index Contract version. Distinct from Python index v1.1 and Graph v2.0. */
export const INDEX_CONTRACT_VERSION = '1.0' as const;

/** Language-neutral entry categories. Framework detail goes in `details`. */
export type IndexEntryType =
  | 'file'
  | 'module'
  | 'symbol'
  | 'import'
  | 'reference'
  | 'route'
  | 'model'
  | 'subsystem'
  | 'service'
  | 'relationship';

/** Relationship vocabulary (preserved from INDEX_TO_GRAPH_MAPPING). */
export type IndexRelationshipType =
  | 'route_handler'
  | 'calls'
  | 'uses_model'
  | 'orm_relationship'
  | 'imports'
  | 'uses'
  | 'reads'
  | 'writes';

export type IndexEntryKind = 'fact' | 'interpretation';
export type IndexProvenance = 'deterministic' | 'ai' | 'hybrid';
export type IndexEntryStatus = 'confirmed' | 'inferred' | 'unresolved';
export type IndexerKind = 'ai' | 'deterministic' | 'hybrid';
export type CoverageStatus = 'complete' | 'partial' | 'pending' | 'failed';
export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface IndexSourceLocation {
  readonly path: string;
  readonly startLine: number;
  readonly endLine?: number;
}

export interface IndexEvidence {
  readonly kind: string;
  readonly description: string;
  readonly source?: IndexSourceLocation;
  readonly metadata?: {
    readonly model?: string;
    /** True iff the cited source location was verified against the index.
     *  Does NOT mean the AI claim is semantically correct. */
    readonly sourceLocationValidated?: boolean;
    readonly [key: string]: unknown;
  };
}

export interface IndexDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly source?: IndexSourceLocation;
  readonly scope?: string;
}

export interface IndexRelationshipDetails {
  readonly relationshipType: IndexRelationshipType;
  readonly sourceEntryId: string;
  readonly targetEntryId: string | null;
  readonly resolutionStatus: 'resolved' | 'unresolved';
  readonly [key: string]: unknown;
}

export interface IndexEntry {
  readonly id: string;
  readonly kind: IndexEntryKind;
  readonly entryType: IndexEntryType;
  readonly label: string;
  readonly details?: Record<string, unknown>;
  readonly source?: IndexSourceLocation;
  readonly evidence: readonly IndexEvidence[];
  readonly provenance: IndexProvenance;
  readonly status: IndexEntryStatus;
  /** Optional 0-1 estimate of confidence in an AI interpretation.
   *  Not a calibrated probability; cannot upgrade an entry to confirmed. */
  readonly confidence?: number;
  /** Hierarchy link (subsystem/module/class). Not a semantic relationship. */
  readonly parentId?: string;
}

export interface IndexCoverageScope {
  readonly id: string;
  readonly scope: string;
  readonly status: CoverageStatus;
  readonly diagnostics?: readonly IndexDiagnostic[];
}

export interface IndexDocumentV1 {
  readonly indexVersion: typeof INDEX_CONTRACT_VERSION;
  readonly project: { readonly root: string; readonly languages: readonly string[] };
  readonly indexer: {
    readonly kind: IndexerKind;
    readonly provider?: string;
    readonly model?: string;
  };
  readonly coverage: { readonly scopes: readonly IndexCoverageScope[] };
  readonly entries: readonly IndexEntry[];
  readonly diagnostics: readonly IndexDiagnostic[];
}

export interface IndexValidationError {
  readonly path: string;
  readonly message: string;
}

const ENTRY_TYPES: readonly string[] = [
  'file', 'module', 'symbol', 'import', 'reference',
  'route', 'model', 'subsystem', 'service', 'relationship',
];
const RELATIONSHIP_TYPES: readonly string[] = [
  'route_handler', 'calls', 'uses_model', 'orm_relationship',
  'imports', 'uses', 'reads', 'writes',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkSource(value: unknown, path: string, errors: IndexValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({ path, message: 'must be an object' });
    return;
  }
  if (typeof value.path !== 'string' || value.path.length === 0) {
    errors.push({ path: `${path}.path`, message: 'must be a non-empty string' });
  }
  if (typeof value.startLine !== 'number' || !Number.isInteger(value.startLine) || value.startLine < 1) {
    errors.push({ path: `${path}.startLine`, message: 'must be an integer >= 1' });
  }
  if (value.endLine !== undefined && (typeof value.endLine !== 'number' || !Number.isInteger(value.endLine) || value.endLine < 1)) {
    errors.push({ path: `${path}.endLine`, message: 'must be an integer >= 1' });
  }
}

function checkDiagnostic(value: unknown, path: string, errors: IndexValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({ path, message: 'must be an object' });
    return;
  }
  if (!['info', 'warning', 'error'].includes(value.severity as string)) {
    errors.push({ path: `${path}.severity`, message: 'must be info|warning|error' });
  }
  if (typeof value.code !== 'string' || value.code.length === 0) {
    errors.push({ path: `${path}.code`, message: 'must be a non-empty string' });
  }
  if (typeof value.message !== 'string') {
    errors.push({ path: `${path}.message`, message: 'must be a string' });
  }
  if (value.source !== undefined) {
    checkSource(value.source, `${path}.source`, errors);
  }
}

function checkEvidence(value: unknown, path: string, errors: IndexValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({ path, message: 'must be an object' });
    return;
  }
  if (typeof value.kind !== 'string' || value.kind.length === 0) {
    errors.push({ path: `${path}.kind`, message: 'must be a non-empty string' });
  }
  if (typeof value.description !== 'string') {
    errors.push({ path: `${path}.description`, message: 'must be a string' });
  }
  if (value.source !== undefined) {
    checkSource(value.source, `${path}.source`, errors);
  }
  if (value.metadata !== undefined) {
    if (!isRecord(value.metadata)) {
      errors.push({ path: `${path}.metadata`, message: 'must be an object' });
    } else {
      if (value.metadata.model !== undefined && typeof value.metadata.model !== 'string') {
        errors.push({ path: `${path}.metadata.model`, message: 'must be a string' });
      }
      if (value.metadata.sourceLocationValidated !== undefined && typeof value.metadata.sourceLocationValidated !== 'boolean') {
        errors.push({ path: `${path}.metadata.sourceLocationValidated`, message: 'must be a boolean' });
      }
    }
  }
}

function checkEntry(value: unknown, path: string, errors: IndexValidationError[]): void {
  if (!isRecord(value)) {
    errors.push({ path, message: 'must be an object' });
    return;
  }
  if (typeof value.id !== 'string' || value.id.length === 0) {
    errors.push({ path: `${path}.id`, message: 'must be a non-empty string' });
  }
  if (!['fact', 'interpretation'].includes(value.kind as string)) {
    errors.push({ path: `${path}.kind`, message: 'must be fact|interpretation' });
  }
  if (!ENTRY_TYPES.includes(value.entryType as string)) {
    errors.push({ path: `${path}.entryType`, message: `must be one of ${ENTRY_TYPES.join(', ')}` });
  }
  if (typeof value.label !== 'string') {
    errors.push({ path: `${path}.label`, message: 'must be a string' });
  }
  if (value.source !== undefined) {
    checkSource(value.source, `${path}.source`, errors);
  }
  if (!Array.isArray(value.evidence)) {
    errors.push({ path: `${path}.evidence`, message: 'must be an array' });
  } else {
    value.evidence.forEach((item, i) => checkEvidence(item, `${path}.evidence[${i}]`, errors));
  }
  if (!['deterministic', 'ai', 'hybrid'].includes(value.provenance as string)) {
    errors.push({ path: `${path}.provenance`, message: 'must be deterministic|ai|hybrid' });
  }
  if (!['confirmed', 'inferred', 'unresolved'].includes(value.status as string)) {
    errors.push({ path: `${path}.status`, message: 'must be confirmed|inferred|unresolved' });
  }
  if (value.confidence !== undefined && (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1)) {
    errors.push({ path: `${path}.confidence`, message: 'must be a number between 0 and 1' });
  }
  if (value.parentId !== undefined && typeof value.parentId !== 'string') {
    errors.push({ path: `${path}.parentId`, message: 'must be a string' });
  }
  if (value.entryType === 'relationship') {
    const details = value.details;
    if (!isRecord(details)) {
      errors.push({ path: `${path}.details`, message: 'relationship entries require details' });
    } else {
      if (!RELATIONSHIP_TYPES.includes(details.relationshipType as string)) {
        errors.push({ path: `${path}.details.relationshipType`, message: `must be one of ${RELATIONSHIP_TYPES.join(', ')}` });
      }
      if (typeof details.sourceEntryId !== 'string' || details.sourceEntryId.length === 0) {
        errors.push({ path: `${path}.details.sourceEntryId`, message: 'must be a non-empty string' });
      }
      if (!(typeof details.targetEntryId === 'string' || details.targetEntryId === null)) {
        errors.push({ path: `${path}.details.targetEntryId`, message: 'must be a string or null' });
      }
      if (!['resolved', 'unresolved'].includes(details.resolutionStatus as string)) {
        errors.push({ path: `${path}.details.resolutionStatus`, message: 'must be resolved|unresolved' });
      }
    }
  }
}

/**
 * Structural validation of an Index Contract v1 document.
 * Returns a list of errors; an empty list means the document is valid.
 * Does not verify source locations or semantic correctness.
 */
export function validateIndexDocument(value: unknown): IndexValidationError[] {
  const errors: IndexValidationError[] = [];
  if (!isRecord(value)) {
    return [{ path: '$', message: 'must be an object' }];
  }
  if (value.indexVersion !== INDEX_CONTRACT_VERSION) {
    errors.push({ path: '$.indexVersion', message: `must be "${INDEX_CONTRACT_VERSION}"` });
  }
  if (!isRecord(value.project)) {
    errors.push({ path: '$.project', message: 'must be an object' });
  } else {
    if (typeof value.project.root !== 'string' || value.project.root.length === 0) {
      errors.push({ path: '$.project.root', message: 'must be a non-empty string' });
    }
    if (!Array.isArray(value.project.languages) || value.project.languages.length === 0) {
      errors.push({ path: '$.project.languages', message: 'must be a non-empty array' });
    }
  }
  if (!isRecord(value.indexer)) {
    errors.push({ path: '$.indexer', message: 'must be an object' });
  } else if (!['ai', 'deterministic', 'hybrid'].includes(value.indexer.kind as string)) {
    errors.push({ path: '$.indexer.kind', message: 'must be ai|deterministic|hybrid' });
  }
  if (!isRecord(value.coverage)) {
    errors.push({ path: '$.coverage', message: 'must be an object' });
  } else if (!Array.isArray(value.coverage.scopes)) {
    errors.push({ path: '$.coverage.scopes', message: 'must be an array' });
  } else {
    value.coverage.scopes.forEach((scope, i) => {
      const path = `$.coverage.scopes[${i}]`;
      if (!isRecord(scope)) {
        errors.push({ path, message: 'must be an object' });
        return;
      }
      if (typeof scope.id !== 'string' || scope.id.length === 0) {
        errors.push({ path: `${path}.id`, message: 'must be a non-empty string' });
      }
      if (typeof scope.scope !== 'string' || scope.scope.length === 0) {
        errors.push({ path: `${path}.scope`, message: 'must be a non-empty string' });
      }
      if (!['complete', 'partial', 'pending', 'failed'].includes(scope.status as string)) {
        errors.push({ path: `${path}.status`, message: 'must be complete|partial|pending|failed' });
      }
      if (scope.diagnostics !== undefined) {
        if (!Array.isArray(scope.diagnostics)) {
          errors.push({ path: `${path}.diagnostics`, message: 'must be an array' });
        } else {
          scope.diagnostics.forEach((d, j) => checkDiagnostic(d, `${path}.diagnostics[${j}]`, errors));
        }
      }
    });
  }
  if (!Array.isArray(value.entries)) {
    errors.push({ path: '$.entries', message: 'must be an array' });
  } else {
    const seen = new Set<string>();
    const byId = new Map<string, Record<string, unknown>>();
    value.entries.forEach((entry, i) => {
      checkEntry(entry, `$.entries[${i}]`, errors);
      if (isRecord(entry) && typeof entry.id === 'string') {
        if (seen.has(entry.id)) {
          errors.push({ path: `$.entries[${i}].id`, message: `duplicate id "${entry.id}"` });
        }
        seen.add(entry.id);
        if (!byId.has(entry.id)) {
          byId.set(entry.id, entry);
        }
      }
    });
    // Cross-reference integrity (document structure only; never upgrades status).
    value.entries.forEach((entry, i) => {
      if (!isRecord(entry)) {
        return;
      }
      const path = `$.entries[${i}]`;
      if (typeof entry.parentId === 'string' && !byId.has(entry.parentId)) {
        errors.push({ path: `${path}.parentId`, message: `references missing entry "${entry.parentId}"` });
      }
      if (entry.entryType === 'relationship' && isRecord(entry.details)) {
        const details = entry.details;
        const sourceId = details.sourceEntryId;
        const targetId = details.targetEntryId;
        const resolution = details.resolutionStatus;
        if (typeof sourceId === 'string' && sourceId.length > 0) {
          const source = byId.get(sourceId);
          if (!source) {
            errors.push({ path: `${path}.details.sourceEntryId`, message: `references missing entry "${sourceId}"` });
          } else if (source.entryType === 'relationship') {
            errors.push({ path: `${path}.details.sourceEntryId`, message: 'relationship endpoints must not reference other relationships' });
          }
        }
        if (resolution === 'resolved') {
          if (typeof targetId !== 'string' || targetId.length === 0) {
            errors.push({ path: `${path}.details.targetEntryId`, message: 'resolved relationships require a non-null targetEntryId' });
          } else {
            const target = byId.get(targetId);
            if (!target) {
              errors.push({ path: `${path}.details.targetEntryId`, message: `references missing entry "${targetId}"` });
            } else if (target.entryType === 'relationship') {
              errors.push({ path: `${path}.details.targetEntryId`, message: 'relationship endpoints must not reference other relationships' });
            }
          }
        } else if (resolution === 'unresolved') {
          if (targetId !== null) {
            errors.push({ path: `${path}.details.targetEntryId`, message: 'unresolved relationships require targetEntryId: null' });
          }
        }
      }
    });
  }
  if (!Array.isArray(value.diagnostics)) {
    errors.push({ path: '$.diagnostics', message: 'must be an array' });
  } else {
    value.diagnostics.forEach((d, i) => checkDiagnostic(d, `$.diagnostics[${i}]`, errors));
  }
  return errors;
}

/** Type guard: true when the value is a structurally valid Index v1 document. */
export function isIndexDocumentV1(value: unknown): value is IndexDocumentV1 {
  return validateIndexDocument(value).length === 0;
}
