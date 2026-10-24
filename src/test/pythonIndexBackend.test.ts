/**
 * Tests for PythonIndexBackend.
 *
 * These tests use a mock process executor to avoid depending on a real Python installation.
 * They verify successful indexing, invalid JSON, process failure, missing Python,
 * paths with spaces, and cancellation.
 */

import * as assert from 'assert';
import { PythonIndexBackend } from '../analysis/pythonIndexBackend';
import {
  IndexBackendError,
  IndexBackendErrorCode,
  ProcessExecutor,
  PythonIndexBackendOptions,
  IndexDocument,
  IndexDigest,
  FileDoc,
  SymbolRef,
  ImportRef,
  CallReference,
  EndpointHint,
  RouteBinding,
  ModelHint,
  ModelFieldHint,
  OrmRelationshipHint,
  IndexDiagnostic,
} from '../analysis/indexBackend';

// --- Test fixtures ---

const VALID_INDEX_DOCUMENT: IndexDocument = {
  schemaVersion: '1.1',
  root: '/test/project',
  language: 'python',
  digest: {
    tree: ['app/', 'app/main.py'],
    manifest: [
      { path: 'app/main.py', lineCount: 10, frameworks: ['fastapi'], imports: 1, symbols: 1 },
    ],
    counts: { files: 1, totalLines: 10, endpoints: 1, models: 0, ormRelationships: 0, references: 0, diagnostics: 0 },
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
  ],
  endpoints: [
    { id: 'endpoint:app.main:GET:/', module: 'app.main', methods: ['GET'], path: '/', sourcePath: 'app/main.py', line: 5 },
  ],
  routeBindings: [
    { endpointId: 'endpoint:app.main:GET:/', handlerModule: 'app.main', handlerQualname: 'main' },
  ],
  models: [],
  ormRelationships: [],
  references: [],
  reverseReferences: {},
  diagnostics: [],
};

