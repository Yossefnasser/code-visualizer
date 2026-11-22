/**
 * Tests for toContractEntries (deterministic index → Index Contract facts).
 *
 * No AI, no Python, no I/O: a fixture index document exercises every mapping
 * rule in `docs/INDEX_TO_GRAPH_MAPPING.md` §2.1–2.3 and §3.1–3.4.
 */

import * as assert from 'assert';
import { IndexDocument } from '../analysis/indexBackend';
import {
  INDEX_CONTRACT_VERSION,
  IndexDiagnostic,
  IndexDocumentV1,
  IndexEntry,
  validateIndexDocument,
} from '../analysis/indexContract';
import { toContractEntries } from '../analysis/indexToContractEntries';

const FIXTURE_INDEX: IndexDocument = {
  schemaVersion: '1.1',
  root: '/test/project',
  language: 'python',
  digest: {
    tree: ['app/', 'app/main.py', 'app/services/', 'app/services/user_service.py'],
    manifest: [
      { path: 'app/main.py', lineCount: 12, frameworks: ['fastapi'], imports: 2, symbols: 1 },
      { path: 'app/services/user_service.py', lineCount: 24, frameworks: [], imports: 0, symbols: 4 },
    ],
    counts: {
      files: 3,
      totalLines: 51,
      endpoints: 1,
      models: 1,
      ormRelationships: 1,
      references: 2,
      diagnostics: 0,
    },
  },
  files: [
    {
      path: 'app/main.py',
      module: 'app.main',
      language: 'python',
      lineCount: 12,
      frameworks: ['fastapi'],
      imports: [
        { local: 'FastAPI', module: 'fastapi', name: 'FastAPI' },
        { local: 'user_service', module: 'app.services.user_service', name: null },
      ],
      symbols: [
        {
          id: 'function:app.main:main',
          kind: 'function',
          name: 'main',
          qualname: 'main',
          className: null,
          startLine: 6,
          endLine: 12,
        },
      ],
    },
    {
      path: 'app/services/user_service.py',
      module: 'app.services.user_service',
      language: 'python',
      lineCount: 24,
      frameworks: [],
      imports: [],
      symbols: [
        {
          id: 'function:app.services.user_service:list_users',
          kind: 'function',
          name: 'list_users',
          qualname: 'list_users',
          className: null,
          startLine: 4,
          endLine: 9,
        },
        {
          id: 'class:app.services.user_service:UserService',
          kind: 'class',
          name: 'UserService',
          qualname: 'UserService',
          className: null,
          startLine: 12,
          endLine: 20,
        },
        {
          id: 'function:app.services.user_service:UserService.list_users',
          kind: 'function',
          name: 'list_users',
          qualname: 'UserService.list_users',
          className: 'UserService',
          startLine: 14,
          endLine: 18,
        },
        {
          id: 'function:app.services.user_service:Ghost.do',
          kind: 'function',
          name: 'do',
          qualname: 'Ghost.do',
          className: 'Ghost',
          startLine: 22,
          endLine: 24,
        },
      ],
    },
    {
      path: 'app/models/user.py',
      module: 'app.models.user',
      language: 'python',
      lineCount: 15,
      frameworks: [],
      imports: [],
      symbols: [
        {
          id: 'class:app.models.user:User',
          kind: 'class',
          name: 'User',
          qualname: 'User',
          className: null,
          startLine: 1,
          endLine: 15,
        },
      ],
    },
  ],
  endpoints: [
    {
      id: 'endpoint:app.main:GET:/users',
      module: 'app.main',
      methods: ['GET'],
      path: '/users',
      sourcePath: 'app/main.py',
      line: 7,
    },
  ],
  routeBindings: [
    { endpointId: 'endpoint:app.main:GET:/users', handlerModule: 'app.main', handlerQualname: 'main' },
  ],
  models: [
    {
      id: 'database_model:app.models.user:User',
      module: 'app.models.user',
      name: 'User',
      table: 'users',
      sourcePath: 'app/models/user.py',
      startLine: 1,
      endLine: 15,
      fields: [
        { name: 'id', kind: 'column', type: 'int', targetHint: null, line: 5 },
        { name: 'email', kind: 'column', type: 'str', targetHint: null, line: 6 },
      ],
    },
  ],
  ormRelationships: [
    {
      // Post is not an indexed model: the edge must be skipped, not fabricated.
      sourceId: 'database_model:app.models.user:User',
      targetId: 'database_model:app.models.post:Post',
      kind: 'sqlalchemy_relationship',
      line: 10,
    },
  ],
  references: [
    {
      sourceModule: 'app.main',
      sourceQualname: 'main',
      targetModule: 'app.services.user_service',
      targetQualname: 'list_users',
      line: 8,
    },
    {
      // Target is a class: the reference must resolve to the `class:` id.
      sourceModule: 'app.services.user_service',
      sourceQualname: 'list_users',
      targetModule: 'app.models.user',
      targetQualname: 'User',
      line: 7,
    },
  ],
  reverseReferences: {
    'app.services.user_service:list_users': [
      {
        sourceModule: 'app.main',
        sourceQualname: 'main',
        targetModule: 'app.services.user_service',
        targetQualname: 'list_users',
        line: 8,
      },
    ],
  },
  diagnostics: [],
};

function entryIds(entries: readonly IndexEntry[]): string[] {
  return entries.map((entry) => entry.id);
}

