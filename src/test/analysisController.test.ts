/**
 * Tests for AnalysisController (pipeline composition).
 *
 * Everything is offline: a fixture index document, a scripted ModelProvider,
 * and the real IndexService-facing interfaces. No Python, no network, no
 * VS Code APIs.
 */

import * as assert from 'assert';
import { AgentFinding, AgentRunner } from '../analysis/agentRunner';
import { AnalysisController, AnalysisError } from '../analysis/analysisController';
import { EdgeEndpoints } from '../analysis/agentFindingAdapter';
import {
  BuildIndexOptions,
  EndpointHint,
  FileDoc,
  IndexDiagnostic,
  IndexDigest,
  IndexDocument,
  ModelHint,
  OrmRelationshipHint,
  RouteBinding,
} from '../analysis/indexBackend';
import {
  IndexNotBuiltError,
  IndexQueryOptions,
  IndexQueryResultWrapper,
  IndexServiceInterface,
  RepoOverview,
} from '../analysis/indexService';
import { ModelProvider, ModelProviderError, ModelRequest, ModelResponse } from '../analysis/modelProvider';

// ============================================================================
// Fixtures
// ============================================================================

const FIXTURE_INDEX: IndexDocument = {
  schemaVersion: '1.1',
  root: '/test/project',
  language: 'python',
  digest: {
    tree: ['app/', 'app/main.py', 'app/services/', 'app/services/user_service.py'],
    manifest: [
      { path: 'app/main.py', lineCount: 10, frameworks: ['fastapi'], imports: 0, symbols: 1 },
      { path: 'app/services/user_service.py', lineCount: 20, frameworks: [], imports: 0, symbols: 1 },
    ],
    counts: {
      files: 2,
      totalLines: 30,
      endpoints: 1,
      models: 0,
      ormRelationships: 0,
      references: 0,
      diagnostics: 0,
    },
  },
  files: [
    {
      path: 'app/main.py',
      module: 'app.main',
      language: 'python',
      lineCount: 10,
      frameworks: ['fastapi'],
      imports: [],
      symbols: [
        {
          id: 'function:app.main:main',
          kind: 'function',
          name: 'main',
          qualname: 'main',
          className: null,
          startLine: 1,
          endLine: 10,
        },
      ],
    },
    {
      path: 'app/services/user_service.py',
      module: 'app.services.user_service',
      language: 'python',
      lineCount: 20,
      frameworks: [],
      imports: [],
      symbols: [
        {
          id: 'function:app.services.user_service:list_users',
          kind: 'function',
          name: 'list_users',
          qualname: 'list_users',
          className: null,
          startLine: 12,
          endLine: 18,
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
      line: 5,
    },
  ],
  routeBindings: [
    { endpointId: 'endpoint:app.main:GET:/users', handlerModule: 'app.main', handlerQualname: 'main' },
  ],
  models: [],
  ormRelationships: [],
  references: [],
  reverseReferences: {},
  diagnostics: [],
};

/** A verified claim: the citation overlaps the indexed `list_users` span. */
const SERVICE_FINDING: AgentFinding = {
  id: 'service:app.services.user_service:UserService',
  type: 'node',
  proposedType: 'service',
  label: 'User service',
  description: 'Groups the user listing logic',
  source: { path: 'app/services/user_service.py', startLine: 12, endLine: 18 },
  evidence: [
    {
      kind: 'ai_observation',
      description: 'The agent cites the function body it read',
      source: { path: 'app/services/user_service.py', startLine: 12, endLine: 18 },
    },
  ],
  status: 'inferred',
  confidence: 0.8,
};

/** An AI edge from the interpreted service to a deterministic symbol fact. */
const USES_EDGE_FINDING: AgentFinding & EdgeEndpoints = {
  id: 'rel:service-uses-list-users',
  type: 'edge',
  proposedType: 'uses',
  label: 'User service uses list_users',
  description: 'The service delegates listing to this function',
  source: { path: 'app/services/user_service.py', startLine: 12 },
  evidence: [
    {
      kind: 'ai_observation',
      description: 'The agent cites the delegation site',
      source: { path: 'app/services/user_service.py', startLine: 12 },
    },
  ],
  status: 'inferred',
  sourceEntryId: 'service:app.services.user_service:UserService',
  targetEntryId: 'function:app.services.user_service:list_users',
};

/** A claim whose citation points at a file the index never saw. */
const GHOST_FINDING: AgentFinding = {
  id: 'service:app.services:Ghost',
  type: 'node',
  proposedType: 'service',
  label: 'Ghost service',
  description: 'Claims a location that does not exist',
  source: { path: 'app/never.py', startLine: 1 },
  evidence: [{ kind: 'ai_observation', description: 'bad claim', source: { path: 'app/never.py', startLine: 1 } }],
  status: 'inferred',
};

// ============================================================================
// Fakes
// ============================================================================

/** Minimal IndexService: only build/get are needed by the controller. */
class FakeIndexService implements IndexServiceInterface {
  buildCalls = 0;
  private index: IndexDocument | undefined;

  constructor(
    private readonly fixture: IndexDocument = FIXTURE_INDEX,
    private readonly failure?: Error
  ) {}

  async buildIndex(options: BuildIndexOptions): Promise<IndexDocument> {
    this.buildCalls++;
    if (this.failure) {
      throw this.failure;
    }
    this.index = this.fixture;
    return this.fixture;
  }

  async refreshIndex(options: BuildIndexOptions): Promise<IndexDocument> {
    return this.buildIndex(options);
  }

  hasIndex(): boolean {
    return this.index !== undefined;
  }

  getIndex(): IndexDocument {
    if (!this.index) {
      throw new IndexNotBuiltError();
    }
    return this.index;
  }

  getRepoOverview(): RepoOverview {
    throw new Error('getRepoOverview is not used by AnalysisController');
  }

  getDigest(): IndexDigest {
    throw new Error('getDigest is not used by AnalysisController');
  }

  async queryIndex<T>(options: IndexQueryOptions): Promise<IndexQueryResultWrapper<T>> {
    throw new Error('queryIndex is not used by AnalysisController');
  }

  getEndpoints(): readonly EndpointHint[] {
    throw new Error('getEndpoints is not used by AnalysisController');
  }

  getRouteBindings(): readonly RouteBinding[] {
    throw new Error('getRouteBindings is not used by AnalysisController');
  }

  getModels(): readonly ModelHint[] {
    throw new Error('getModels is not used by AnalysisController');
  }

  getOrmRelationships(): readonly OrmRelationshipHint[] {
    throw new Error('getOrmRelationships is not used by AnalysisController');
  }

  getFiles(): readonly FileDoc[] {
    throw new Error('getFiles is not used by AnalysisController');
  }

  getDiagnostics(): readonly IndexDiagnostic[] {
    throw new Error('getDiagnostics is not used by AnalysisController');
  }
}

type ScriptStep = { content: string } | { error: ModelProviderError };

/** Scripted provider: returns each step in order, then repeats the last one. */
class ScriptedModelProvider implements ModelProvider {
  readonly id = 'fake';
  calls = 0;

  constructor(private readonly script: readonly ScriptStep[]) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const step = this.script[Math.min(this.calls, this.script.length - 1)];
    this.calls++;
    if ('error' in step) {
      throw step.error;
    }
    return {
      content: step.content,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUSD: 0.001 },
      finishReason: 'stop',
      model: 'fake-model',
    };
  }
}