function createMockExecutor(response: { stdout: string; stderr: string; exitCode: number } | Error): ProcessExecutor {
  return {
    async execute() {
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
  };
}

function createBackend(options: Partial<PythonIndexBackendOptions> = {}): PythonIndexBackend {
  return new PythonIndexBackend({
    executor: createMockExecutor({ stdout: JSON.stringify(VALID_INDEX_DOCUMENT), stderr: '', exitCode: 0 }),
    ...options,
  });
}

// --- Tests ---

suite('PythonIndexBackend', () => {
  test('buildIndex returns parsed and validated index document on success', async () => {
    const backend = createBackend();
    const doc = await backend.buildIndex({ root: '/test/project' });

    assert.strictEqual(doc.schemaVersion, '1.1');
    assert.strictEqual(doc.root, '/test/project');
    assert.strictEqual(doc.language, 'python');
    assert.strictEqual(doc.files.length, 1);
    assert.strictEqual(doc.endpoints.length, 1);
  });

  test('getIndex returns cached document after buildIndex', async () => {
    const backend = createBackend();
    await backend.buildIndex({ root: '/test/project' });
    const doc = backend.getIndex();
    assert.strictEqual(doc.root, '/test/project');
  });

  test('getIndex throws if buildIndex not called', () => {
    const backend = createBackend();
    assert.throws(() => backend.getIndex(), (err: Error) => {
      assert.ok(err instanceof IndexBackendError);
      assert.strictEqual(err.code, 'validation_failed');
      return true;
    });
  });

  test('throws IndexBackendError with code invalid_json for malformed output', async () => {
    const backend = new PythonIndexBackend({
      executor: createMockExecutor({ stdout: 'not valid json', stderr: '', exitCode: 0 }),
    });

    await assert.rejects(
      backend.buildIndex({ root: '/test/project' }),
      (err: Error) => {
        assert.ok(err instanceof IndexBackendError);
        assert.strictEqual(err.code, 'invalid_json');
        return true;
      }
    );
  });

  test('throws IndexBackendError with code unsupported_schema_version for wrong version', async () => {
    const badDoc = { ...VALID_INDEX_DOCUMENT, schemaVersion: '1.0' };
    const backend = new PythonIndexBackend({
      executor: createMockExecutor({ stdout: JSON.stringify(badDoc), stderr: '', exitCode: 0 }),
    });

    await assert.rejects(
      backend.buildIndex({ root: '/test/project' }),
      (err: Error) => {
        assert.ok(err instanceof IndexBackendError);
        assert.strictEqual(err.code, 'unsupported_schema_version');
        assert.ok(err.message.includes('1.0'));
        return true;
      }
    );
  });

  test('throws IndexBackendError with code validation_failed for missing required fields', async () => {
    const badDoc = { ...VALID_INDEX_DOCUMENT };
    delete (badDoc as any).digest;
    const backend = new PythonIndexBackend({
      executor: createMockExecutor({ stdout: JSON.stringify(badDoc), stderr: '', exitCode: 0 }),
    });

    await assert.rejects(
      backend.buildIndex({ root: '/test/project' }),
      (err: Error) => {
        assert.ok(err instanceof IndexBackendError);
        assert.strictEqual(err.code, 'validation_failed');
        assert.ok(err.message.includes('digest'));
        return true;
      }
    );
  });

  test('throws IndexBackendError with code process_failed for non-zero exit code', async () => {
    const backend = new PythonIndexBackend({
      executor: {
        async execute() {
          return { stdout: '', stderr: 'ImportError: No module named analyzer', exitCode: 1 };
        },
      },
    });

    await assert.rejects(
      backend.buildIndex({ root: '/test/project' }),
      (err: Error) => {
        assert.ok(err instanceof IndexBackendError);
        assert.strictEqual(err.code, 'process_failed');
        assert.ok(err.message.includes('exited with code 1'));
        return true;
      }
    );
  });

  test('wraps unknown executor errors as unknown', async () => {
    const error = new Error('spawn python ENOENT');
    (error as any).code = 'ENOENT';
    const backend = new PythonIndexBackend({
      executor: {
        async execute() {
          throw error;
        },
      },
    });

    await assert.rejects(
      backend.buildIndex({ root: '/test/project' }),
      (err: Error) => {
        assert.ok(err instanceof IndexBackendError);
        // Custom executor errors are wrapped as 'unknown' - 'python_not_found' is only
        // produced by the defaultProcessExecutor which inspects the spawn error
        assert.strictEqual(err.code, 'unknown');
        return true;
      }
    );
  });

  test('handles paths with spaces in root', async () => {
    let capturedRoot = '';
    const backend = new PythonIndexBackend({
      executor: {
        async execute(command, args) {
          capturedRoot = args[2]; // root is the 3rd argument (after -m analyzer)
          return { stdout: JSON.stringify(VALID_INDEX_DOCUMENT), stderr: '', exitCode: 0 };
        },
      },
    });

    await backend.buildIndex({ root: '/path/with spaces/project' });
    assert.strictEqual(capturedRoot, '/path/with spaces/project');
  });

  test('passes exclude directories to indexer', async () => {
    let capturedExcludes: string[] = [];
    const backend = new PythonIndexBackend({
      executor: {
        async execute(command, args) {
          // Find --exclude arguments
          for (let i = 0; i < args.length; i++) {
            if (args[i] === '--exclude') {
              capturedExcludes.push(args[i + 1]);
            }
          }
          return { stdout: JSON.stringify(VALID_INDEX_DOCUMENT), stderr: '', exitCode: 0 };
        },
      },
    });

    await backend.buildIndex({ root: '/test/project', excludes: ['.venv', '__pycache__', 'node_modules'] });
    assert.deepStrictEqual(capturedExcludes.sort(), ['.venv', '__pycache__', 'node_modules'].sort());
  });

  test('cancellation aborts the process', async () => {
    let abortSignal: AbortSignal | null = null;
    const backend = new PythonIndexBackend({
      executor: {
        async execute(command, args, options) {
          abortSignal = options.signal ?? null;
          // Simulate a long-running process that gets cancelled
          await new Promise((_, reject) => {
            if (options.signal?.aborted) {
              reject(new IndexBackendError('cancelled', 'Indexer process was cancelled'));
            } else {
              options.signal?.addEventListener('abort', () => {
                reject(new IndexBackendError('cancelled', 'Indexer process was cancelled'));
              }, { once: true });
            }
          });
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      },
    });

    const controller = new AbortController();
    const promise = backend.buildIndex({ root: '/test/project', signal: controller.signal });
    controller.abort();

    await assert.rejects(promise, (err: Error) => {
      assert.ok(err instanceof IndexBackendError);
      assert.strictEqual(err.code, 'cancelled');
      return true;
    });
  });

  test('querySymbols filters by module', async () => {
    const backend = createBackend();
    await backend.buildIndex({ root: '/test/project' });

    const result = await backend.querySymbols({ module: 'app.main' });
    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(result.results[0].qualname, 'main');
  });

  test('querySymbols filters by kind', async () => {
    const backend = createBackend();
    await backend.buildIndex({ root: '/test/project' });

    const result = await backend.querySymbols({ kind: 'function' });
    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(result.results[0].kind, 'function');
  });

  test('querySymbols respects limit', async () => {
    const backend = createBackend();
    await backend.buildIndex({ root: '/test/project' });

    const result = await backend.querySymbols({ limit: 0 });
    assert.strictEqual(result.results.length, 0);
  });

  test('queryReverseReferences returns empty array for unknown target', async () => {
    const backend = createBackend();
    await backend.buildIndex({ root: '/test/project' });

    const result = await backend.queryReverseReferences('unknown:target');
    assert.strictEqual(result.results.length, 0);
  });

  test('getEndpoints returns endpoints from index', async () => {
    const backend = createBackend();
    await backend.buildIndex({ root: '/test/project' });

    const endpoints = backend.getEndpoints();
    assert.strictEqual(endpoints.length, 1);
    assert.strictEqual(endpoints[0].path, '/');
  });

  test('getRouteBindings returns bindings from index', async () => {
    const backend = createBackend();
    await backend.buildIndex({ root: '/test/project' });

    const bindings = backend.getRouteBindings();
    assert.strictEqual(bindings.length, 1);
    assert.strictEqual(bindings[0].handlerQualname, 'main');
  });

  test('getModels returns models from index', async () => {
    const backend = createBackend();
    await backend.buildIndex({ root: '/test/project' });

    const models = backend.getModels();
    assert.strictEqual(models.length, 0);
  });

  test('getOrmRelationships returns relationships from index', async () => {
    const backend = createBackend();
    await backend.buildIndex({ root: '/test/project' });

    const rels = backend.getOrmRelationships();
    assert.strictEqual(rels.length, 0);
  });

  test('getFiles returns files from index', async () => {
    const backend = createBackend();
    await backend.buildIndex({ root: '/test/project' });

    const files = backend.getFiles();
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].path, 'app/main.py');
  });

  test('getDiagnostics returns diagnostics from index', async () => {
    const backend = createBackend();
    await backend.buildIndex({ root: '/test/project' });

    const diags = backend.getDiagnostics();
    assert.strictEqual(diags.length, 0);
  });

  test('uses custom python executable when configured', async () => {
    let capturedCommand = '';
    const backend = new PythonIndexBackend({
      pythonExecutable: '/custom/python3',
      executor: {
        async execute(command) {
          capturedCommand = command;
          return { stdout: JSON.stringify(VALID_INDEX_DOCUMENT), stderr: '', exitCode: 0 };
        },
      },
    });

    await backend.buildIndex({ root: '/test/project' });
    assert.strictEqual(capturedCommand, '/custom/python3');
  });

  test('uses custom python args when configured', async () => {
    let capturedArgs: string[] = [];
    const backend = new PythonIndexBackend({
      pythonArgs: ['-X', 'utf8'],
      executor: {
        async execute(command, args) {
          capturedArgs = [...args];
          return { stdout: JSON.stringify(VALID_INDEX_DOCUMENT), stderr: '', exitCode: 0 };
        },
      },
    });

    await backend.buildIndex({ root: '/test/project' });
    assert.ok(capturedArgs.includes('-X'));
    assert.ok(capturedArgs.includes('utf8'));
  });

  test('timeout is passed to executor', async () => {
    let capturedTimeout: number | undefined;
    const backend = new PythonIndexBackend({
      timeoutMs: 12345,
      executor: {
        async execute(command, args, options) {
          capturedTimeout = options.timeoutMs;
          return { stdout: JSON.stringify(VALID_INDEX_DOCUMENT), stderr: '', exitCode: 0 };
        },
      },
    });

    await backend.buildIndex({ root: '/test/project' });
    assert.strictEqual(capturedTimeout, 12345);
  });
});