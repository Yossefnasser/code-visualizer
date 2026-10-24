/**
 * Tests for IndexService.
 *
 * Uses a fake IndexBackend to avoid depending on a real Python process.
 * Tests cover building index, overview, queries, error handling, and lifecycle.
 */

import * as assert from 'assert';
import { IndexBackend, IndexDocument, IndexDigest, FileDoc, SymbolRef, ImportRef, CallReference, EndpointHint, RouteBinding, ModelHint, ModelFieldHint, OrmRelationshipHint, IndexDiagnostic, IndexQueryFilter, IndexQueryResult, BuildIndexOptions, IndexBackendError, IndexBackendErrorCode } from '../analysis/indexBackend';
import { IndexService, RepoOverview, IndexNotBuiltError, IndexQueryOptions } from '../analysis/indexService';

// --- Test fixtures ---

const FIXTURE_INDEX: IndexDocument = {
  schemaVersion: '1.1',
  root: '/test/project',
  language: 'python',
  digest: {
    tree: ['app/', 'app/main.py', 'app/services/', 'app/services/user_service.py'],
    manifest: [
      { path: 'app/main.py', lineCount: 10, frameworks: ['fastapi'], imports: 1, symbols: 1 },
      { path: 'app/services/user_service.py', lineCount: 20, frameworks: [], imports: 1, symbols: 2 },
    ],
    counts: { files: 2, totalLines: 30, endpoints: 1, models: 1, ormRelationships: 1, references: 2, diagnostics: 0 },
  },
  files: [
    {
      path: 'app/main.py',
      module: 'app.main',
      language: 'python',
      lineCount: 10,
      frameworks: ['fastapi'],
      imports: [{ local: 'FastAPI', module: 'fastapi', name: 'FastAPI' }],
      symbols: [
        { id: 'function:app.main:main', kind: 'function', name: 'main', qualname: 'main', className: null, startLine: 1, endLine: 10 },
      ],
    },
    {
      path: 'app/services/user_service.py',
      module: 'app.services.user_service',
      language: 'python',
      lineCount: 20,
      frameworks: [],
      imports: [{ local: 'User', module: 'app.models.user', name: 'User' }],
      symbols: [
        { id: 'function:app.services.user_service:get_user', kind: 'function', name: 'get_user', qualname: 'get_user', className: null, startLine: 5, endLine: 10 },
        { id: 'function:app.services.user_service:list_users', kind: 'function', name: 'list_users', qualname: 'list_users', className: null, startLine: 12, endLine: 18 },
      ],
    },
  ],
  endpoints: [
    { id: 'endpoint:app.main:GET:/', module: 'app.main', methods: ['GET'], path: '/', sourcePath: 'app/main.py', line: 5 },
  ],
  routeBindings: [
    { endpointId: 'endpoint:app.main:GET:/', handlerModule: 'app.main', handlerQualname: 'main' },
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
    { sourceId: 'database_model:app.models.user:User', targetId: 'database_model:app.models.post:Post', kind: 'sqlalchemy_relationship', line: 10 },
  ],
  references: [
    { sourceModule: 'app.main', sourceQualname: 'main', targetModule: 'app.services.user_service', targetQualname: 'get_user', line: 8 },
    { sourceModule: 'app.services.user_service', sourceQualname: 'get_user', targetModule: 'app.models.user', targetQualname: 'User', line: 7 },
  ],
  reverseReferences: {
    'app.services.user_service:get_user': [
      { sourceModule: 'app.main', sourceQualname: 'main', targetModule: 'app.services.user_service', targetQualname: 'get_user', line: 8 },
    ],
    'app.models.user:User': [
      { sourceModule: 'app.services.user_service', sourceQualname: 'get_user', targetModule: 'app.models.user', targetQualname: 'User', line: 7 },
    ],
  },
  diagnostics: [
    { severity: 'info', code: 'skipped_directory', message: 'Excluded directory not analyzed: .venv' },
  ],
};

