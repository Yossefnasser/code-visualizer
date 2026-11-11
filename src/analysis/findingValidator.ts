/**
 * FindingValidator - two-tier validation over Index Contract v1 documents.
 *
 * Tier 1 (source-location validation): for every AI/hybrid entry that cites a
 * source location, verify against the deterministic index that the file exists
 * and (for symbol-level entries) that a symbol span overlaps the cited lines.
 * Every AI evidence record with its own citation gets
 * `metadata.sourceLocationValidated: true|false`. An entry whose primary
 * citation cannot be verified is returned for repair (one bounded round,
 * optional), then dropped with a diagnostic.
 *
 * Tier 2 (semantic validation): the relationship itself must be verifiable
 * against deterministic index facts before `confirmed` is allowed:
 * - `route_handler`    -> endpoint + handler binding in `index.routeBindings`
 * - `orm_relationship` -> declaration in `index.ormRelationships`
 * - `calls`            -> resolved reference in `index.references`
 * - `imports`          -> module import in `index.files[].imports`
 * - `uses_model`, `uses`, `reads`, `writes` are never verifiable.
 * A `confirmed` claim that cannot be verified is demoted to `inferred` with a
 * diagnostic; an `inferred` relationship of a verifiable type that IS
 * deterministically verified is promoted to `confirmed`. Validating a source
 * location never proves a semantic relationship.
 *
 * The input must be a structurally valid Index Contract v1 document; the input
 * is never mutated, and every returned document is structurally valid: entries
 * referencing a dropped entry are dropped as well (never fabricated).
 *
 * Design references:
 * - `docs/INDEX_TO_GRAPH_MAPPING.md` section 5
 * - `docs/ARCHITECTURE_DATA_MODEL.md` sections 16.4-16.6
 */

import {
  IndexDiagnostic,
  IndexDocumentV1,
  IndexEntry,
} from './indexContract';
import {
  CallReference,
  IndexDocument,
  OrmRelationshipHint,
  RouteBinding,
} from './indexBackend';

/**
 * Deterministic facts the validator needs. `IndexServiceInterface` satisfies
 * this structurally (its `getIndex()` returns the complete, unfiltered sidecar
 * index document), so services can be passed directly.
 */
export interface FindingValidatorIndexAccess {
  getIndex(): IndexDocument;
}

/** Options for a validation run. */
export interface FindingValidatorOptions {
  /**
   * Optional ONE repair round-trip: receives the entries whose primary citation
   * could not be verified and returns re-cited copies (same ids). Repaired
   * copies are checked exactly once more; anything still unverifiable is
   * dropped. A repair function must not add entries, alter entry ids, or
   * change statuses - violations are ignored. Without a repair function,
   * unverifiable entries are dropped directly (offline usage, fixtures).
   * (A model-backed repair function arrives with AnalysisController.)
   */
  readonly repair?: (entries: readonly IndexEntry[]) => readonly IndexEntry[];
}

export interface FindingValidatorResult {
  /** The validated document (statuses adjusted, unverifiable entries dropped). */
  readonly document: IndexDocumentV1;
  /** IDs of entries dropped (directly, or still unverifiable after repair). */
  readonly droppedEntryIds: readonly string[];
  /** IDs accepted with their repair copy in place. */
  readonly repairedEntryIds: readonly string[];
  /** IDs demoted from `confirmed` to `inferred` in tier 2. */
  readonly demotedEntryIds: readonly string[];
  /** AI relationships promoted from `inferred` to `confirmed` in tier 2. */
  readonly promotedEntryIds: readonly string[];
  /** Validation diagnostics, in document order (the document's own come first). */
  readonly diagnostics: readonly IndexDiagnostic[];
}

/** Entry types whose claim is symbol-level ("symbol exists at or near"). */
const SYMBOL_LEVEL_ENTRY_TYPES: ReadonlySet<string> = new Set([
  'symbol',
  'service',
  'route',
  'model',
  'reference',
]);

/** Relationship types that can, in principle, be deterministically verified. */
const VERIFIABLE_RELATIONSHIP_TYPES: ReadonlySet<string> = new Set([
  'route_handler',
  'orm_relationship',
  'calls',
  'imports',
]);

// ---------------------------------------------------------------------------
// Index snapshot
// ---------------------------------------------------------------------------

interface SymbolSpan {
  startLine: number;
  endLine: number;
}