function asDocument(entries: readonly IndexEntry[], diagnostics: readonly IndexDiagnostic[]): IndexDocumentV1 {
  return {
    indexVersion: INDEX_CONTRACT_VERSION,
    project: { root: FIXTURE_INDEX.root, languages: [FIXTURE_INDEX.language] },
    indexer: { kind: 'deterministic' },
    coverage: { scopes: [] },
    entries,
    diagnostics,
  };
}

suite('toContractEntries', () => {
  test('materializes modules, symbols, routes and models as confirmed facts', () => {
    const { entries } = toContractEntries(FIXTURE_INDEX);
    const ids = entryIds(entries);

    assert.deepStrictEqual(
      ids.filter((id) => id.startsWith('module:')),
      ['module:app.main', 'module:app.services.user_service', 'module:app.models.user']
    );
    assert.ok(ids.includes('function:app.main:main'));
    assert.ok(ids.includes('class:app.models.user:User'));
    assert.ok(ids.includes('endpoint:app.main:GET:/users'));
    assert.ok(ids.includes('database_model:app.models.user:User'));

    for (const entry of entries) {
      assert.strictEqual(entry.kind, 'fact', `${entry.id} must be a fact`);
      assert.strictEqual(entry.provenance, 'deterministic', `${entry.id} must be deterministic`);
      assert.strictEqual(entry.status, 'confirmed', `${entry.id} must be confirmed`);
    }

    const route = entries.find((entry) => entry.id === 'endpoint:app.main:GET:/users');
    assert.strictEqual(route?.entryType, 'route');
    assert.strictEqual(route?.label, 'GET /users');

    const model = entries.find((entry) => entry.id === 'database_model:app.models.user:User');
    assert.strictEqual(model?.entryType, 'model');
    assert.strictEqual(model?.label, 'User');

    const symbol = entries.find((entry) => entry.id === 'function:app.main:main');
    assert.strictEqual(symbol?.details?.kind, 'function');
    assert.strictEqual(symbol?.details?.module, 'app.main');
  });

  test('emits a confirmed route_handler edge from endpoint to handler', () => {
    const { entries } = toContractEntries(FIXTURE_INDEX);
    const edge = entries.find((entry) => entry.id === 'route:endpoint:app.main:GET:/users->function:app.main:main');

    assert.ok(edge, 'route_handler edge must exist');
    assert.strictEqual(edge.entryType, 'relationship');
    assert.strictEqual(edge.status, 'confirmed');
    assert.strictEqual(edge.details?.relationshipType, 'route_handler');
    assert.strictEqual(edge.details?.sourceEntryId, 'endpoint:app.main:GET:/users');
    assert.strictEqual(edge.details?.targetEntryId, 'function:app.main:main');
    assert.strictEqual(edge.details?.resolutionStatus, 'resolved');
  });

  test('skips ORM edges whose target model is not indexed', () => {
    const { entries, diagnostics } = toContractEntries(FIXTURE_INDEX);

    assert.deepStrictEqual(
      entryIds(entries).filter((id) => id.startsWith('orm:')),
      [],
      'no ORM edge may reference an unindexed model'
    );
    const skipped = diagnostics.find((diagnostic) => diagnostic.code === 'fact_edge_skipped_missing_endpoint');
    assert.ok(skipped, 'the skipped edge must be reported');
    assert.ok(skipped.message.includes('database_model:app.models.post:Post'));
  });

  test('resolves call references to symbol ids, including class targets', () => {
    const { entries } = toContractEntries(FIXTURE_INDEX);
    const ids = entryIds(entries);

    assert.ok(ids.includes('call:function:app.main:main->function:app.services.user_service:list_users'));
    assert.ok(
      ids.includes('call:function:app.services.user_service:list_users->class:app.models.user:User'),
      'a class target must resolve to its class entry id'
    );

    const call = entries.find(
      (entry) => entry.id === 'call:function:app.main:main->function:app.services.user_service:list_users'
    );
    assert.strictEqual(call?.details?.relationshipType, 'calls');
    assert.strictEqual(call?.source?.path, 'app/main.py');
    assert.strictEqual(call?.source?.startLine, 8);
  });

  test('omits import edges by default and materializes only internal ones when enabled', () => {
    const byDefault = toContractEntries(FIXTURE_INDEX);
    assert.deepStrictEqual(entryIds(byDefault.entries).filter((id) => id.startsWith('import:')), []);

    const withImports = toContractEntries(FIXTURE_INDEX, { includeImports: true });
    const importIds = entryIds(withImports.entries).filter((id) => id.startsWith('import:'));
    assert.deepStrictEqual(importIds, ['import:app.main->app.services.user_service']);

    const edge = withImports.entries.find((entry) => entry.id === 'import:app.main->app.services.user_service');
    assert.strictEqual(edge?.details?.relationshipType, 'imports');
    assert.strictEqual(edge?.details?.sourceEntryId, 'module:app.main');
    assert.strictEqual(edge?.details?.targetEntryId, 'module:app.services.user_service');
  });

  test('links methods to their class only when the class entry exists', () => {
    const { entries } = toContractEntries(FIXTURE_INDEX);

    const method = entries.find((entry) => entry.id === 'function:app.services.user_service:UserService.list_users');
    assert.strictEqual(method?.parentId, 'class:app.services.user_service:UserService');

    const orphan = entries.find((entry) => entry.id === 'function:app.services.user_service:Ghost.do');
    assert.strictEqual(orphan?.parentId, undefined, 'a missing class must not produce a dangling parentId');
  });

  test('the fact document is structurally valid, including cross-references', () => {
    const { entries, diagnostics } = toContractEntries(FIXTURE_INDEX, { includeImports: true });

    assert.deepStrictEqual(validateIndexDocument(asDocument(entries, diagnostics)), []);
  });
});