function createMockBackend(): IndexBackend {
  let built = false;
  let builtIndex: IndexDocument | null = null;

  return {
    async buildIndex(options: BuildIndexOptions): Promise<IndexDocument> {
      built = true;
      builtIndex = FIXTURE_INDEX;
      return FIXTURE_INDEX;
    },
    getIndex(): IndexDocument {
      if (!built || !builtIndex) {
        throw new IndexBackendError('validation_failed', 'No index has been built yet. Call buildIndex() first.');
      }
      return builtIndex;
    },
    getDigest(): IndexDigest {
      if (!built) {
        throw new IndexBackendError('validation_failed', 'No index has been built yet. Call buildIndex() first.');
      }
      return FIXTURE_INDEX.digest;
    },
    async querySymbols(filter?: IndexQueryFilter): Promise<IndexQueryResult<SymbolRef>> {
      if (!built) throw new IndexBackendError('validation_failed', 'No index has been built yet.');
      let results = FIXTURE_INDEX.files.flatMap(f => f.symbols);
      if (filter?.module) {
        results = results.filter(s => {
          const file = FIXTURE_INDEX.files.find(f => f.symbols.includes(s));
          return file?.module === filter.module;
        });
      }
      if (filter?.modulePrefix) {
        results = results.filter(s => {
          const file = FIXTURE_INDEX.files.find(f => f.symbols.includes(s));
          return file?.module.startsWith(filter.modulePrefix!);
        });
      }
      if (filter?.kind) {
        results = results.filter(s => s.kind === filter.kind);
      }
      if (filter?.limit && filter.limit > 0) {
        results = results.slice(0, filter.limit);
      }
      return { results, total: results.length };
    },
    async queryImports(filter?: IndexQueryFilter): Promise<IndexQueryResult<{ module: string; imports: readonly ImportRef[] }>> {
      if (!built) throw new IndexBackendError('validation_failed', 'No index has been built yet.');
      let results = FIXTURE_INDEX.files.map(f => ({ module: f.module, imports: f.imports }));
      if (filter?.module) {
        results = results.filter(r => r.module === filter.module);
      }
      if (filter?.modulePrefix) {
        results = results.filter(r => r.module.startsWith(filter.modulePrefix!));
      }
      if (filter?.limit && filter.limit > 0) {
        results = results.slice(0, filter.limit);
      }
      return { results, total: results.length };
    },
    async queryReferences(filter?: IndexQueryFilter): Promise<IndexQueryResult<CallReference>> {
      if (!built) throw new IndexBackendError('validation_failed', 'No index has been built yet.');
      let results = [...FIXTURE_INDEX.references];
      if (filter?.sourceModule) {
        results = results.filter(r => r.sourceModule === filter.sourceModule);
      }
      if (filter?.targetModule) {
        results = results.filter(r => r.targetModule === filter.targetModule);
      }
      if (filter?.limit && filter.limit > 0) {
        results = results.slice(0, filter.limit);
      }
      return { results, total: results.length };
    },
    async queryReverseReferences(targetKey: string): Promise<IndexQueryResult<CallReference>> {
      if (!built) throw new IndexBackendError('validation_failed', 'No index has been built yet.');
      const results = FIXTURE_INDEX.reverseReferences[targetKey] ?? [];
      return { results, total: results.length };
    },
    getEndpoints(): readonly EndpointHint[] {
      if (!built) throw new IndexBackendError('validation_failed', 'No index has been built yet.');
      return FIXTURE_INDEX.endpoints;
    },
    getRouteBindings(): readonly RouteBinding[] {
      if (!built) throw new IndexBackendError('validation_failed', 'No index has been built yet.');
      return FIXTURE_INDEX.routeBindings;
    },
    getModels(): readonly ModelHint[] {
      if (!built) throw new IndexBackendError('validation_failed', 'No index has been built yet.');
      return FIXTURE_INDEX.models;
    },
    getOrmRelationships(): readonly OrmRelationshipHint[] {
      if (!built) throw new IndexBackendError('validation_failed', 'No index has been built yet.');
      return FIXTURE_INDEX.ormRelationships;
    },
    getFiles(): readonly FileDoc[] {
      if (!built) throw new IndexBackendError('validation_failed', 'No index has been built yet.');
      return FIXTURE_INDEX.files;
    },
    getDiagnostics(): readonly IndexDiagnostic[] {
      if (!built) throw new IndexBackendError('validation_failed', 'No index has been built yet.');
      return FIXTURE_INDEX.diagnostics;
    },
  };
}

