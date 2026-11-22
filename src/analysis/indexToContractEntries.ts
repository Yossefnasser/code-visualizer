/**
 * Deterministic index (v1.1) → Index Contract v1 fact entries.
 *
 * Pure translation: no AI, no I/O, no VS Code APIs. The contract document is
 * where deterministic facts and AI interpretations meet
 * (`docs/ARCHITECTURE.md`, two-tier evidence validation), so every entry
 * produced here is `kind: 'fact'`, `provenance: 'deterministic'`,
 * `status: 'confirmed'`.
 *
 * Why this module exists: `FindingValidator` verifies AI claims directly
 * against the backend index, but `mapIndexToGraph` only reads the contract
 * document. Without fact entries the graph would contain AI claims and nothing
 * else — no files, symbols, routes or deterministic edges.
 *
 * Mapping rules: `docs/INDEX_TO_GRAPH_MAPPING.md` §2.1–2.3 (nodes) and
 * §3.1–3.4 (edges). Relationship entries are emitted only when **both**
 * endpoints exist as entries in the same document: the Index Contract requires
 * every relationship endpoint to resolve, and the mapper drops edges whose
 * nodes are missing. Unresolvable ends are reported as diagnostics, never
 * fabricated.
 */

import {
  EndpointHint,
  FileDoc,
  IndexDocument,
  ModelHint,
  SymbolRef,
} from './indexBackend';
import {
  IndexDiagnostic,
  IndexEntry,
  IndexRelationshipType,
  IndexSourceLocation,
} from './indexContract';

export interface ContractEntriesOptions {
  /**
   * Materialize `imports` relationship entries (`module:A → module:B`).
   * Defaults to `false`: imports are confirmed structural facts, but
   * `INDEX_TO_GRAPH_MAPPING.md` §3.4 hides them in the default graph view, and
   * the mapper has no view filter yet, so enabling them floods the first real
   * graph. Flip it on when drill-down filtering lands.
   */
  readonly includeImports?: boolean;
}

export interface ContractEntriesResult {
  readonly entries: readonly IndexEntry[];
  readonly diagnostics: readonly IndexDiagnostic[];
}

/** Deterministic id for a module node (§2.1). */
function moduleId(module: string): string {
  return `module:${module}`;
}

/** Deterministic id for a route handler target (§3.1). */
function functionId(module: string, qualname: string): string {
  return `function:${module}:${qualname}`;
}

function moduleEntry(file: FileDoc): IndexEntry {
  return {
    id: moduleId(file.module),
    kind: 'fact',
    entryType: 'module',
    label: file.module,
    details: {
      path: file.path,
      lineCount: file.lineCount,
      frameworks: [...file.frameworks],
      language: file.language,
    },
    source: { path: file.path, startLine: 1 },
    evidence: [
      {
        kind: 'file_observed',
        description: `File "${file.path}" was discovered by the deterministic indexer (${file.lineCount} lines).`,
      },
    ],
    provenance: 'deterministic',
    status: 'confirmed',
  };
}

function symbolEntry(file: FileDoc, symbol: SymbolRef): IndexEntry {
  return {
    id: symbol.id,
    kind: 'fact',
    entryType: 'symbol',
    label: symbol.name,
    details: {
      kind: symbol.kind,
      module: file.module,
      qualname: symbol.qualname,
      className: symbol.className,
    },
    source: { path: file.path, startLine: symbol.startLine, endLine: symbol.endLine },
    evidence: [
      {
        kind: symbol.kind === 'class' ? 'class_declaration' : 'function_declaration',
        description: `${symbol.kind} "${symbol.qualname}" was extracted by the deterministic indexer.`,
      },
    ],
    provenance: 'deterministic',
    status: 'confirmed',
  };
}

function routeEntry(endpoint: EndpointHint): IndexEntry {
  const methods = endpoint.methods.join(', ');
  const source: IndexSourceLocation | undefined =
    endpoint.line !== null ? { path: endpoint.sourcePath, startLine: endpoint.line } : undefined;
  return {
    id: endpoint.id,
    kind: 'fact',
    entryType: 'route',
    label: `${methods} ${endpoint.path}`,
    details: { module: endpoint.module, methods: [...endpoint.methods], path: endpoint.path },
    ...(source ? { source } : {}),
    evidence: [
      {
        kind: 'fastapi_route_decorator',
        description: `Route "${methods} ${endpoint.path}" was extracted from a framework decorator.`,
      },
    ],
    provenance: 'deterministic',
    status: 'confirmed',
  };
}