interface IndexSnapshot {
  readonly filePaths: ReadonlySet<string>;
  readonly symbolsByPath: ReadonlyMap<string, readonly SymbolSpan[]>;
  readonly routeBindings: readonly RouteBinding[];
  readonly ormRelationships: readonly OrmRelationshipHint[];
  readonly references: readonly CallReference[];
  readonly importedModulesByModule: ReadonlyMap<string, ReadonlySet<string>>;
}

function snapshot(doc: IndexDocument): IndexSnapshot {
  const filePaths = new Set<string>();
  const symbolsByPath = new Map<string, SymbolSpan[]>();
  const importedModulesByModule = new Map<string, Set<string>>();
  for (const file of doc.files) {
    filePaths.add(file.path);
    symbolsByPath.set(
      file.path,
      file.symbols.map((symbol) => ({ startLine: symbol.startLine, endLine: symbol.endLine }))
    );
    importedModulesByModule.set(file.module, new Set(file.imports.map((imp) => imp.module)));
  }
  return {
    filePaths,
    symbolsByPath,
    routeBindings: doc.routeBindings,
    ormRelationships: doc.ormRelationships,
    references: doc.references,
    importedModulesByModule,
  };
}

// ---------------------------------------------------------------------------
// ID parsing (Index Contract v1 / sidecar identity schemes)
// ---------------------------------------------------------------------------

/** Parse `{prefix}:{module}:{qualname}` ids (function/class/database_model/symbol). */
function parseModuleQualname(
  id: string,
  prefixes: readonly string[]
): { module: string; qualname: string } | undefined {
  for (const prefix of prefixes) {
    if (!id.startsWith(`${prefix}:`)) {
      continue;
    }
    const rest = id.slice(prefix.length + 1);
    const colon = rest.indexOf(':');
    if (colon > 0 && colon < rest.length - 1) {
      return { module: rest.slice(0, colon), qualname: rest.slice(colon + 1) };
    }
  }
  return undefined;
}

/** Parse `endpoint:{module}:{METHOD}:{path}` (sidecar endpoint id). */
function parseSidecarEndpointId(
  id: string
): { module: string; method: string; path: string } | undefined {
  if (!id.startsWith('endpoint:')) {
    return undefined;
  }
  const rest = id.slice('endpoint:'.length);
  const first = rest.indexOf(':');
  const second = first >= 0 ? rest.indexOf(':', first + 1) : -1;
  if (first > 0 && second > first) {
    return {
      module: rest.slice(0, first),
      method: rest.slice(first + 1, second),
      path: rest.slice(second + 1),
    };
  }
  return undefined;
}

/**
 * Parse a route id into (sidecar endpoint id, handler module, qualname).
 * Accepts the pure sidecar form `endpoint:{module}:{METHOD}:{path}` (no
 * handler part) and the finding form
 * `route:endpoint:{module}:{METHOD}:{path}->function:{module}:{qualname}`.
 */
function parseRouteId(
  id: string
): { endpointId: string; handlerModule?: string; handlerQualname?: string } | undefined {
  const arrow = id.indexOf('->');
  if (arrow < 0) {
    const endpoint = parseSidecarEndpointId(id);
    return endpoint ? { endpointId: id } : undefined;
  }
  const endpointPart = id.slice(0, arrow);
  const functionPart = id.slice(arrow + 2);
  if (!endpointPart.startsWith('route:endpoint:')) {
    return undefined;
  }
  const endpointId = `endpoint:${endpointPart.slice('route:endpoint:'.length)}`;
  const endpoint = parseSidecarEndpointId(endpointId);
  const handler = parseModuleQualname(functionPart, ['function']);
  if (!endpoint || !handler) {
    return undefined;
  }
  return {
    endpointId,
    handlerModule: handler.module,
    handlerQualname: handler.qualname,
  };
}

// ---------------------------------------------------------------------------
// Tier 1: source-location verification
// ---------------------------------------------------------------------------

function spansOverlap(span: SymbolSpan, startLine: number, endLine: number): boolean {
  return span.startLine <= endLine && span.endLine >= startLine;
}

/**
 * True when a cited location verifies: the file must exist in the index, and
 * for symbol-level entries a symbol span must overlap the cited range. Files
 * with no indexed symbols pass on path existence alone.
 */
function isLocationVerified(
  snap: IndexSnapshot,
  path: string,
  startLine: number,
  endLine: number,
  symbolLevel: boolean
): boolean {
  if (!snap.filePaths.has(path)) {
    return false;
  }
  if (!symbolLevel) {
    return true;
  }
  const symbols = snap.symbolsByPath.get(path) ?? [];
  if (symbols.length === 0) {
    return true;
  }
  return symbols.some((span) => spansOverlap(span, startLine, endLine));
}