function createService(): IndexService {
  return new IndexService({ backend: createMockBackend() });
}

// --- Tests ---

suite('IndexService', () => {
  test('buildIndex builds the index and marks it as built', async () => {
    const service = createService();
    assert.strictEqual(service.hasIndex(), false);

    const doc = await service.buildIndex({ root: '/test/project' });
    assert.strictEqual(doc.schemaVersion, '1.1');
    assert.strictEqual(service.hasIndex(), true);
  });

  test('getRepoOverview returns structured overview after build', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    const overview = service.getRepoOverview();

    assert.strictEqual(overview.schemaVersion, '1.1');
    assert.strictEqual(overview.root, '/test/project');
    assert.strictEqual(overview.language, 'python');
    assert.strictEqual(overview.counts.files, 2);
    assert.strictEqual(overview.counts.totalLines, 30);
    assert.strictEqual(overview.counts.endpoints, 1);
    assert.strictEqual(overview.counts.models, 1);
    assert.strictEqual(overview.counts.ormRelationships, 1);
    assert.strictEqual(overview.counts.references, 2);
    assert.strictEqual(overview.counts.diagnostics, 0);
    assert.strictEqual(overview.counts.symbols, 3); // 1 + 2
    assert.strictEqual(overview.counts.imports, 2); // 1 + 1
    assert.strictEqual(overview.diagnostics.length, 1);
    assert.strictEqual(overview.diagnostics[0].code, 'skipped_directory');
  });

  test('getRepoOverview throws IndexNotBuiltError before build', () => {
    const service = createService();
    assert.throws(() => service.getRepoOverview(), (err: Error) => {
      assert.ok(err instanceof IndexNotBuiltError);
      assert.strictEqual(err.code, 'index_not_built');
      return true;
    });
  });

  test('getDigest returns digest after build', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    const digest = service.getDigest();
    assert.strictEqual(digest.counts.files, 2);
    assert.strictEqual(digest.tree.length, 4);
  });

  test('getDigest throws before build', () => {
    const service = createService();
    assert.throws(() => service.getDigest(), (err: Error) => {
      assert.ok(err instanceof IndexNotBuiltError);
      return true;
    });
  });

  test('queryIndex delegates to backend for symbols', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    const result = await service.queryIndex<SymbolRef>({ type: 'symbols', filter: { module: 'app.services.user_service' } });
    assert.strictEqual(result.total, 2);
    // SymbolRef doesn't have module property; it's in the file doc
    assert.ok(result.results.every(s => s.qualname === 'get_user' || s.qualname === 'list_users'));
  });

  test('queryIndex delegates to backend for imports', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    const result = await service.queryIndex<{ module: string; imports: readonly ImportRef[] }>({ type: 'imports', filter: { modulePrefix: 'app.services' } });
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.results[0].module, 'app.services.user_service');
  });

  test('queryIndex delegates to backend for references', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    const result = await service.queryIndex<CallReference>({ type: 'references', filter: { sourceModule: 'app.main' } });
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.results[0].sourceModule, 'app.main');
  });

  test('queryIndex delegates to backend for reverseReferences', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    const result = await service.queryIndex<CallReference>({ type: 'reverseReferences', targetKey: 'app.services.user_service:get_user' });
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.results[0].sourceModule, 'app.main');
  });

  test('queryIndex throws for reverseReferences without targetKey', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    await assert.rejects(
      service.queryIndex({ type: 'reverseReferences' }),
      (err: Error) => {
        assert.ok(err.message.includes('targetKey is required'));
        return true;
      }
    );
  });

  test('queryIndex filters endpoints by module', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    const result = await service.queryIndex<EndpointHint>({ type: 'endpoints', filter: { module: 'app.main' } });
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.results[0].module, 'app.main');
  });

  test('queryIndex filters models by module', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    const result = await service.queryIndex<ModelHint>({ type: 'models', filter: { module: 'app.models.user' } });
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.results[0].name, 'User');
  });

  test('queryIndex filters routeBindings by handlerModule', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    const result = await service.queryIndex<RouteBinding>({ type: 'routeBindings', filter: { module: 'app.main' } });
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.results[0].handlerModule, 'app.main');
  });

  test('queryIndex filters ormRelationships by sourceModule', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    const result = await service.queryIndex<OrmRelationshipHint>({ type: 'ormRelationships', filter: { sourceModule: 'app.models.user' } });
    assert.strictEqual(result.total, 1);
  });

  test('queryIndex filters files by module', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    const result = await service.queryIndex<FileDoc>({ type: 'files', filter: { module: 'app.main' } });
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.results[0].path, 'app/main.py');
  });

  test('queryIndex respects limit', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    const result = await service.queryIndex({ type: 'symbols', filter: { limit: 1 } });
    assert.strictEqual(result.results.length, 1);
  });

  test('getEndpoints returns endpoints after build', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    const endpoints = service.getEndpoints();
    assert.strictEqual(endpoints.length, 1);
    assert.strictEqual(endpoints[0].path, '/');
  });

  test('getRouteBindings returns bindings after build', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    const bindings = service.getRouteBindings();
    assert.strictEqual(bindings.length, 1);
    assert.strictEqual(bindings[0].handlerQualname, 'main');
  });

  test('getModels returns models after build', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    const models = service.getModels();
    assert.strictEqual(models.length, 1);
    assert.strictEqual(models[0].name, 'User');
  });

  test('getOrmRelationships returns relationships after build', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    const rels = service.getOrmRelationships();
    assert.strictEqual(rels.length, 1);
  });

  test('getFiles returns files after build', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    const files = service.getFiles();
    assert.strictEqual(files.length, 2);
  });

  test('getDiagnostics returns diagnostics after build', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    const diags = service.getDiagnostics();
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].code, 'skipped_directory');
  });

  test('getIndex returns full document after build', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });

    const index = service.getIndex();
    assert.strictEqual(index.schemaVersion, '1.1');
    assert.strictEqual(index.files.length, 2);
  });

  test('getIndex throws before build', () => {
    const service = createService();
    assert.throws(() => service.getIndex(), (err: Error) => {
      assert.ok(err instanceof IndexNotBuiltError);
      return true;
    });
  });

  test('refreshIndex rebuilds the index', async () => {
    const service = createService();
    await service.buildIndex({ root: '/test/project' });
    const doc1 = service.getIndex();

    const doc2 = await service.refreshIndex({ root: '/test/project' });
    assert.strictEqual(doc2.schemaVersion, '1.1');
  });

  test('propagates backend errors from buildIndex', async () => {
    const backend: IndexBackend = {
      async buildIndex() {
        throw new IndexBackendError('process_failed', 'Indexer crashed', { status: 1 });
      },
      getIndex() { throw new Error('not built'); },
      getDigest() { throw new Error('not built'); },
      async querySymbols() { throw new Error('not built'); },
      async queryImports() { throw new Error('not built'); },
      async queryReferences() { throw new Error('not built'); },
      async queryReverseReferences() { throw new Error('not built'); },
      getEndpoints() { throw new Error('not built'); },
      getRouteBindings() { throw new Error('not built'); },
      getModels() { throw new Error('not built'); },
      getOrmRelationships() { throw new Error('not built'); },
      getFiles() { throw new Error('not built'); },
      getDiagnostics() { throw new Error('not built'); },
    };

    const service = new IndexService({ backend });

    await assert.rejects(
      service.buildIndex({ root: '/test/project' }),
      (err: Error) => {
        assert.ok(err instanceof IndexBackendError);
        assert.strictEqual(err.code, 'process_failed');
        return true;
      }
    );
    assert.strictEqual(service.hasIndex(), false);
  });

  test('propagates backend errors from queries', async () => {
    const backend: IndexBackend = {
      async buildIndex() { return FIXTURE_INDEX; },
      getIndex() { return FIXTURE_INDEX; },
      getDigest() { return FIXTURE_INDEX.digest; },
      async querySymbols() { throw new IndexBackendError('unknown', 'Query failed'); },
      async queryImports() { throw new IndexBackendError('unknown', 'Query failed'); },
      async queryReferences() { throw new IndexBackendError('unknown', 'Query failed'); },
      async queryReverseReferences() { throw new IndexBackendError('unknown', 'Query failed'); },
      getEndpoints() { throw new IndexBackendError('unknown', 'Query failed'); },
      getRouteBindings() { throw new IndexBackendError('unknown', 'Query failed'); },
      getModels() { throw new IndexBackendError('unknown', 'Query failed'); },
      getOrmRelationships() { throw new IndexBackendError('unknown', 'Query failed'); },
      getFiles() { throw new IndexBackendError('unknown', 'Query failed'); },
      getDiagnostics() { throw new IndexBackendError('unknown', 'Query failed'); },
    };

    const service = new IndexService({ backend });
    await service.buildIndex({ root: '/test/project' });

    await assert.rejects(
      service.queryIndex({ type: 'symbols' }),
      (err: Error) => {
        assert.ok(err instanceof IndexBackendError);
        assert.strictEqual(err.code, 'unknown');
        return true;
      }
    );
  });

  test('respects cancellation signal in buildIndex', async () => {
    let abortSignal: AbortSignal | null = null;
    const backend: IndexBackend = {
      async buildIndex(options: BuildIndexOptions) {
        abortSignal = options.signal ?? null;
        await new Promise((_, reject) => {
          if (options.signal?.aborted) {
            reject(new IndexBackendError('cancelled', 'Cancelled'));
          } else {
            options.signal?.addEventListener('abort', () => {
              reject(new IndexBackendError('cancelled', 'Cancelled'));
            }, { once: true });
          }
        });
        return FIXTURE_INDEX;
      },
      getIndex() { throw new Error('not built'); },
      getDigest() { throw new Error('not built'); },
      async querySymbols() { throw new Error('not built'); },
      async queryImports() { throw new Error('not built'); },
      async queryReferences() { throw new Error('not built'); },
      async queryReverseReferences() { throw new Error('not built'); },
      getEndpoints() { throw new Error('not built'); },
      getRouteBindings() { throw new Error('not built'); },
      getModels() { throw new Error('not built'); },
      getOrmRelationships() { throw new Error('not built'); },
      getFiles() { throw new Error('not built'); },
      getDiagnostics() { throw new Error('not built'); },
    };

    const service = new IndexService({ backend });
    const controller = new AbortController();
    const promise = service.buildIndex({ root: '/test/project', signal: controller.signal });
    controller.abort();

    await assert.rejects(promise, (err: Error) => {
      assert.ok(err instanceof IndexBackendError);
      assert.strictEqual(err.code, 'cancelled');
      return true;
    });
  });

  test('passes excludes to backend', async () => {
    let capturedExcludes: string[] = [];
    const backend: IndexBackend = {
      async buildIndex(options: BuildIndexOptions) {
        capturedExcludes = [...(options.excludes ?? [])];
        return FIXTURE_INDEX;
      },
      getIndex() { throw new Error('not built'); },
      getDigest() { throw new Error('not built'); },
      async querySymbols() { throw new Error('not built'); },
      async queryImports() { throw new Error('not built'); },
      async queryReferences() { throw new Error('not built'); },
      async queryReverseReferences() { throw new Error('not built'); },
      getEndpoints() { throw new Error('not built'); },
      getRouteBindings() { throw new Error('not built'); },
      getModels() { throw new Error('not built'); },
      getOrmRelationships() { throw new Error('not built'); },
      getFiles() { throw new Error('not built'); },
      getDiagnostics() { throw new Error('not built'); },
    };

    const service = new IndexService({ backend });
    await service.buildIndex({ root: '/test/project', excludes: ['.venv', '__pycache__', 'node_modules'] });
    assert.deepStrictEqual(capturedExcludes.sort(), ['.venv', '__pycache__', 'node_modules'].sort());
  });
});