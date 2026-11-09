import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { mapIndexToGraph } from '../analysis/indexToGraphMapper';
import { validateIndexDocument } from '../analysis/indexContract';

function loadExample(name: string): unknown {
  const file = path.join(__dirname, '..', '..', 'packages', 'contracts', 'examples', name);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function minimalIndexDoc(): Record<string, unknown> {
  return {
    indexVersion: '1.0',
    project: { root: '.', languages: ['python'] },
    indexer: { kind: 'ai', provider: 'openrouter', model: 'openai/gpt-4o-mini' },
    coverage: { scopes: [{ id: 'scope:app', scope: 'app/', status: 'complete' }] },
    entries: [
      {
        id: 'module:app',
        kind: 'fact',
        entryType: 'module',
        label: 'app',
        evidence: [{ kind: 'file_observed', description: 'Module observed' }],
        provenance: 'deterministic',
        status: 'confirmed',
      },
    ],
    diagnostics: [],
  };
}

suite('IndexToGraphMapper', () => {
  test('maps complete example to valid Graph v2.0', () => {
    const indexDoc = loadExample('index-v1.complete.json');
    const errors = validateIndexDocument(indexDoc);
    assert.deepStrictEqual(errors, []);

    const { graph, warnings } = mapIndexToGraph(indexDoc as any);
    assert.strictEqual(graph.schemaVersion, '2.0');
    assert.ok(graph.nodes.length > 0);
    assert.ok(graph.edges.length > 0);
    assert.ok(graph.units);
    assert.ok(graph.diagnostics);
    assert.ok(graph.analysis);
    // No warnings for supported types in the complete example
    assert.deepStrictEqual(warnings, []);
  });

  test('maps partial example with pending/failed scopes', () => {
    const indexDoc = loadExample('index-v1.partial.json');
    const errors = validateIndexDocument(indexDoc);
    assert.deepStrictEqual(errors, []);

    const { graph, warnings } = mapIndexToGraph(indexDoc as any);
    assert.strictEqual(graph.analysis.status, 'partial');
    assert.ok(graph.units);
    const pendingScope = graph.units.find((u) => u.status === 'pending');
    assert.ok(pendingScope);
    const failedScope = graph.units.find((u) => u.status === 'failed');
    assert.ok(failedScope);
    // The partial example has an unresolved relationship which produces a warning
    assert.ok(warnings.some((w) => w.includes('unresolved relationship')));
  });

  test('maps module entry to module node', () => {
    const { graph } = mapIndexToGraph(minimalIndexDoc() as any);
    const moduleNode = graph.nodes.find((n) => n.id === 'module:app');
    assert.ok(moduleNode);
    assert.strictEqual(moduleNode.type, 'module');
    assert.strictEqual(moduleNode.origin, 'deterministic');
    assert.strictEqual(moduleNode.status, 'confirmed');
  });

  test('maps route entry to endpoint node', () => {
    const indexDoc = {
      ...minimalIndexDoc(),
      entries: [
        ...(minimalIndexDoc().entries as any[]),
        {
          id: 'route:endpoint:app.api.users:GET:/users->function:app.api.users:list_users_endpoint',
          kind: 'fact',
          entryType: 'route',
          label: 'GET /users -> list_users_endpoint',
          source: { path: 'app/api/users.py', startLine: 9, endLine: 9 },
          evidence: [{ kind: 'fastapi_route_decorator', description: 'Decorator binds GET /users' }],
          provenance: 'deterministic',
          status: 'confirmed',
        },
      ],
    };
    const { graph } = mapIndexToGraph(indexDoc as any);
    const endpoint = graph.nodes.find((n) => n.type === 'endpoint');
    assert.ok(endpoint);
    assert.strictEqual(endpoint.type, 'endpoint');
    assert.strictEqual(endpoint.origin, 'deterministic');
  });

  test('maps model entry to database_model node', () => {
    const indexDoc = {
      ...minimalIndexDoc(),
      entries: [
        ...(minimalIndexDoc().entries as any[]),
        {
          id: 'database_model:app.models.user:User',
          kind: 'fact',
          entryType: 'model',
          label: 'User',
          details: { table: 'users' },
          source: { path: 'app/models/user.py', startLine: 1, endLine: 20 },
          evidence: [{ kind: 'sqlalchemy_model', description: 'SQLAlchemy model' }],
          provenance: 'deterministic',
          status: 'confirmed',
        },
      ],
    };
    const { graph } = mapIndexToGraph(indexDoc as any);
    const model = graph.nodes.find((n) => n.type === 'database_model');
    assert.ok(model);
    assert.strictEqual(model.type, 'database_model');
    assert.strictEqual(model.details?.table, 'users');
  });

  test('maps service interpretation to service node', () => {
    const indexDoc = {
      ...minimalIndexDoc(),
      entries: [
        ...(minimalIndexDoc().entries as any[]),
        {
          id: 'subsystem:app.services',
          kind: 'interpretation',
          entryType: 'subsystem',
          label: 'Services',
          evidence: [],
          provenance: 'ai',
          status: 'inferred',
        },
        {
          id: 'service:app.services.user_service:UserService',
          kind: 'interpretation',
          entryType: 'service',
          label: 'User service',
          details: { responsibility: 'User management' },
          parentId: 'subsystem:app.services',
          source: { path: 'app/services/user_service.py', startLine: 1, endLine: 40 },
          evidence: [{ kind: 'ai_observation', description: 'Holds user logic' }],
          provenance: 'ai',
          status: 'inferred',
          confidence: 0.8,
        },
      ],
    };
    const { graph } = mapIndexToGraph(indexDoc as any);
    const service = graph.nodes.find((n) => n.type === 'service');
    assert.ok(service);
    assert.strictEqual(service.type, 'service');
    assert.strictEqual(service.origin, 'ai');
    assert.strictEqual(service.status, 'inferred');
    assert.strictEqual(service.confidence, 0.8);
    assert.strictEqual(service.parentId, 'subsystem:app.services');
  });

  test('maps subsystem interpretation to subsystem node', () => {
    const indexDoc = {
      ...minimalIndexDoc(),
      entries: [
        ...(minimalIndexDoc().entries as any[]),
        {
          id: 'subsystem:app.services',
          kind: 'interpretation',
          entryType: 'subsystem',
          label: 'Services',
          details: { responsibility: 'Business logic' },
          source: { path: 'app/services/user_service.py', startLine: 1, endLine: 40 },
          evidence: [{ kind: 'ai_observation', description: 'Business logic services' }],
          provenance: 'ai',
          status: 'inferred',
        },
      ],
    };
    const { graph } = mapIndexToGraph(indexDoc as any);
    const subsystem = graph.nodes.find((n) => n.type === 'subsystem');
    assert.ok(subsystem);
    assert.strictEqual(subsystem.type, 'subsystem');
    assert.strictEqual(subsystem.origin, 'ai');
  });

  test('maps relationship entry to edge', () => {
    const indexDoc = {
      ...minimalIndexDoc(),
      entries: [
        ...(minimalIndexDoc().entries as any[]),
        {
          id: 'service:app.services.user_service:UserService',
          kind: 'interpretation',
          entryType: 'service',
          label: 'User service',
          evidence: [],
          provenance: 'ai',
          status: 'inferred',
        },
        {
          id: 'route:endpoint:app.api.users:GET:/users->function:app.api.users:list_users_endpoint',
          kind: 'fact',
          entryType: 'route',
          label: 'GET /users',
          evidence: [],
          provenance: 'deterministic',
          status: 'confirmed',
        },
        {
          id: 'relationship:route:endpoint:app.api.users:GET:/users->service:app.services.user_service:UserService',
          kind: 'interpretation',
          entryType: 'relationship',
          label: 'GET /users delegates to UserService',
          details: {
            relationshipType: 'calls',
            sourceEntryId: 'route:endpoint:app.api.users:GET:/users->function:app.api.users:list_users_endpoint',
            targetEntryId: 'service:app.services.user_service:UserService',
            resolutionStatus: 'resolved',
          },
          evidence: [{ kind: 'ai_observation', description: 'Endpoint delegates to service' }],
          provenance: 'ai',
          status: 'inferred',
        },
      ],
    };
    const { graph } = mapIndexToGraph(indexDoc as any);
    const edge = graph.edges.find((e) => e.type === 'calls');
    assert.ok(edge);
    assert.strictEqual(edge.type, 'calls');
    assert.strictEqual(edge.source, 'route:endpoint:app.api.users:GET:/users->function:app.api.users:list_users_endpoint');
    assert.strictEqual(edge.target, 'service:app.services.user_service:UserService');
    assert.strictEqual(edge.origin, 'ai');
    assert.strictEqual(edge.status, 'inferred');
  });

  test('unresolved relationship produces no edge (target missing)', () => {
    const indexDoc = {
      ...minimalIndexDoc(),
      entries: [
        ...(minimalIndexDoc().entries as any[]),
        {
          id: 'service:app.services.user_service:UserService',
          kind: 'interpretation',
          entryType: 'service',
          label: 'User service',
          evidence: [],
          provenance: 'ai',
          status: 'inferred',
        },
        {
          id: 'relationship:service:app.services.user_service:UserService->model:unknown',
          kind: 'interpretation',
          entryType: 'relationship',
          label: 'UserService uses an unresolved model',
          details: {
            relationshipType: 'uses_model',
            sourceEntryId: 'service:app.services.user_service:UserService',
            targetEntryId: null,
            resolutionStatus: 'unresolved',
          },
          evidence: [],
          provenance: 'ai',
          status: 'unresolved',
        },
      ],
    };
    const { graph, warnings } = mapIndexToGraph(indexDoc as any);
    assert.strictEqual(graph.edges.length, 0);
    // Unresolved relationships produce no edges and generate a warning
    assert.ok(warnings.some((w) => w.includes('unresolved relationship')));
  });

  test('preserves hierarchy via parentId', () => {
    const indexDoc = {
      ...minimalIndexDoc(),
      entries: [
        ...(minimalIndexDoc().entries as any[]),
        {
          id: 'subsystem:app.services',
          kind: 'interpretation',
          entryType: 'subsystem',
          label: 'Services',
          evidence: [],
          provenance: 'ai',
          status: 'inferred',
        },
        {
          id: 'service:app.services.user_service:UserService',
          kind: 'interpretation',
          entryType: 'service',
          label: 'User service',
          parentId: 'subsystem:app.services',
          evidence: [],
          provenance: 'ai',
          status: 'inferred',
        },
      ],
    };
    const { graph } = mapIndexToGraph(indexDoc as any);
    const service = graph.nodes.find((n) => n.id === 'service:app.services.user_service:UserService');
    assert.ok(service);
    assert.strictEqual(service.parentId, 'subsystem:app.services');
  });

  test('maps coverage scopes to units', () => {
    const indexDoc = {
      ...minimalIndexDoc(),
      coverage: {
        scopes: [
          { id: 'scope:app.services', scope: 'app/services/', status: 'complete' },
          { id: 'scope:app.models', scope: 'app/models/', status: 'partial', diagnostics: [{ severity: 'warning', code: 'budget_exhausted', message: 'Token budget reached' }] },
          { id: 'scope:app.api', scope: 'app/api/', status: 'pending' },
          { id: 'scope:legacy', scope: 'legacy/', status: 'failed', diagnostics: [{ severity: 'error', code: 'indexer_error', message: 'Parse failed' }] },
        ],
      },
    };
    const { graph } = mapIndexToGraph(indexDoc as any);
    assert.strictEqual(graph.units.length, 4);
    assert.strictEqual(graph.units.find((u) => u.id === 'scope:app.services')?.status, 'complete');
    assert.strictEqual(graph.units.find((u) => u.id === 'scope:app.models')?.status, 'partial');
    assert.strictEqual(graph.units.find((u) => u.id === 'scope:app.api')?.status, 'pending');
    assert.strictEqual(graph.units.find((u) => u.id === 'scope:legacy')?.status, 'failed');
    assert.ok(graph.units.find((u) => u.id === 'scope:app.models')?.diagnostics?.length);
    assert.ok(graph.units.find((u) => u.id === 'scope:legacy')?.diagnostics?.length);
  });

  test('maps diagnostics', () => {
    const indexDoc = {
      ...minimalIndexDoc(),
      diagnostics: [
        { severity: 'warning', code: 'budget_exhausted', message: 'Token budget reached', scope: 'scope:app.models' },
      ],
    };
    const { graph } = mapIndexToGraph(indexDoc as any);
    assert.strictEqual(graph.diagnostics.length, 1);
    assert.strictEqual(graph.diagnostics[0].code, 'budget_exhausted');
    assert.strictEqual(graph.diagnostics[0].scope, 'scope:app.models');
  });

  test('edge-category fact entries (import) produce no node and no warning', () => {
    // Import information reaches the graph as `imports` relationship edges
    // (relationshipType: "imports"), not as nodes — so an `import` fact entry
    // is intentionally skipped without an "unsupported entry type" warning.
    const indexDoc = {
      ...minimalIndexDoc(),
      entries: [
        ...(minimalIndexDoc().entries as any[]),
        {
          id: 'import:app:widget',
          kind: 'fact',
          entryType: 'import',
          label: 'import widget',
          evidence: [],
          provenance: 'deterministic',
          status: 'confirmed',
        },
      ],
    };
    const { graph, warnings } = mapIndexToGraph(indexDoc as any);
    assert.ok(!warnings.some((w) => w.includes('Unsupported entry type')));
    assert.strictEqual(graph.nodes.length, 1); // only the module node
  });

  test('duplicate node ids are rejected by validation', () => {
    // Duplicate IDs are caught by validateIndexDocument before the mapper runs
    // So we test that the validation catches it
    const indexDoc = {
      ...minimalIndexDoc(),
      entries: [
        ...(minimalIndexDoc().entries as any[]),
        {
          id: 'module:app',
          kind: 'fact',
          entryType: 'module',
          label: 'app duplicate',
          evidence: [],
          provenance: 'deterministic',
          status: 'confirmed',
        },
      ],
    };
    assert.throws(
      () => mapIndexToGraph(indexDoc as any),
      /duplicate id/
    );
  });

  test('empty entries produces minimal valid graph', () => {
    const indexDoc = {
      ...minimalIndexDoc(),
      entries: [],
    };
    const { graph } = mapIndexToGraph(indexDoc as any);
    assert.strictEqual(graph.nodes.length, 0);
    assert.strictEqual(graph.edges.length, 0);
    assert.strictEqual(graph.analysis.status, 'complete');
  });

  test('invalid input throws (via validateIndexDocument)', () => {
    const invalidDoc = { ...minimalIndexDoc(), indexVersion: '2.0' };
    assert.throws(
      () => mapIndexToGraph(invalidDoc as any),
      /Invalid Index Contract v1 document/
    );
  });
});