import * as assert from 'node:assert';

import {
  FindingValidatorIndexAccess,
  FindingValidatorResult,
  validateFindings,
} from '../analysis/findingValidator';
import { AgentFinding } from '../analysis/agentRunner';
import { adaptAgentFindings, EdgeEndpoints } from '../analysis/agentFindingAdapter';
import { mapIndexToGraph } from '../analysis/indexToGraphMapper';
import {
  CallReference,
  EndpointHint,
  IndexDocument,
  OrmRelationshipHint,
  RouteBinding,
  SymbolRef,
} from '../analysis/indexBackend';
import {
  IndexDocumentV1,
  IndexEntry,
  validateIndexDocument,
} from '../analysis/indexContract';

// ---------------------------------------------------------------------------
// Fake deterministic index (v1.1, sidecar-shaped)
// ---------------------------------------------------------------------------

const FASTAPI_FILE_SYMBOL: SymbolRef = {
  id: 'function:app.api.users:list_users_endpoint',
  kind: 'function',
  name: 'list_users_endpoint',
  qualname: 'list_users_endpoint',
  className: null,
  startLine: 8,
  endLine: 18,
};

const MODEL_SYMBOL: SymbolRef = {
  id: 'class:app.models.user:User',
  kind: 'class',
  name: 'User',
  qualname: 'User',
  className: null,
  startLine: 1,
  endLine: 25,
};

const SERVICE_SYMBOL: SymbolRef = {
  id: 'function:app.services.user_service:list_users',
  kind: 'function',
  name: 'list_users',
  qualname: 'list_users',
  className: null,
  startLine: 1,
  endLine: 15,
};

const RESOLVED_CALL: CallReference = {
  sourceModule: 'app.api.users',
  sourceQualname: 'list_users_endpoint',
  targetModule: 'app.services.user_service',
  targetQualname: 'list_users',
  line: 15,
};

const ROUTE_BINDING: RouteBinding = {
  endpointId: 'endpoint:app.api.users:GET:/users',
  handlerModule: 'app.api.users',
  handlerQualname: 'list_users_endpoint',
};

const ENDPOINT_HINT: EndpointHint = {
  id: 'endpoint:app.api.users:GET:/users',
  module: 'app.api.users',
  methods: ['GET'],
  path: '/users',
  sourcePath: 'app/api/users.py',
  line: 9,
};

const ORM_RELATIONSHIP: OrmRelationshipHint = {
  sourceId: 'database_model:app.models.user:Post',
  targetId: 'database_model:app.models.user:User',
  kind: 'sqlalchemy_relationship',
  line: 20,
};

function fakeIndex(overrides?: Partial<IndexDocument>): IndexDocument & { readonly [key: string]: unknown } {
  const doc: IndexDocument = {
    schemaVersion: '1.1',
    root: '.',
    language: 'python',
    digest: {
      tree: [],
      manifest: [],
      counts: {
        files: 3,
        totalLines: 60,
        endpoints: 1,
        models: 1,
        ormRelationships: 1,
        references: 1,
        diagnostics: 0,
      },
    },
    files: [
      {
        path: 'app/api/users.py',
        module: 'app.api.users',
        language: 'python',
        lineCount: 20,
        frameworks: ['fastapi'],
        imports: [{ local: 'list_users', module: 'app.services.user_service', name: 'list_users' }],
        symbols: [FASTAPI_FILE_SYMBOL],
      },
      {
        path: 'app/models/user.py',
        module: 'app.models.user',
        language: 'python',
        lineCount: 25,
        frameworks: ['sqlalchemy'],
        imports: [],
        symbols: [MODEL_SYMBOL],
      },
      {
        path: 'app/services/user_service.py',
        module: 'app.services.user_service',
        language: 'python',
        lineCount: 15,
        frameworks: [],
        imports: [{ local: 'User', module: 'app.models.user', name: 'User' }],
        symbols: [SERVICE_SYMBOL],
      },
    ],
    endpoints: [ENDPOINT_HINT],
    routeBindings: [ROUTE_BINDING],
    models: [],
    ormRelationships: [ORM_RELATIONSHIP],
    references: [RESOLVED_CALL],
    reverseReferences: {},
    diagnostics: [],
    ...overrides,
  };
  return doc as IndexDocument & { readonly [key: string]: unknown };
}