function modelEntry(model: ModelHint): IndexEntry {
  const source: IndexSourceLocation | undefined =
    model.startLine !== null
      ? {
          path: model.sourcePath,
          startLine: model.startLine,
          ...(model.endLine !== null ? { endLine: model.endLine } : {}),
        }
      : undefined;
  return {
    id: model.id,
    kind: 'fact',
    entryType: 'model',
    label: model.name,
    details: {
      module: model.module,
      table: model.table,
      fields: model.fields.map((field) => ({ ...field })),
    },
    ...(source ? { source } : {}),
    evidence: [
      {
        kind: 'orm_model_declaration',
        description: `Database model "${model.name}"${
          model.table ? ` (table "${model.table}")` : ''
        } was extracted from an ORM declaration.`,
      },
    ],
    provenance: 'deterministic',
    status: 'confirmed',
  };
}

interface FactRelationshipInput {
  readonly id: string;
  readonly label: string;
  readonly relationshipType: IndexRelationshipType;
  readonly sourceEntryId: string;
  readonly targetEntryId: string;
  readonly evidenceKind: string;
  readonly evidenceDescription: string;
  readonly source?: IndexSourceLocation;
  readonly extraDetails?: Record<string, unknown>;
}

function relationshipEntry(input: FactRelationshipInput): IndexEntry {
  return {
    id: input.id,
    kind: 'fact',
    entryType: 'relationship',
    label: input.label,
    details: {
      relationshipType: input.relationshipType,
      sourceEntryId: input.sourceEntryId,
      targetEntryId: input.targetEntryId,
      resolutionStatus: 'resolved',
      ...(input.extraDetails ?? {}),
    },
    ...(input.source ? { source: input.source } : {}),
    evidence: [{ kind: input.evidenceKind, description: input.evidenceDescription }],
    provenance: 'deterministic',
    status: 'confirmed',
  };
}

/**
 * Translate a deterministic index document into Index Contract v1 fact
 * entries. Order is stable: modules, symbols, routes, models, then
 * relationships (route bindings, ORM, call references, imports).
 */