function findingsResponse(findings: readonly unknown[]): string {
  return JSON.stringify({ findings });
}

interface Harness {
  controller: AnalysisController;
  indexService: FakeIndexService;
  provider: ScriptedModelProvider;
}

function makeHarness(steps: readonly ScriptStep[], indexService = new FakeIndexService()): Harness {
  const provider = new ScriptedModelProvider(steps);
  const runner = new AgentRunner({
    modelProvider: provider,
    indexService,
    workspaceRoot: FIXTURE_INDEX.root,
    maxTurns: 3,
  });
  const controller = new AnalysisController({
    indexService,
    runner,
    workspaceRoot: FIXTURE_INDEX.root,
    providerId: 'fake',
    modelId: 'fake-model',
  });
  return { controller, indexService, provider };
}

// ============================================================================
// Tests
// ============================================================================

suite('AnalysisController', () => {
  test('a verified finding flows through adapt → validate → map into a graph node', async () => {
    const { controller } = makeHarness([
      { content: findingsResponse([SERVICE_FINDING, USES_EDGE_FINDING]) },
    ]);

    const result = await controller.run();

    const node = result.graph.nodes.find(
      (candidate) => candidate.id === 'service:app.services.user_service:UserService'
    );
    assert.ok(node, 'the verified service must appear as a node');
    assert.strictEqual(node.type, 'service');
    assert.strictEqual(node.origin, 'ai');
    assert.strictEqual(node.status, 'inferred');
    assert.strictEqual(node.evidence?.[0].metadata?.sourceLocationValidated, true);

    const edge = result.graph.edges.find((candidate) => candidate.id === 'rel:service-uses-list-users');
    assert.ok(edge, 'the AI edge must survive validation');
    assert.strictEqual(edge.status, 'inferred', '`uses` is never confirmed');
    assert.strictEqual(edge.source, 'service:app.services.user_service:UserService');
    assert.strictEqual(edge.target, 'function:app.services.user_service:list_users');

    // Deterministic facts share the same graph.
    const routeEdge = result.graph.edges.find((candidate) => candidate.type === 'route_handler');
    assert.ok(routeEdge, 'the deterministic route binding must map to an edge');
    assert.strictEqual(routeEdge.status, 'confirmed');
    assert.ok(result.graph.nodes.some((candidate) => candidate.id === 'module:app.main'));

    assert.strictEqual(result.metadata.agent.status, 'complete');
    assert.strictEqual(result.metadata.agent.totalTokens, 15);
    assert.strictEqual(result.metadata.entries.adapted, 2);
    assert.strictEqual(result.metadata.entries.dropped, 0);
    assert.ok(result.metadata.entries.facts > 0);
    assert.strictEqual(result.graph.analysis.status, 'complete');
  });

  test('a ghost citation is dropped and never reaches the graph', async () => {
    const { controller } = makeHarness([{ content: findingsResponse([GHOST_FINDING]) }]);

    const result = await controller.run();

    assert.ok(
      !result.graph.nodes.some((node) => node.id === 'service:app.services:Ghost'),
      'the unverifiable claim must not be rendered'
    );
    assert.ok(
      result.graph.nodes.every((node) => node.origin === 'deterministic'),
      'only deterministic facts may remain'
    );
    assert.strictEqual(result.metadata.entries.dropped, 1);
    assert.ok(
      result.metadata.diagnostics.some((diagnostic) => diagnostic.code === 'source_location_invalid'),
      'the drop must be reported, not swallowed'
    );
  });

  test('deterministic facts are mapped even when the agent returns no findings', async () => {
    const { controller } = makeHarness([{ content: findingsResponse([]) }]);

    const result = await controller.run();

    const nodeIds = result.graph.nodes.map((node) => node.id);
    assert.ok(nodeIds.includes('module:app.main'));
    assert.ok(nodeIds.includes('module:app.services.user_service'));
    assert.ok(nodeIds.includes('function:app.main:main'));
    assert.ok(nodeIds.includes('endpoint:app.main:GET:/users'));
    assert.strictEqual(result.graph.edges.length, 1, 'only the route_handler edge is deterministic here');
    assert.strictEqual(result.metadata.entries.adapted, 0);
    assert.strictEqual(result.graph.analysis.status, 'complete');
  });

  test('an index build failure surfaces as AnalysisError(index_build_failed)', async () => {
    const failing = new FakeIndexService(FIXTURE_INDEX, new Error('python not found'));
    const { controller } = makeHarness([{ content: findingsResponse([]) }], failing);

    await assert.rejects(
      () => controller.run(),
      (error: unknown) => {
        assert.ok(error instanceof AnalysisError);
        assert.strictEqual(error.code, 'index_build_failed');
        assert.ok(error.message.includes('python not found'));
        return true;
      }
    );
  });

  test('an already-cancelled signal stops before indexing', async () => {
    const { controller, indexService } = makeHarness([{ content: findingsResponse([]) }]);
    const abort = new AbortController();
    abort.abort();

    await assert.rejects(
      () => controller.run(abort.signal),
      (error: unknown) => {
        assert.ok(error instanceof AnalysisError);
        assert.strictEqual(error.code, 'cancelled');
        return true;
      }
    );
    assert.strictEqual(indexService.buildCalls, 0);
  });

  test('a provider failure yields a partial analysis with diagnostics, not a throw', async () => {
    const { controller } = makeHarness([
      { error: new ModelProviderError('authentication', 'invalid api key', { status: 401 }) },
    ]);

    const result = await controller.run();

    assert.strictEqual(result.metadata.agent.status, 'partial');
    assert.strictEqual(result.metadata.agent.terminationReason, 'provider_error');
    assert.strictEqual(result.graph.analysis.status, 'partial');
    assert.ok(
      result.metadata.diagnostics.some((diagnostic) => diagnostic.code === 'provider_error'),
      'the provider failure must be visible in the graph diagnostics'
    );
    assert.ok(
      result.graph.nodes.every((node) => node.origin === 'deterministic'),
      'no AI nodes may be fabricated when the run failed'
    );
  });
});
