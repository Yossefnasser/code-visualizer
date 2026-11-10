import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { DEFAULT_EXAMPLE_FILE, ExampleGraphError, loadExampleGraph } from '../analysis/exampleGraphProvider';

/** The repository root that contains the extension sources. */
function repoRoot(): string {
  // Tests compile to out/test/<file>.js, so root is two levels up.
  return path.join(__dirname, '..', '..');
}

suite('ExampleGraphProvider (prototype display path)', () => {
  test('loads the complete example and produces a Graph v2.0 document', () => {
    const graph = loadExampleGraph(repoRoot());

    assert.strictEqual(graph.schemaVersion, '2.0');
    assert.ok(graph.nodes.length > 0);
    assert.ok(graph.analysis);
    assert.strictEqual(graph.analysis.status, 'complete');
    assert.ok(graph.units.length > 0);
  });

  test('maps the expected node types from the example', () => {
    const graph = loadExampleGraph(repoRoot());

    const types = graph.nodes.map((n) => n.type).sort();
    assert.ok(types.includes('endpoint'));
    assert.ok(types.includes('service'));
    assert.ok(types.includes('module'));
    assert.ok(types.includes('subsystem'));
  });

  test('preserves origin, status, parentId, evidence, and source locations', () => {
    const graph = loadExampleGraph(repoRoot());

    const service = graph.nodes.find((n) => n.type === 'service');
    assert.ok(service);
    assert.strictEqual(service.origin, 'ai');
    assert.strictEqual(service.status, 'inferred');
    assert.strictEqual(service.parentId, 'subsystem:app.services');
    assert.ok(service.evidence && service.evidence.length > 0);
    assert.strictEqual(service.evidence![0].kind, 'ai_observation');
    assert.strictEqual(service.source?.path, 'app/services/user_service.py');

    const endpoint = graph.nodes.find((n) => n.type === 'endpoint');
    assert.ok(endpoint);
    assert.strictEqual(endpoint.origin, 'deterministic');
    assert.strictEqual(endpoint.status, 'confirmed');
    assert.strictEqual(endpoint.source?.path, 'app/api/users.py');
  });

  test('the example contains a semantic relationship edge that a display layer must hide', () => {
    const graph = loadExampleGraph(repoRoot());

    const callsEdge = graph.edges.find((e) => e.type === 'calls');
    assert.ok(callsEdge, 'the complete example carries one AI calls relationship');
    assert.strictEqual(callsEdge.origin, 'ai');
    assert.strictEqual(callsEdge.status, 'inferred', 'without FindingValidator it stays inferred');
    assert.ok(graph.edges.every((e) => e.type === 'calls'), 'no factual edges exist in this example');
  });

  test('units and diagnostics are preserved', () => {
    const graph = loadExampleGraph(repoRoot());
    assert.ok(graph.units.some((u) => u.id === 'scope:app' && u.status === 'complete'));
    assert.strictEqual(graph.diagnostics.length, 0);
  });

  test('loads the partial example with pending/failed scopes', () => {
    const graph = loadExampleGraph(repoRoot(), 'index-v1.partial.json');
    assert.strictEqual(graph.analysis.status, 'partial');
    assert.ok(graph.units.some((u) => u.status === 'pending'));
    assert.ok(graph.units.some((u) => u.status === 'failed'));
    assert.ok(graph.diagnostics.length > 0);
  });

  test('missing file raises ExampleGraphError with code file_not_found', () => {
    assert.throws(
      () => loadExampleGraph(repoRoot(), 'does-not-exist.json'),
      (error: unknown) => error instanceof ExampleGraphError && error.code === 'file_not_found',
    );
  });

  test('invalid JSON raises ExampleGraphError with code invalid_json', () => {
    const root = repoRoot();
    const target = path.join(root, 'packages', 'contracts', 'examples', 'broken.json');
    const original = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;

    try {
      fs.writeFileSync(target, '{ not json', 'utf8');
      assert.throws(
        () => loadExampleGraph(root, 'broken.json'),
        (error: unknown) => error instanceof ExampleGraphError && error.code === 'invalid_json',
      );
    } finally {
      if (original === null) {
        fs.unlinkSync(target);
      } else {
        fs.writeFileSync(target, original, 'utf8');
      }
    }
  });

  test('contract-invalid document raises ExampleGraphError with code invalid_contract', () => {
    const root = repoRoot();
    const target = path.join(root, 'packages', 'contracts', 'examples', 'broken2.json');

    try {
      fs.writeFileSync(target, JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(root, 'packages', 'contracts', 'examples', DEFAULT_EXAMPLE_FILE), 'utf8')), indexVersion: '9.9' }), 'utf8');
      assert.throws(
        () => loadExampleGraph(root, 'broken2.json'),
        (error: unknown) => error instanceof ExampleGraphError && error.code === 'invalid_contract',
      );
    } finally {
      fs.unlinkSync(target);
    }
  });
});