function service(doc: IndexDocument): FindingValidatorIndexAccess {
  return { getIndex: () => doc };
}

// ---------------------------------------------------------------------------
// Index Contract v1 document builders
// ---------------------------------------------------------------------------

function aiEntry(overrides: Partial<IndexEntry> & { id: string }): IndexEntry {
  return {
    kind: 'interpretation',
    entryType: 'service',
    label: 'Interpretation',
    evidence: [],
    provenance: 'ai',
    status: 'inferred',
    ...overrides,
  };
}

function withSource(entry: IndexEntry, path: string, startLine: number, endLine?: number): IndexEntry {
  return { ...entry, source: { path, startLine, ...(endLine !== undefined ? { endLine } : {}) } };
}

function withAiEvidence(entry: IndexEntry, path: string, startLine: number, endLine?: number): IndexEntry {
  return {
    ...entry,
    evidence: [
      {
        kind: 'ai_observation',
        description: 'AI claim',
        source: { path, startLine, ...(endLine !== undefined ? { endLine } : {}) },
        metadata: { model: 'test-model' },
      },
    ],
  };
}

function relationshipEntry(overrides: Partial<IndexEntry> & { id: string; relationshipType: string; sourceEntryId: string; targetEntryId?: string | null; resolutionStatus?: 'resolved' | 'unresolved' }): IndexEntry {
  return {
    kind: 'interpretation',
    entryType: 'relationship',
    label: 'Relationship',
    evidence: [],
    provenance: 'ai',
    status: 'inferred',
    ...overrides,
    details: {
      relationshipType: overrides.relationshipType,
      sourceEntryId: overrides.sourceEntryId,
      targetEntryId: overrides.targetEntryId === undefined ? null : overrides.targetEntryId,
      resolutionStatus: overrides.resolutionStatus ?? (overrides.targetEntryId ? 'resolved' : 'unresolved'),
    },
  };
}

function contractDoc(entries: readonly IndexEntry[]): IndexDocumentV1 {
  return {
    indexVersion: '1.0',
    project: { root: '.', languages: ['python'] },
    indexer: { kind: 'ai', provider: 'openrouter', model: 'test-model' },
    coverage: { scopes: [{ id: 'scope:app', scope: 'app/', status: 'complete' }] },
    entries,
    diagnostics: [],
  };
}

/** Cast augmented edge findings (with endpoint fields) to the plain AgentFinding shape. */
function agentFindingsWith(findings: readonly (AgentFinding & Partial<EdgeEndpoints>)[]): AgentFinding[] {
  return findings as AgentFinding[];
}

