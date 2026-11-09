import * as assert from 'node:assert';

import { AgentFinding, AgentRunner } from '../analysis/agentRunner';
import { adaptAgentFindings, AdapterOptions } from '../analysis/agentFindingAdapter';
import { validateIndexDocument } from '../analysis/indexContract';
import { ModelProvider, ModelRequest, ModelResponse } from '../analysis/modelProvider';
import { IndexServiceInterface } from '../analysis/indexService';

const OPTIONS: AdapterOptions = {
  project: { root: '.', languages: ['python'] },
  indexer: { kind: 'ai', provider: 'openrouter', model: 'openai/gpt-4o-mini' },
  coverage: { scopes: [{ id: 'scope:app', scope: 'app/', status: 'complete' }] },
};

function nodeFinding(overrides: Partial<AgentFinding> = {}): AgentFinding {
  return {
    id: 'service:app:UserService',
    type: 'node',
    proposedType: 'service',
    label: 'User service',
    description: 'User management logic',
    source: { path: 'app/user_service.py', startLine: 1, endLine: 40 },
    evidence: [{ kind: 'ai_observation', description: 'Holds user logic' }],
    status: 'inferred',
    confidence: 0.8,
    ...overrides,
  };
}

suite('AgentFindingAdapter', () => {
  test('maps a node finding to an interpretation entry', () => {
    const { document, excludedFindingIds } = adaptAgentFindings([nodeFinding()], OPTIONS);
    assert.deepStrictEqual(excludedFindingIds, []);
    assert.strictEqual(document.entries.length, 1);
    const entry = document.entries[0];
    assert.strictEqual(entry.kind, 'interpretation');
    assert.strictEqual(entry.entryType, 'service');
    assert.strictEqual(entry.provenance, 'ai');
    assert.strictEqual(entry.status, 'inferred');
    assert.strictEqual(entry.confidence, 0.8);
    assert.deepStrictEqual(validateIndexDocument(document), []);
  });

  test('maps endpoint proposedType to route entryType', () => {
    const { document } = adaptAgentFindings([nodeFinding({ id: 'route:x', proposedType: 'endpoint' })], OPTIONS);
    assert.strictEqual(document.entries[0].entryType, 'route');
  });

  test('preserves unresolved status without upgrading', () => {
    const { document } = adaptAgentFindings([nodeFinding({ status: 'unresolved' })], OPTIONS);
    assert.strictEqual(document.entries[0].status, 'unresolved');
  });

  test('maps an edge with endpoints to a resolved relationship', () => {
    const edge = {
      ...nodeFinding({ id: 'relationship:x', type: 'edge' as const, proposedType: 'calls' }),
      sourceEntryId: 'service:app:UserService',
      targetEntryId: 'service:app:OtherService',
    } as unknown as AgentFinding;
    const { document, excludedFindingIds } = adaptAgentFindings(
      [nodeFinding(), nodeFinding({ id: 'service:app:OtherService' }), edge],
      OPTIONS
    );
    assert.deepStrictEqual(excludedFindingIds, []);
    const rel = document.entries.find((e) => e.id === 'relationship:x');
    assert.ok(rel);
    assert.strictEqual(rel.entryType, 'relationship');
    assert.strictEqual(rel.details?.relationshipType, 'calls');
    assert.strictEqual(rel.details?.sourceEntryId, 'service:app:UserService');
    assert.strictEqual(rel.details?.targetEntryId, 'service:app:OtherService');
    assert.strictEqual(rel.details?.resolutionStatus, 'resolved');
    assert.deepStrictEqual(validateIndexDocument(document), []);
  });

  test('maps an edge without target to an unresolved relationship', () => {
    const edge = {
      ...nodeFinding({ id: 'relationship:x', type: 'edge' as const, proposedType: 'uses_model', status: 'unresolved' as const }),
      sourceEntryId: 'service:app:UserService',
      targetEntryId: null,
    } as unknown as AgentFinding;
    const { document } = adaptAgentFindings([nodeFinding(), edge], OPTIONS);
    const rel = document.entries.find((e) => e.id === 'relationship:x');
    assert.ok(rel);
    assert.strictEqual(rel.details?.resolutionStatus, 'unresolved');
    assert.strictEqual(rel.details?.targetEntryId, null);
    assert.strictEqual(rel.status, 'unresolved');
  });

  test('excludes edges without endpoints with a diagnostic (never fabricates)', () => {
    const edge = nodeFinding({ id: 'relationship:x', type: 'edge', proposedType: 'calls' });
    const { document, diagnostics, excludedFindingIds } = adaptAgentFindings([edge], OPTIONS);
    assert.deepStrictEqual(excludedFindingIds, ['relationship:x']);
    assert.strictEqual(document.entries.length, 0);
    assert.ok(diagnostics.some((d) => d.code === 'unmappable_edge_missing_endpoints'));
    assert.deepStrictEqual(validateIndexDocument(document), []);
  });

  test('excludes unknown node types with a diagnostic', () => {
    const { document, diagnostics, excludedFindingIds } = adaptAgentFindings(
      [nodeFinding({ proposedType: 'widget' })],
      OPTIONS
    );
    assert.deepStrictEqual(excludedFindingIds, ['service:app:UserService']);
    assert.strictEqual(document.entries.length, 0);
    assert.ok(diagnostics.some((d) => d.code === 'unmappable_node_type'));
  });

  test('excludes duplicate IDs with a diagnostic', () => {
    const { document, diagnostics, excludedFindingIds } = adaptAgentFindings(
      [nodeFinding(), nodeFinding()],
      OPTIONS
    );
    assert.strictEqual(document.entries.length, 1);
    assert.deepStrictEqual(excludedFindingIds, ['service:app:UserService']);
    assert.ok(diagnostics.some((d) => d.code === 'duplicate_finding_id'));
  });

  test('excludes malformed findings without an id', () => {
    const bad = { ...nodeFinding(), id: '' } as AgentFinding;
    const { document, diagnostics } = adaptAgentFindings([bad], OPTIONS);
    assert.strictEqual(document.entries.length, 0);
    assert.ok(diagnostics.some((d) => d.code === 'malformed_finding'));
  });

  test('uses explicit project/indexer/coverage inputs verbatim', () => {
    const { document } = adaptAgentFindings([nodeFinding()], {
      project: { root: '/repo', languages: ['python', 'typescript'] },
      indexer: { kind: 'hybrid' },
      coverage: { scopes: [{ id: 's1', scope: 'app/', status: 'pending' }] },
    });
    assert.strictEqual(document.project.root, '/repo');
    assert.strictEqual(document.indexer.kind, 'hybrid');
    assert.strictEqual(document.coverage.scopes[0].status, 'pending');
  });

  test('throws when the adapted document would be invalid', () => {
    assert.throws(
      () =>
        adaptAgentFindings([nodeFinding()], {
          ...OPTIONS,
          coverage: { scopes: [{ id: 's', scope: 'app/', status: 'done' as never }] },
        }),
      /invalid/
    );
  });

  test('integration: AgentRunner findings convert to a valid Index Contract document', async () => {
    const findingsJson = JSON.stringify({
      findings: [
        {
          id: 'service:app:UserService',
          type: 'node',
          proposedType: 'service',
          label: 'User service',
          description: 'User management logic',
          source: { path: 'app/user_service.py', startLine: 1, endLine: 40 },
          evidence: [{ kind: 'ai_observation', description: 'Holds user logic' }],
          status: 'inferred',
          confidence: 0.8,
        },
      ],
    });
    const provider: ModelProvider = {
      id: 'fake',
      async complete(_request: ModelRequest): Promise<ModelResponse> {
        return {
          content: findingsJson,
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          finishReason: 'stop',
          model: 'fake-model',
        };
      },
    };
    const indexService = {
      hasIndex: () => true,
      getRepoOverview: () => ({}),
      queryIndex: async () => ({ results: [], total: 0 }),
    } as unknown as IndexServiceInterface;
    const runner = new AgentRunner({
      modelProvider: provider,
      indexService,
      workspaceRoot: '.',
    });
    const result = await runner.run();
    assert.strictEqual(result.findings.length, 1);
    const { document } = adaptAgentFindings(result.findings, OPTIONS);
    assert.deepStrictEqual(validateIndexDocument(document), []);
    assert.strictEqual(document.entries[0].entryType, 'service');
  });
});