function locationOf(source: { path: string; startLine: number; endLine?: number }): {
  path: string;
  startLine: number;
  endLine: number;
} {
  return { path: source.path, startLine: source.startLine, endLine: source.endLine ?? source.startLine };
}

function describeLocation(location: { path: string; startLine: number; endLine: number }): string {
  const range = location.endLine !== location.startLine ? `-${location.endLine}` : '';
  return `${location.path}:${location.startLine}${range}`;
}

interface Tier1Outcome {
  readonly ok: boolean;
  readonly reason: string;
}

function checkTier1(entry: IndexEntry, snap: IndexSnapshot): Tier1Outcome {
  if (entry.provenance === 'deterministic') {
    // Index facts come from the same index we verify against; mismatches are
    // reported as warnings, never as drops.
    if (entry.source && !snap.filePaths.has(entry.source.path)) {
      return { ok: true, reason: 'cites a path missing from the current index' };
    }
    return { ok: true, reason: '' };
  }
  if (!entry.source) {
    return { ok: true, reason: '' }; // No claim made - nothing to verify.
  }
  const location = locationOf(entry.source);
  const symbolLevel = SYMBOL_LEVEL_ENTRY_TYPES.has(entry.entryType);
  if (isLocationVerified(snap, location.path, location.startLine, location.endLine, symbolLevel)) {
    return { ok: true, reason: '' };
  }
  return {
    ok: false,
    reason: `cited source location ${describeLocation(location)} is not verifiable against the index`,
  };
}

/** Set `metadata.sourceLocationValidated` on every AI evidence record that cites a location. */
function annotateEvidence(entry: IndexEntry, snap: IndexSnapshot): IndexEntry {
  if (entry.provenance === 'deterministic') {
    return entry;
  }
  const symbolLevel = SYMBOL_LEVEL_ENTRY_TYPES.has(entry.entryType);
  let changed = false;
  const evidence = entry.evidence.map((item) => {
    if (!item.source) {
      return item; // No claim made: no flag is set, none is removed.
    }
    const location = locationOf(item.source);
    const verified = isLocationVerified(snap, location.path, location.startLine, location.endLine, symbolLevel);
    if (item.metadata?.sourceLocationValidated === verified) {
      return item;
    }
    changed = true;
    return { ...item, metadata: { ...item.metadata, sourceLocationValidated: verified } };
  });
  return changed ? { ...entry, evidence } : entry;
}

// ---------------------------------------------------------------------------
// Tier 2: semantic verification of relationship claims
// ---------------------------------------------------------------------------

interface VerificationOutcome {
  readonly verified: boolean;
  /** Why verification failed (only meaningful when verified is false). */
  readonly reason: string;
}