function validate(entries: readonly IndexEntry[], doc: IndexDocument = fakeIndex(), options?: Parameters<typeof validateFindings>[2]): FindingValidatorResult {
  return validateFindings(contractDoc(entries), service(doc), options);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite('FindingValidator', () => {
  suite('tier 1: source-location validation', () => {
    test('verified citation keeps the entry and flags AI evidence metadata', () => {
      const entry = withAiEvidence(aiEntry({ id: 'service:app.services:ListUsers' }), 'app/services/user_service.py', 1, 15);
      const result = validate([entry]);

      assert.deepStrictEqual(result.droppedEntryIds, []);
      const flagged = result.document.entries[0].evidence[0];
      assert.strictEqual(flagged.metadata?.sourceLocationValidated, true);
    });

    test('citation outside every symbol span drops a symbol-level entry', () => {
      const entry = withSource(
        withAiEvidence(aiEntry({ id: 'service:app.services:Ghost' }), 'app/services/user_service.py', 900, 905),
        'app/services/user_service.py',
        900,
        905
      );
      const result = validate([entry]);

      assert.deepStrictEqual(result.droppedEntryIds, ['service:app.services:Ghost']);
      assert.strictEqual(result.document.entries.length, 0);
      assert.ok(result.diagnostics.some((d) => d.code === 'source_location_invalid'));
    });

    test('partial overlap with a symbol span verifies', () => {
      const entry = withAiEvidence(aiEntry({ id: 'service:app.services:Partial' }), 'app/services/user_service.py', 10, 40);
      const result = validate([entry]);

      assert.deepStrictEqual(result.droppedEntryIds, []);
      assert.strictEqual(result.document.entries[0].evidence[0].metadata?.sourceLocationValidated, true);
    });

    test('unknown path drops the entry', () => {
      const entry = withSource(withAiEvidence(aiEntry({ id: 'service:app.services:Nowhere' }), 'app/missing.py', 1), 'app/missing.py', 1);
      const result = validate([entry]);

      assert.deepStrictEqual(result.droppedEntryIds, ['service:app.services:Nowhere']);
      assert.ok(result.diagnostics.some((d) => d.code === 'source_location_invalid' && d.message.includes('app/missing.py')));
    });

    test('non-symbol-level entries verify on path existence alone', () => {
      const entry = withAiEvidence(aiEntry({ id: 'module:app.api.users', entryType: 'module' }), 'app/api/users.py', 1, 40);
      const result = validate([entry]);

      assert.deepStrictEqual(result.droppedEntryIds, []);
      assert.strictEqual(result.document.entries[0].evidence[0].metadata?.sourceLocationValidated, true);
    });

    test('entries without a citation are accepted and claim nothing', () => {
      const entry = aiEntry({ id: 'service:app.services:Bare' });
      const result = validate([entry]);

      assert.deepStrictEqual(result.droppedEntryIds, []);
      assert.strictEqual(result.document.entries[0].evidence.length, 0);
    });

    test('evidence citations are flagged individually, not used as drop criteria', () => {
      const good = { path: 'app/services/user_service.py', startLine: 1, endLine: 15 };
      const bad = { path: 'app/missing.py', startLine: 1 };
      const entry: IndexEntry = {
        ...aiEntry({ id: 'service:app.services:Mixed' }),
        source: good,
        evidence: [
          { kind: 'ai_observation', description: 'good', source: good },
          { kind: 'ai_observation', description: 'bad', source: bad },
        ],
      };
      const result = validate([entry]);

      assert.deepStrictEqual(result.droppedEntryIds, []);
      assert.strictEqual(result.document.entries[0].evidence[0].metadata?.sourceLocationValidated, true);
      assert.strictEqual(result.document.entries[0].evidence[1].metadata?.sourceLocationValidated, false);
    });

    test('deterministic facts are never flagged and never dropped', () => {
      const entry: IndexEntry = {
        id: 'route:endpoint:app.api.users:GET:/users->function:app.api.users:list_users_endpoint',
        kind: 'fact',
        entryType: 'route',
        label: 'GET /users -> list_users_endpoint',
        source: { path: 'app/api/users.py', startLine: 9, endLine: 9 },
        evidence: [{ kind: 'fastapi_route_decorator', description: 'decorator observed' }],
        provenance: 'deterministic',
        status: 'confirmed',
      };
      const result = validate([entry]);

      assert.deepStrictEqual(result.droppedEntryIds, []);
      assert.strictEqual(result.document.entries[0].evidence[0].metadata, undefined);
      assert.notStrictEqual(result.document.entries, []);
    });

    test('deterministic fact citing a path missing from the index gets a mismatch warning, not a drop', () => {
      const entry: IndexEntry = {
        id: 'reference:weird',
        kind: 'fact',
        entryType: 'reference',
        label: 'weird',
        source: { path: 'stale/removed.py', startLine: 1 },
        evidence: [],
        provenance: 'deterministic',
        status: 'confirmed',
      };
      const result = validate([entry]);

      assert.deepStrictEqual(result.droppedEntryIds, []);
      assert.ok(result.diagnostics.some((d) => d.code === 'fact_location_mismatch'));
    });

    test('drops cascade to relationships and children referencing a dropped entry', () => {
      const bad = withSource(aiEntry({ id: 'service:app.services:Ghost' }), 'app/never.py', 1);
      const edge = relationshipEntry({
        id: 'rel:ghost->service',
        relationshipType: 'uses',
        sourceEntryId: 'service:app.services:Ghost',
        targetEntryId: 'service:app.services:Real',
        resolutionStatus: 'resolved',
      });
      const real = withSource(aiEntry({ id: 'service:app.services:Real' }), 'app/services/user_service.py', 1, 15);
      const result = validate([bad, edge, real]);

      assert.deepStrictEqual([...result.droppedEntryIds].sort(), ['rel:ghost->service', 'service:app.services:Ghost']);
      assert.ok(result.diagnostics.some((d) => d.code === 'dangling_reference'));
      assert.deepStrictEqual(result.document.entries.map((e) => e.id), ['service:app.services:Real']);
    });
  });

  suite('tier 1: bounded repair round', () => {
    const badEntry = () => withSource(withAiEvidence(aiEntry({ id: 'service:app.services:Fixable' }), 'app/missing.py', 1), 'app/missing.py', 1);

    test('repair copy that verifies is accepted and recorded', () => {
      const fixed = withSource(withAiEvidence(aiEntry({ id: 'service:app.services:Fixable' }), 'app/services/user_service.py', 1, 15), 'app/services/user_service.py', 1, 15);
      const result = validate([badEntry()], fakeIndex(), {
        repair: (entries) => entries.map(() => fixed),
      });

      assert.deepStrictEqual(result.repairedEntryIds, ['service:app.services:Fixable']);
      assert.deepStrictEqual(result.droppedEntryIds, []);
      assert.strictEqual(result.document.entries[0].source?.path, 'app/services/user_service.py');
      assert.ok(result.diagnostics.some((d) => d.code === 'source_location_repaired'));
    });

    test('repair copy that still fails is dropped with the repair note', () => {
      const stillBad = withSource(aiEntry({ id: 'service:app.services:Fixable' }), 'app/still-missing.py', 1);
      const result = validate([badEntry()], fakeIndex(), {
        repair: (entries) => entries.map(() => stillBad),
      });

      assert.deepStrictEqual(result.droppedEntryIds, ['service:app.services:Fixable']);
      assert.ok(result.diagnostics.some((d) => d.message.includes('still unverifiable after the repair round')));
    });

    test('without a repair function the entry is dropped directly', () => {
      const result = validate([badEntry()]);
      assert.deepStrictEqual(result.droppedEntryIds, ['service:app.services:Fixable']);
    });

    test('a repair that tries to add unknown ids is ignored', () => {
      let asked = false;
      const result = validate([badEntry()], fakeIndex(), {
        repair: (entries) => {
          asked = true;
          return [{ ...entries[0], id: 'service:app.services:Contraband' }];
        },
      });

      assert.ok(asked);
      assert.deepStrictEqual(result.droppedEntryIds, ['service:app.services:Fixable']);
      assert.deepStrictEqual(result.repairedEntryIds, []);
      assert.ok(!result.document.entries.some((e) => e.id === 'service:app.services:Contraband'));
    });
  });

  suite('tier 2: semantic gating of confirmed', () => {
    test('verified inferred calls relationship is promoted to confirmed', () => {
      const edge = relationshipEntry({
        id: 'rel:calls',
        relationshipType: 'calls',
        sourceEntryId: 'function:app.api.users:list_users_endpoint',
        targetEntryId: 'function:app.services.user_service:list_users',
        resolutionStatus: 'resolved',
      });
      const result = validate([edge]);

      assert.deepStrictEqual(result.promotedEntryIds, ['rel:calls']);
      assert.strictEqual(result.document.entries[0].status, 'confirmed');
      assert.ok(result.diagnostics.some((d) => d.code === 'relationship_verified'));
    });

    test('unverified inferred calls relationship stays inferred', () => {
      const edge = relationshipEntry({
        id: 'rel:calls-bad',
        relationshipType: 'calls',
        sourceEntryId: 'function:app.api.users:list_users_endpoint',
        targetEntryId: 'function:app.services.user_service:nonexistent',
        resolutionStatus: 'resolved',
      });
      const result = validate([edge]);

      assert.deepStrictEqual(result.promotedEntryIds, []);
      assert.strictEqual(result.document.entries[0].status, 'inferred');
    });

    test('confirmed route_handler with a matching binding stays confirmed', () => {
      const edge: IndexEntry = {
        ...relationshipEntry({
          id: 'rel:route',
          relationshipType: 'route_handler',
          sourceEntryId: 'endpoint:app.api.users:GET:/users',
          targetEntryId: 'function:app.api.users:list_users_endpoint',
          resolutionStatus: 'resolved',
        }),
        status: 'confirmed',
        provenance: 'hybrid',
      };
      const result = validate([edge]);

      assert.deepStrictEqual(result.demotedEntryIds, []);
      assert.strictEqual(result.document.entries[0].status, 'confirmed');
    });

    test('confirmed route_handler in finding-id form verifies against the binding', () => {
      const edge: IndexEntry = {
        ...relationshipEntry({
          id: 'rel:route-finding',
          relationshipType: 'route_handler',
          sourceEntryId: 'route:endpoint:app.api.users:GET:/users->function:app.api.users:list_users_endpoint',
          targetEntryId: 'function:app.api.users:list_users_endpoint',
          resolutionStatus: 'resolved',
        }),
        status: 'confirmed',
      };
      const result = validate([edge]);

      assert.deepStrictEqual(result.demotedEntryIds, []);
      assert.strictEqual(result.document.entries[0].status, 'confirmed');
    });

    test('confirmed route_handler with no matching handler is demoted', () => {
      const edge: IndexEntry = {
        ...relationshipEntry({
          id: 'rel:route-bad',
          relationshipType: 'route_handler',
          sourceEntryId: 'endpoint:app.api.users:GET:/users',
          targetEntryId: 'function:app.api.users:someone_else',
          resolutionStatus: 'resolved',
        }),
        status: 'confirmed',
      };
      const result = validate([edge]);

      assert.deepStrictEqual(result.demotedEntryIds, ['rel:route-bad']);
      assert.strictEqual(result.document.entries[0].status, 'inferred');
      assert.ok(result.diagnostics.some((d) => d.message.includes('no matching route binding')));
    });

    test('confirmed orm_relationship verifies against sidecar declarations', () => {
      const edge: IndexEntry = {
        ...relationshipEntry({
          id: 'rel:orm',
          relationshipType: 'orm_relationship',
          sourceEntryId: 'database_model:app.models.user:Post',
          targetEntryId: 'database_model:app.models.user:User',
          resolutionStatus: 'resolved',
        }),
        status: 'confirmed',
      };
      const result = validate([edge]);

      assert.deepStrictEqual(result.demotedEntryIds, []);
      assert.strictEqual(result.document.entries[0].status, 'confirmed');
    });

    test('confirmed imports relationship verifies against file imports', () => {
      const edge: IndexEntry = {
        ...relationshipEntry({
          id: 'rel:imports',
          relationshipType: 'imports',
          sourceEntryId: 'module:app.api.users',
          targetEntryId: 'module:app.services.user_service',
          resolutionStatus: 'resolved',
        }),
        status: 'confirmed',
      };
      const result = validate([edge]);

      assert.deepStrictEqual(result.demotedEntryIds, []);
      assert.strictEqual(result.document.entries[0].status, 'confirmed');
    });

    test('confirmed uses relationship is never verifiable and is demoted', () => {
      const edge: IndexEntry = {
        ...relationshipEntry({
          id: 'rel:uses',
          relationshipType: 'uses',
          sourceEntryId: 'function:app.api.users:list_users_endpoint',
          targetEntryId: 'function:app.services.user_service:list_users',
          resolutionStatus: 'resolved',
        }),
        status: 'confirmed',
      };
      const result = validate([edge]);

      assert.deepStrictEqual(result.demotedEntryIds, ['rel:uses']);
      assert.strictEqual(result.document.entries[0].status, 'inferred');
      assert.ok(result.diagnostics.some((d) => d.message.includes('never deterministically verifiable')));
    });

    test('confirmed non-relationship AI interpretation is demoted', () => {
      const service = { ...withSource(aiEntry({ id: 'service:app.services:UserService' }), 'app/services/user_service.py', 1, 15), status: 'confirmed' as const };
      const result = validate([service]);

      assert.deepStrictEqual(result.demotedEntryIds, ['service:app.services:UserService']);
      assert.strictEqual(result.document.entries[0].status, 'inferred');
      assert.ok(result.diagnostics.some((d) => d.code === 'confirmed_requires_deterministic_verification'));
    });

    test('confirmed deterministic fact is untouched', () => {
      const fact: IndexEntry = {
        id: 'reference:app.api.users:list_users_endpoint->app.services.user_service:list_users:15',
        kind: 'fact',
        entryType: 'reference',
        label: 'list_users_endpoint calls list_users',
        source: { path: 'app/api/users.py', startLine: 15, endLine: 15 },
        evidence: [{ kind: 'function_call', description: 'observed and resolved' }],
        provenance: 'deterministic',
        status: 'confirmed',
      };
      const result = validate([fact]);

      assert.deepStrictEqual(result.demotedEntryIds, []);
      assert.strictEqual(result.document.entries[0].status, 'confirmed');
    });

    test('unresolved relationships are left alone', () => {
      const edge = relationshipEntry({
        id: 'rel:unresolved',
        relationshipType: 'uses_model',
        sourceEntryId: 'function:app.services.user_service:list_users',
        targetEntryId: null,
        resolutionStatus: 'unresolved',
        status: 'unresolved' as never,
      });
      const result = validate([edge]);

      assert.strictEqual(result.document.entries[0].status, 'unresolved');
      assert.deepStrictEqual(result.demotedEntryIds, []);
    });
  });

  test('integration: findings -> adapter -> validator -> mapper produces a confirmed edge', () => {
    const serviceFinding: AgentFinding = {
      id: 'service:app.services.user_service:UserService',
      type: 'node',
      proposedType: 'service',
      label: 'User service',
      description: 'Holds user listing logic',
      source: { path: 'app/services/user_service.py', startLine: 1, endLine: 15 },
      evidence: [
        {
          kind: 'ai_observation',
          description: 'AI observation with citation',
          source: { path: 'app/services/user_service.py', startLine: 1, endLine: 15 },
        },
      ],
      status: 'inferred',
      confidence: 0.8,
    };
    const callsFinding = {
      id: 'rel:endpoint->service',
      type: 'edge',
      proposedType: 'calls',
      label: 'GET /users calls list_users',
      description: 'via a resolved reference',
      source: { path: 'app/api/users.py', startLine: 15 },
      evidence: [
        {
          kind: 'ai_observation',
          description: 'Agent cites the resolved call site',
          source: { path: 'app/api/users.py', startLine: 15 },
        },
      ],
      status: 'inferred',
      confidence: 0.7,
      // Endpoints come from a future finding shape; the adapter accepts them.
      sourceEntryId: 'function:app.api.users:list_users_endpoint',
      targetEntryId: 'function:app.services.user_service:list_users',
    } as AgentFinding & EdgeEndpoints;

    const adapter = adaptAgentFindings(agentFindingsWith([serviceFinding, callsFinding]), {
      project: { root: '.', languages: ['python'] },
      indexer: { kind: 'ai', provider: 'openrouter', model: 'test-model' },
      coverage: { scopes: [{ id: 'scope:app', scope: 'app/', status: 'complete' }] },
      externalEntryIds: ['function:app.api.users:list_users_endpoint', 'function:app.services.user_service:list_users'],
    });

    // The real pipeline combines deterministic fact entries (from the index)
    // with the adapted interpretation entries; relationship endpoints must
    // resolve within the combined set (INDEX_TO_GRAPH_MAPPING.md §5.1).
    const factEndpoints: IndexEntry[] = [
      {
        id: 'function:app.api.users:list_users_endpoint',
        kind: 'fact',
        entryType: 'symbol',
        label: 'list_users_endpoint',
        source: { path: 'app/api/users.py', startLine: 8, endLine: 18 },
        evidence: [{ kind: 'file_observed', description: 'Function observed' }],
        provenance: 'deterministic',
        status: 'confirmed',
      },
      {
        id: 'function:app.services.user_service:list_users',
        kind: 'fact',
        entryType: 'symbol',
        label: 'list_users',
        source: { path: 'app/services/user_service.py', startLine: 1, endLine: 15 },
        evidence: [{ kind: 'file_observed', description: 'Function observed' }],
        provenance: 'deterministic',
        status: 'confirmed',
      },
    ];
    const combined: IndexDocumentV1 = {
      ...adapter.document,
      entries: [...factEndpoints, ...adapter.document.entries],
    };

    const validation = validateFindings(combined, service(fakeIndex()));
    assert.deepStrictEqual(validation.droppedEntryIds, []);
    assert.deepStrictEqual(validation.promotedEntryIds, ['rel:endpoint->service']);
    assert.deepStrictEqual(validateIndexDocument(validation.document), []);

    const { graph } = mapIndexToGraph(validation.document);
    const edge = graph.edges.find((e) => e.type === 'calls');
    assert.ok(edge, 'the verified calls relationship maps to a graph edge');
    assert.strictEqual(edge.status, 'confirmed');
    const node = graph.nodes.find((n) => n.type === 'service');
    assert.ok(node);
    assert.strictEqual(node.evidence?.[0].metadata?.sourceLocationValidated, true);
  });

  test('integration: an unverifiable claim is dropped, never confirmed, and maps to no node', () => {
    const ghostFinding: AgentFinding = {
      id: 'service:app.services:Ghost',
      type: 'node',
      proposedType: 'service',
      label: 'Ghost service',
      description: 'Claims a location that does not exist',
      source: { path: 'app/never.py', startLine: 1 },
      evidence: [{ kind: 'ai_observation', description: 'bad claim', source: { path: 'app/never.py', startLine: 1 } }],
      status: 'inferred',
    };
    const adapter = adaptAgentFindings(agentFindingsWith([ghostFinding]), {
      project: { root: '.', languages: ['python'] },
      indexer: { kind: 'ai', provider: 'openrouter', model: 'test-model' },
      coverage: { scopes: [{ id: 'scope:app', scope: 'app/', status: 'complete' }] },
    });

    const validation = validateFindings(adapter.document, service(fakeIndex()));
    assert.deepStrictEqual(validation.droppedEntryIds, ['service:app.services:Ghost']);
    assert.deepStrictEqual(validateIndexDocument(validation.document), []);

    const { graph } = mapIndexToGraph(validation.document);
    assert.deepStrictEqual(graph.nodes, []);
  });

  test('the validated document is always structurally valid', () => {
    const bad = withSource(aiEntry({ id: 'service:app.services:Ghost' }), 'app/never.py', 1);
    const edge = relationshipEntry({
      id: 'rel:uses-ghost',
      relationshipType: 'uses',
      sourceEntryId: 'service:app.services:Ghost',
      targetEntryId: null,
      resolutionStatus: 'unresolved',
    });
    const good = withSource(aiEntry({ id: 'service:app.services:Real' }), 'app/services/user_service.py', 1, 15);
    const result = validate([bad, edge, good]);

    assert.deepStrictEqual(validateIndexDocument(result.document), []);
    assert.deepStrictEqual(result.document.diagnostics.map((d) => d.code).filter((c) => c === 'source_location_invalid' || c === 'dangling_reference'), [
      'source_location_invalid',
      'dangling_reference',
    ]);
  });
});
