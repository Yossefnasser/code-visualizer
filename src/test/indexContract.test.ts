import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  INDEX_CONTRACT_VERSION,
  isIndexDocumentV1,
  validateIndexDocument,
} from '../analysis/indexContract';

function loadExample(name: string): unknown {
  const file = path.join(__dirname, '..', '..', 'packages', 'contracts', 'examples', name);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function minimalValid(): Record<string, unknown> {
  return {
    indexVersion: INDEX_CONTRACT_VERSION,
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

suite('IndexContract v1', () => {
  test('complete example validates', () => {
    const doc = loadExample('index-v1.complete.json');
    assert.deepStrictEqual(validateIndexDocument(doc), []);
    assert.strictEqual(isIndexDocumentV1(doc), true);
  });

  test('partial example validates (pending/failed scopes, unresolved relationship)', () => {
    const doc = loadExample('index-v1.partial.json');
    assert.deepStrictEqual(validateIndexDocument(doc), []);
  });

  test('minimal valid document validates', () => {
    assert.deepStrictEqual(validateIndexDocument(minimalValid()), []);
  });

  test('rejects wrong indexVersion', () => {
    const doc = { ...minimalValid(), indexVersion: '2.0' };
    const errors = validateIndexDocument(doc);
    assert.ok(errors.some((e) => e.path === '$.indexVersion'));
  });

  test('rejects missing coverage', () => {
    const doc = minimalValid();
    delete doc.coverage;
    const errors = validateIndexDocument(doc);
    assert.ok(errors.some((e) => e.path === '$.coverage'));
  });

  test('rejects unknown entryType', () => {
    const doc = minimalValid();
    (doc.entries as Record<string, unknown>[])[0].entryType = 'widget';
    const errors = validateIndexDocument(doc);
    assert.ok(errors.some((e) => e.path.includes('entryType')));
  });

  test('rejects duplicate entry ids', () => {
    const doc = minimalValid();
    const entry = (doc.entries as Record<string, unknown>[])[0];
    doc.entries = [entry, { ...entry }];
    const errors = validateIndexDocument(doc);
    assert.ok(errors.some((e) => e.message.includes('duplicate id')));
  });

  test('rejects relationship entry without details', () => {
    const doc = minimalValid();
    doc.entries = [
      {
        id: 'relationship:x',
        kind: 'interpretation',
        entryType: 'relationship',
        label: 'x',
        evidence: [],
        provenance: 'ai',
        status: 'inferred',
      },
    ];
    const errors = validateIndexDocument(doc);
    assert.ok(errors.some((e) => e.path.includes('details')));
  });

  test('rejects relationship with unknown relationshipType', () => {
    const doc = minimalValid();
    doc.entries = [
      {
        id: 'relationship:x',
        kind: 'interpretation',
        entryType: 'relationship',
        label: 'x',
        details: {
          relationshipType: 'teleports',
          sourceEntryId: 'a',
          targetEntryId: null,
          resolutionStatus: 'unresolved',
        },
        evidence: [],
        provenance: 'ai',
        status: 'unresolved',
      },
    ];
    const errors = validateIndexDocument(doc);
    assert.ok(errors.some((e) => e.path.includes('relationshipType')));
  });

  test('rejects confidence outside 0-1', () => {
    const doc = minimalValid();
    (doc.entries as Record<string, unknown>[])[0].confidence = 1.5;
    const errors = validateIndexDocument(doc);
    assert.ok(errors.some((e) => e.path.includes('confidence')));
  });

  test('rejects invalid coverage status', () => {
    const doc = minimalValid();
    (doc.coverage as Record<string, unknown>).scopes = [
      { id: 's', scope: 'app/', status: 'done' },
    ];
    const errors = validateIndexDocument(doc);
    assert.ok(errors.some((e) => e.path.includes('status')));
  });

  test('rejects non-object input', () => {
    assert.strictEqual(isIndexDocumentV1(null), false);
    assert.strictEqual(isIndexDocumentV1('nope'), false);
    assert.strictEqual(isIndexDocumentV1([]), false);
  });

  test('rejects missing parent reference', () => {
    const doc = minimalValid();
    (doc.entries as Record<string, unknown>[])[0].parentId = 'subsystem:missing';
    const errors = validateIndexDocument(doc);
    assert.ok(errors.some((e) => e.path.includes('parentId')));
  });

  test('rejects missing relationship source', () => {
    const doc = minimalValid();
    doc.entries = [
      ...(doc.entries as Record<string, unknown>[]),
      {
        id: 'relationship:x',
        kind: 'interpretation',
        entryType: 'relationship',
        label: 'x',
        details: { relationshipType: 'calls', sourceEntryId: 'missing', targetEntryId: 'module:app', resolutionStatus: 'resolved' },
        evidence: [],
        provenance: 'ai',
        status: 'inferred',
      },
    ];
    const errors = validateIndexDocument(doc);
    assert.ok(errors.some((e) => e.path.includes('sourceEntryId')));
  });

  test('rejects missing resolved relationship target', () => {
    const doc = minimalValid();
    doc.entries = [
      ...(doc.entries as Record<string, unknown>[]),
      {
        id: 'relationship:x',
        kind: 'interpretation',
        entryType: 'relationship',
        label: 'x',
        details: { relationshipType: 'calls', sourceEntryId: 'module:app', targetEntryId: 'missing', resolutionStatus: 'resolved' },
        evidence: [],
        provenance: 'ai',
        status: 'inferred',
      },
    ];
    const errors = validateIndexDocument(doc);
    assert.ok(errors.some((e) => e.path.includes('targetEntryId')));
  });

  test('rejects unresolved relationship with non-null target', () => {
    const doc = minimalValid();
    doc.entries = [
      ...(doc.entries as Record<string, unknown>[]),
      {
        id: 'relationship:x',
        kind: 'interpretation',
        entryType: 'relationship',
        label: 'x',
        details: { relationshipType: 'calls', sourceEntryId: 'module:app', targetEntryId: 'module:app', resolutionStatus: 'unresolved' },
        evidence: [],
        provenance: 'ai',
        status: 'unresolved',
      },
    ];
    const errors = validateIndexDocument(doc);
    assert.ok(errors.some((e) => e.path.includes('targetEntryId')));
  });

  test('rejects resolved relationship with null target', () => {
    const doc = minimalValid();
    doc.entries = [
      ...(doc.entries as Record<string, unknown>[]),
      {
        id: 'relationship:x',
        kind: 'interpretation',
        entryType: 'relationship',
        label: 'x',
        details: { relationshipType: 'calls', sourceEntryId: 'module:app', targetEntryId: null, resolutionStatus: 'resolved' },
        evidence: [],
        provenance: 'ai',
        status: 'inferred',
      },
    ];
    const errors = validateIndexDocument(doc);
    assert.ok(errors.some((e) => e.path.includes('targetEntryId')));
  });

  test('rejects invalid evidence structure', () => {
    const doc = minimalValid();
    (doc.entries as Record<string, unknown>[])[0].evidence = [{ description: 'no kind' }];
    const errors = validateIndexDocument(doc);
    assert.ok(errors.some((e) => e.path.includes('evidence')));
  });

  test('rejects duplicate IDs across different entry types', () => {
    const doc = minimalValid();
    doc.entries = [
      ...(doc.entries as Record<string, unknown>[]),
      {
        id: 'module:app',
        kind: 'interpretation',
        entryType: 'service',
        label: 'duplicate',
        evidence: [],
        provenance: 'ai',
        status: 'inferred',
      },
    ];
    const errors = validateIndexDocument(doc);
    assert.ok(errors.some((e) => e.message.includes('duplicate id')));
  });

  test('rejects relationship endpoint referencing another relationship', () => {
    const doc = minimalValid();
    doc.entries = [
      ...(doc.entries as Record<string, unknown>[]),
      {
        id: 'relationship:a',
        kind: 'interpretation',
        entryType: 'relationship',
        label: 'a',
        details: { relationshipType: 'calls', sourceEntryId: 'module:app', targetEntryId: 'module:app', resolutionStatus: 'resolved' },
        evidence: [],
        provenance: 'ai',
        status: 'inferred',
      },
      {
        id: 'relationship:b',
        kind: 'interpretation',
        entryType: 'relationship',
        label: 'b',
        details: { relationshipType: 'calls', sourceEntryId: 'relationship:a', targetEntryId: 'module:app', resolutionStatus: 'resolved' },
        evidence: [],
        provenance: 'ai',
        status: 'inferred',
      },
    ];
    const errors = validateIndexDocument(doc);
    assert.ok(errors.some((e) => e.message.includes('must not reference other relationships')));
  });
});