function verifyRelationship(entry: IndexEntry, snap: IndexSnapshot): VerificationOutcome {
  const details = entry.details as
    | { relationshipType?: string; sourceEntryId?: string; targetEntryId?: string | null }
    | undefined;
  if (!details?.relationshipType || !details.sourceEntryId) {
    return { verified: false, reason: 'relationship entry lacks details' };
  }
  const type: string = details.relationshipType;
  const targetId = details.targetEntryId;

  if (type === 'calls') {
    const source = parseModuleQualname(details.sourceEntryId, ['function', 'class']);
    const target = targetId ? parseModuleQualname(targetId, ['function', 'class']) : undefined;
    if (!source || !target) {
      return { verified: false, reason: 'endpoints are not parseable to module+qualname' };
    }
    const verified = snap.references.some(
      (ref) =>
        ref.sourceModule === source.module &&
        ref.sourceQualname === source.qualname &&
        ref.targetModule === target.module &&
        ref.targetQualname === target.qualname
    );
    return { verified, reason: 'no matching resolved reference in index.references' };
  }

  if (type === 'imports') {
    const stripModule = (id: string): string => (id.startsWith('module:') ? id.slice('module:'.length) : '');
    const sourceModule = stripModule(details.sourceEntryId);
    const targetModule = targetId ? stripModule(targetId) : '';
    if (!sourceModule || !targetModule) {
      return { verified: false, reason: 'endpoints are not `module:{module}` ids' };
    }
    const verified = snap.importedModulesByModule.get(sourceModule)?.has(targetModule) ?? false;
    return { verified, reason: 'no matching import in index.files[].imports' };
  }

  if (type === 'route_handler') {
    const source = parseRouteId(details.sourceEntryId);
    const handler = targetId ? parseModuleQualname(targetId, ['function']) : undefined;
    if (!source || !handler) {
      return { verified: false, reason: 'endpoints do not follow the documented route/function id scheme' };
    }
    const verified = snap.routeBindings.some(
      (binding) =>
        binding.endpointId === source.endpointId &&
        binding.handlerModule === handler.module &&
        binding.handlerQualname === handler.qualname &&
        // A finding-form source id claims a handler itself; it must agree
        // with the binding, otherwise the route claim is internally
        // inconsistent and stays unverifiable.
        (source.handlerQualname === undefined ||
          (source.handlerModule === binding.handlerModule && source.handlerQualname === binding.handlerQualname))
    );
    return { verified, reason: 'no matching route binding in index.routeBindings' };
  }

  if (type === 'orm_relationship') {
    const modelPrefixes = ['database_model', 'class'];
    const source = parseModuleQualname(details.sourceEntryId, modelPrefixes);
    const target = targetId ? parseModuleQualname(targetId, modelPrefixes) : undefined;
    if (!source || !target) {
      return { verified: false, reason: 'endpoints are not `database_model:{module}:{qualname}` ids' };
    }
    const verified = snap.ormRelationships.some((rel) => {
      const relSource = parseModuleQualname(rel.sourceId, modelPrefixes);
      const relTarget = parseModuleQualname(rel.targetId, modelPrefixes);
      return (
        relSource?.module === source.module &&
        relSource?.qualname === source.qualname &&
        relTarget?.module === target.module &&
        relTarget?.qualname === target.qualname
      );
    });
    return { verified, reason: 'no matching ORM declaration in index.ormRelationships' };
  }

  return { verified: false, reason: `relationship type "${type}" is never deterministically verifiable` };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function diagnostic(
  severity: IndexDiagnostic['severity'],
  code: string,
  message: string,
  entry?: IndexEntry
): IndexDiagnostic {
  if (!entry || (!entry.source && !entry.evidence.some((item) => item.source))) {
    return { severity, code, message };
  }
  const firstSource = entry.source ?? entry.evidence.find((item) => item.source)?.source;
  return {
    severity,
    code,
    message,
    ...(firstSource
      ? { source: { path: firstSource.path, startLine: firstSource.startLine, ...(firstSource.endLine !== undefined ? { endLine: firstSource.endLine } : {}) } }
      : {}),
  };
}

/**
 * Validate an Index Contract v1 document against deterministic index facts.
 * The input document must be structurally valid (throws otherwise); the input
 * is never mutated, and the returned document is structurally valid too.
 */
export function validateFindings(
  document: IndexDocumentV1,
  index: FindingValidatorIndexAccess,
  options?: FindingValidatorOptions
): FindingValidatorResult {
  const snap = snapshot(index.getIndex());
  const diagnostics: IndexDiagnostic[] = [];
  const droppedEntryIds: string[] = [];
  const repairedEntryIds: string[] = [];
  const demotedEntryIds: string[] = [];
  const promotedEntryIds: string[] = [];

  // ---- Tier 1: primary-citation verification (+ optional repair round) ----
  const tier1Failures = document.entries.filter((entry) => !checkTier1(entry, snap).ok);
  const workingById = new Map<string, IndexEntry>(document.entries.map((entry) => [entry.id, entry]));
  if (options?.repair && tier1Failures.length > 0) {
    const failedIds = new Set(tier1Failures.map((entry) => entry.id));
    for (const copy of options.repair(tier1Failures)) {
      // Repairs may only re-cite existing entries; never add or upgrade.
      if (!failedIds.has(copy.id)) {
        continue;
      }
      if (checkTier1(copy, snap).ok) {
        workingById.set(copy.id, copy);
      }
    }
  }

  const survivors: IndexEntry[] = [];
  for (const original of document.entries) {
    const working = workingById.get(original.id) ?? original;
    const outcome = checkTier1(working, snap);
    if (!outcome.ok) {
      droppedEntryIds.push(original.id);
      const repairAttempted = Boolean(options?.repair);
      diagnostics.push(
        diagnostic(
          'warning',
          'source_location_invalid',
          `Entry "${original.id}" was dropped: ${outcome.reason}` +
            (repairAttempted ? ' (still unverifiable after the repair round).' : '.'),
          original
        )
      );
      continue;
    }
    if (working !== original) {
      repairedEntryIds.push(original.id);
      diagnostics.push(
        diagnostic(
          'info',
          'source_location_repaired',
          `Entry "${original.id}" was repaired and its citation now verifies against the index.`,
          working
        )
      );
    }
    if (original.provenance === 'deterministic' && original.source && !snap.filePaths.has(original.source.path)) {
      diagnostics.push(
        diagnostic(
          'warning',
          'fact_location_mismatch',
          `Deterministic fact entry "${original.id}" cites a path missing from the current index.`,
          original
        )
      );
    }
    survivors.push(annotateEvidence(working, snap));
  }

  // ---- Tier 2: semantic gating of `confirmed` / deterministic promotion ----
  const tier2: IndexEntry[] = [];
  for (const entry of survivors) {
    if (entry.status !== 'confirmed' && !(entry.entryType === 'relationship' && entry.status === 'inferred')) {
      tier2.push(entry);
      continue;
    }
    if (entry.entryType !== 'relationship') {
      if (entry.status === 'confirmed' && entry.kind === 'interpretation' && entry.provenance !== 'deterministic') {
        demotedEntryIds.push(entry.id);
        diagnostics.push(
          diagnostic(
            'warning',
            'confirmed_requires_deterministic_verification',
            `Entry "${entry.id}" claimed confirmed without a deterministically verifiable relationship. Downgraded to inferred.`,
            entry
          )
        );
        tier2.push({ ...entry, status: 'inferred' as const });
      } else {
        tier2.push(entry);
      }
      continue;
    }
    const type = (entry.details as { relationshipType?: string } | undefined)?.relationshipType ?? '';
    if (!VERIFIABLE_RELATIONSHIP_TYPES.has(type)) {
      if (entry.status === 'confirmed') {
        demotedEntryIds.push(entry.id);
        diagnostics.push(
          diagnostic(
            'warning',
            'confirmed_not_verifiable',
            `Relationship "${entry.id}" is of type "${type}", which is never deterministically verifiable. Downgraded to inferred.`,
            entry
          )
        );
        tier2.push({ ...entry, status: 'inferred' as const });
      } else {
        tier2.push(entry); // inferred, unverifiable type: stays inferred.
      }
      continue;
    }
    const outcome = verifyRelationship(entry, snap);
    if (outcome.verified) {
      if (entry.status !== 'confirmed') {
        promotedEntryIds.push(entry.id);
        diagnostics.push(
          diagnostic(
            'info',
            'relationship_verified',
            `Relationship "${entry.id}" was deterministically verified and promoted to confirmed.`,
            entry
          )
        );
        tier2.push({ ...entry, status: 'confirmed' as const });
      } else {
        tier2.push(entry);
      }
      continue;
    }
    if (entry.status === 'confirmed') {
      demotedEntryIds.push(entry.id);
      diagnostics.push(
        diagnostic(
          'warning',
          'confirmed_not_verifiable',
          `Relationship "${entry.id}" claimed confirmed but is not deterministically verifiable (${outcome.reason}). Downgraded to inferred.`,
          entry
        )
      );
      tier2.push({ ...entry, status: 'inferred' as const });
    } else {
      tier2.push(entry); // inferred, unverified: stays inferred.
    }
  }

  // ---- Cascade: drop entries that reference dropped entries ----
  const dropped = new Set(droppedEntryIds);
  let candidates = tier2.filter((entry) => !dropped.has(entry.id));
  let changed = true;
  while (changed) {
    changed = false;
    const keep: IndexEntry[] = [];
    for (const entry of candidates) {
      const parentDependency = entry.parentId !== undefined && dropped.has(entry.parentId as string);
      let endpointDependency = false;
      if (entry.entryType === 'relationship') {
        const details = entry.details as { sourceEntryId?: string; targetEntryId?: string | null } | undefined;
        endpointDependency =
          (details?.sourceEntryId !== undefined && dropped.has(details.sourceEntryId as string)) ||
          (typeof details?.targetEntryId === 'string' && dropped.has(details.targetEntryId));
      }
      if (parentDependency || endpointDependency) {
        dropped.add(entry.id);
        droppedEntryIds.push(entry.id);
        diagnostics.push({
          severity: 'warning',
          code: 'dangling_reference',
          message: `Entry "${entry.id}" was dropped because it references a dropped entry.`,
        });
        changed = true;
        continue;
      }
      keep.push(entry);
    }
    candidates = keep;
  }

  return {
    document: {
      ...document,
      entries: candidates,
      diagnostics: [...document.diagnostics, ...diagnostics],
    },
    droppedEntryIds,
    repairedEntryIds,
    demotedEntryIds,
    promotedEntryIds,
    diagnostics: [...document.diagnostics, ...diagnostics],
  };
}
