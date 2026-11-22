/**
 * Tests for the analyze-command helpers: user-facing outcome text, failure
 * classification, and the privacy disclosure text.
 *
 * Pure functions, no VS Code, no provider calls.
 */

import * as assert from 'assert';
import {
  PRIVACY_DISCLOSURE_ACCEPTED_KEY,
  PRIVACY_DISCLOSURE_MESSAGE,
  formatAnalysisFailure,
  formatAnalysisOutcome,
} from '../analysis/analysisCommandSupport';
import { AnalysisError, AnalysisRunResult } from '../analysis/analysisController';
import { IndexBackendError } from '../analysis/indexBackend';
import { ModelProviderError } from '../analysis/modelProvider';

function runResult(overrides: { costUSD?: number; status?: 'complete' | 'partial' | 'failed' } = {}): AnalysisRunResult {
  const status = overrides.status ?? 'partial';
  return {
    graph: {
      schemaVersion: '2.0',
      project: { root: '/test/project', languages: ['python'] },
      analysis: { status },
      nodes: [],
      edges: [],
      units: [],
      diagnostics: [],
    },
    document: {
      indexVersion: '1.0',
      project: { root: '/test/project', languages: ['python'] },
      indexer: { kind: 'hybrid' },
      coverage: { scopes: [] },
      entries: [],
      diagnostics: [],
    },
    metadata: {
      status,
      agent: {
        turns: 3,
        toolCalls: 5,
        totalTokens: 1234,
        ...(overrides.costUSD !== undefined ? { totalCostUSD: overrides.costUSD } : {}),
        durationMs: 2000,
        status,
        diagnostics: [],
      },
      index: { files: 2, symbols: 3, endpoints: 1, models: 0, references: 2, diagnostics: 0 },
      entries: { facts: 6, adapted: 2, merged: 8, validated: 7, dropped: 1, repaired: 0, demoted: 0, promoted: 1 },
      graph: { nodes: 0, edges: 0 },
      diagnostics: [],
      warnings: [],
    },
  };
}

suite('analysisCommandSupport', () => {
  test('outcome text reports status, counts, usage and cost', () => {
    const text = formatAnalysisOutcome(runResult({ costUSD: 0.01234 }));

    assert.ok(text.includes('analysis partial'));
    assert.ok(text.includes('0 node(s)'));
    assert.ok(text.includes('6 fact(s)'));
    assert.ok(text.includes('2 AI finding(s)'));
    assert.ok(text.includes('1234 token(s)'));
    assert.ok(text.includes('~$0.0123'));
  });

  test('outcome text omits cost when the provider reported none', () => {
    const text = formatAnalysisOutcome(runResult());

    assert.ok(!text.includes('$'), 'no cost must be printed when cost is unknown');
  });

  test('cancellation is reported plainly, not as an error', () => {
    assert.strictEqual(formatAnalysisFailure(new AnalysisError('cancelled', 'aborted')), 'Analysis cancelled.');
  });

  test('a wrapped missing-Python failure gets the install/PATH hint', () => {
    const error = new AnalysisError(
      'index_build_failed',
      'Failed to build the code index: spawn python ENOENT',
      new IndexBackendError('python_not_found', 'spawn python ENOENT')
    );

    const text = formatAnalysisFailure(error);
    assert.ok(text.includes('Python was not found'));
    assert.ok(text.includes('PATH'));
  });

  test('an index failure without a typed cause keeps the phase and the detail', () => {
    const error = new AnalysisError('index_build_failed', 'Failed to build the code index: disk on fire', new Error('disk on fire'));

    const text = formatAnalysisFailure(error);
    assert.ok(text.startsWith('Could not build the code index:'));
    assert.ok(text.includes('disk on fire'));
  });

  test('a provider failure is rendered by formatProviderDiagnostic', () => {
    const error = new AnalysisError(
      'agent_run_failed',
      'The analysis agent failed: boom',
      new ModelProviderError('authentication', 'invalid api key', { status: 401 })
    );

    const text = formatAnalysisFailure(error);
    assert.ok(text.includes('Authentication failed'));
    assert.ok(text.includes('API key'));
  });

  test('an unknown error falls back to its message', () => {
    assert.strictEqual(formatAnalysisFailure(new Error('something odd')), 'something odd');
    assert.strictEqual(formatAnalysisFailure('a string failure'), 'a string failure');
  });

  test('a cyclic cause chain terminates', () => {
    const error = new Error('cyclic');
    (error as Error & { cause?: unknown }).cause = error;

    assert.strictEqual(formatAnalysisFailure(error), 'cyclic');
  });

  test('the privacy disclosure states provider, excerpts, telemetry and the exclude caveat', () => {
    assert.ok(PRIVACY_DISCLOSURE_MESSAGE.includes('OpenRouter'));
    assert.ok(PRIVACY_DISCLOSURE_MESSAGE.includes('source-code excerpts'));
    assert.ok(PRIVACY_DISCLOSURE_MESSAGE.includes('no telemetry'));
    assert.ok(PRIVACY_DISCLOSURE_MESSAGE.includes('Exclude-pattern enforcement is not available yet'));
  });

  test('the disclosure acceptance key is namespaced', () => {
    assert.ok(PRIVACY_DISCLOSURE_ACCEPTED_KEY.startsWith('codeVisualizer.'));
  });
});