export function toContractEntries(
  index: IndexDocument,
  options: ContractEntriesOptions = {}
): ContractEntriesResult {
  const includeImports = options.includeImports ?? false;
  const entries: IndexEntry[] = [];
  const diagnostics: IndexDiagnostic[] = [];
  const emitted = new Set<string>();
  const labels = new Map<string, string>();
  /** `${module}:${qualname}` → symbol entry id, used to resolve references. */
  const symbolIds = new Map<string, string>();
  /** module → file path (first file wins for duplicate module names). */
  const modulePaths = new Map<string, string>();

  const add = (entry: IndexEntry): boolean => {
    if (emitted.has(entry.id)) {
      diagnostics.push({
        severity: 'info',
        code: 'duplicate_fact_id',
        message: `Deterministic entry id "${entry.id}" was produced twice; the first one was kept.`,
      });
      return false;
    }
    entries.push(entry);
    emitted.add(entry.id);
    labels.set(entry.id, entry.label);
    return true;
  };

  const skipEdge = (kind: string, sourceId: string, targetId: string): void => {
    diagnostics.push({
      severity: 'info',
      code: 'fact_edge_skipped_missing_endpoint',
      message: `Deterministic ${kind} edge "${sourceId}" → "${targetId}" was skipped: an endpoint has no fact entry in this index, so the edge would dangle.`,
    });
  };

  // ---- Nodes: modules, symbols, routes, models ----
  for (const file of index.files) {
    const existingPath = modulePaths.get(file.module);
    if (existingPath !== undefined) {
      diagnostics.push({
        severity: 'info',
        code: 'duplicate_module_name',
        message: `Module "${file.module}" is produced by more than one file ("${existingPath}" and "${file.path}"); only the first module node was emitted.`,
      });
      continue;
    }
    modulePaths.set(file.module, file.path);
    add(moduleEntry(file));
  }

  for (const file of index.files) {
    for (const symbol of file.symbols) {
      if (add(symbolEntry(file, symbol))) {
        symbolIds.set(`${file.module}:${symbol.qualname}`, symbol.id);
      }
    }
  }

  for (const endpoint of index.endpoints) {
    add(routeEntry(endpoint));
  }

  for (const model of index.models) {
    add(modelEntry(model));
  }

  // ---- Edges: route bindings → route_handler (§3.1) ----
  for (const binding of index.routeBindings) {
    const handlerId = functionId(binding.handlerModule, binding.handlerQualname);
    if (!emitted.has(binding.endpointId) || !emitted.has(handlerId)) {
      skipEdge('route_handler', binding.endpointId, handlerId);
      continue;
    }
    add(
      relationshipEntry({
        id: `route:${binding.endpointId}->${handlerId}`,
        label: `${labels.get(binding.endpointId)} → ${labels.get(handlerId)}`,
        relationshipType: 'route_handler',
        sourceEntryId: binding.endpointId,
        targetEntryId: handlerId,
        evidenceKind: 'fastapi_route_decorator',
        evidenceDescription: `Framework decorator binds route "${binding.endpointId}" to "${handlerId}".`,
      })
    );
  }

  // ---- Edges: ORM relationships → orm_relationship (§3.2) ----
  for (const relationship of index.ormRelationships) {
    if (!emitted.has(relationship.sourceId) || !emitted.has(relationship.targetId)) {
      skipEdge('orm_relationship', relationship.sourceId, relationship.targetId);
      continue;
    }
    add(
      relationshipEntry({
        id: `orm:${relationship.sourceId}->${relationship.targetId}`,
        label: `${labels.get(relationship.sourceId)} → ${labels.get(relationship.targetId)}`,
        relationshipType: 'orm_relationship',
        sourceEntryId: relationship.sourceId,
        targetEntryId: relationship.targetId,
        evidenceKind: relationship.kind || 'orm_relationship',
        evidenceDescription: `ORM declaration "${relationship.kind}"${
          relationship.line !== null ? ` at line ${relationship.line}` : ''
        } relates "${relationship.sourceId}" to "${relationship.targetId}".`,
        ...(relationship.line !== null
          ? { extraDetails: { line: relationship.line } }
          : {}),
      })
    );
  }

  // ---- Edges: resolved call references → calls (§3.3) ----
  const callPairs = new Set<string>();
  for (const reference of index.references) {
    const sourceId = symbolIds.get(`${reference.sourceModule}:${reference.sourceQualname}`);
    const targetId = symbolIds.get(`${reference.targetModule}:${reference.targetQualname}`);
    if (sourceId === undefined || targetId === undefined) {
      skipEdge(
        'calls',
        functionId(reference.sourceModule, reference.sourceQualname),
        functionId(reference.targetModule, reference.targetQualname)
      );
      continue;
    }
    if (sourceId === targetId) {
      continue;
    }
    const pairKey = `${sourceId}->${targetId}`;
    if (callPairs.has(pairKey)) {
      continue; // Several call sites between the same symbols are one edge.
    }
    callPairs.add(pairKey);
    const path = modulePaths.get(reference.sourceModule);
    add(
      relationshipEntry({
        id: `call:${pairKey}`,
        label: `${labels.get(sourceId)} → ${labels.get(targetId)}`,
        relationshipType: 'calls',
        sourceEntryId: sourceId,
        targetEntryId: targetId,
        evidenceKind: 'function_call',
        evidenceDescription: `Resolved call "${reference.sourceModule}.${reference.sourceQualname}" → "${reference.targetModule}.${reference.targetQualname}" at line ${reference.line}.`,
        ...(path !== undefined ? { source: { path, startLine: reference.line } } : {}),
      })
    );
  }

  // ---- Edges: imports → imports (§3.4, opt-in) ----
  if (includeImports) {
    for (const file of index.files) {
      const sourceId = moduleId(file.module);
      if (!emitted.has(sourceId)) {
        continue;
      }
      for (const imported of file.imports) {
        const targetId = moduleId(imported.module);
        if (sourceId === targetId || !emitted.has(targetId)) {
          continue; // External or self imports produce no edge.
        }
        add(
          relationshipEntry({
            id: `import:${file.module}->${imported.module}`,
            label: `${file.module} → ${imported.module}`,
            relationshipType: 'imports',
            sourceEntryId: sourceId,
            targetEntryId: targetId,
            evidenceKind: 'import_statement',
            evidenceDescription: `Import statement in "${file.path}" references module "${imported.module}".`,
          })
        );
      }
    }
  }

  // ---- Hierarchy: methods are children of their class (§2.2) ----
  const withParents: IndexEntry[] = entries.map((entry) => {
    if (entry.entryType !== 'symbol' || entry.details === undefined) {
      return entry;
    }
    const className = entry.details.className;
    const moduleName = entry.details.module;
    if (typeof className !== 'string' || className.length === 0) {
      return entry;
    }
    if (typeof moduleName !== 'string') {
      return entry;
    }
    const classId = `class:${moduleName}:${className}`;
    return emitted.has(classId) ? { ...entry, parentId: classId } : entry;
  });

  return { entries: withParents, diagnostics };
}
