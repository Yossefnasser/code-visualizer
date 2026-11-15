import * as assert from 'node:assert';

import { ModelProviderError, ModelProviderErrorKind } from '../analysis/modelProvider';
import { formatProviderDiagnostic } from '../analysis/providerDiagnostics';

const ALL_KINDS = [
  'authentication',
  'rate_limit',
  'timeout',
  'network',
  'server',
  'invalid_request',
  'invalid_response',
  'cancelled',
  'unknown',
] as const;

suite('formatProviderDiagnostic', () => {
  test('authentication points the user at their API key and includes the message', () => {
    const output = formatProviderDiagnostic(new ModelProviderError('authentication', 'Invalid credentials'));

    assert.ok(output.includes('API key'), `should tell the user where to look, got: ${output}`);
    assert.ok(output.includes('Invalid credentials'), `should include the sanitized message, got: ${output}`);
  });

  test('rate limit mentions the wait time when retryAfterMs is present', () => {
    const output = formatProviderDiagnostic(new ModelProviderError('rate_limit', 'Monthly quota exceeded', { retryAfterMs: 5000 }));

    assert.ok(output.includes('5000'), `should mention the wait time, got: ${output}`);
    assert.ok(output.includes('Monthly quota exceeded'), `should include the message, got: ${output}`);
  });

  test('rate limit omits the wait time cleanly when retryAfterMs is absent', () => {
    const output = formatProviderDiagnostic(new ModelProviderError('rate_limit', 'Monthly quota exceeded'));

    assert.ok(!output.includes('undefined'), `must not print undefined, got: ${output}`);
    assert.ok(!/\d+ ms/.test(output), `should not invent a wait time, got: ${output}`);
  });

  test('server mentions the HTTP status when present', () => {
    const output = formatProviderDiagnostic(new ModelProviderError('server', 'Internal server error', { status: 500 }));

    assert.ok(output.includes('HTTP 500'), `should mention the HTTP status, got: ${output}`);
  });

  test('server omits the HTTP status without printing undefined', () => {
    const output = formatProviderDiagnostic(new ModelProviderError('server', 'Internal server error'));

    assert.ok(!output.includes('undefined'), `must not print undefined, got: ${output}`);
    assert.ok(!output.includes('HTTP'), `should not mention HTTP, got: ${output}`);
  });

  test('timeout is actionable and includes the message', () => {
    const output = formatProviderDiagnostic(new ModelProviderError('timeout', 'Request exceeded 30s'));

    assert.ok(output.includes('timed out'), `should name the problem, got: ${output}`);
    assert.ok(output.includes('Request exceeded 30s'), `should include the message, got: ${output}`);
  });

  test('network tells the user to check their connection', () => {
    const output = formatProviderDiagnostic(new ModelProviderError('network', 'fetch failed'));

    assert.ok(output.includes('connection'), `should name the action, got: ${output}`);
    assert.ok(output.includes('fetch failed'), `should include the message, got: ${output}`);
  });

  test('invalid_request tells the user the request was rejected', () => {
    const output = formatProviderDiagnostic(new ModelProviderError('invalid_request', 'model not found'));

    assert.ok(output.includes('invalid'), `should name the problem, got: ${output}`);
    assert.ok(output.includes('model not found'), `should include the message, got: ${output}`);
  });

  test('invalid_response tells the user the provider answer was unusable', () => {
    const output = formatProviderDiagnostic(new ModelProviderError('invalid_response', 'malformed JSON'));

    assert.ok(output.includes('response'), `should name the problem, got: ${output}`);
    assert.ok(output.includes('malformed JSON'), `should include the message, got: ${output}`);
  });

  test('cancelled reports the cancellation', () => {
    const output = formatProviderDiagnostic(new ModelProviderError('cancelled', 'aborted by user'));

    assert.ok(output.includes('cancelled'), `should name the problem, got: ${output}`);
    assert.ok(output.includes('aborted by user'), `should include the message, got: ${output}`);
  });

  test('unknown has a sensible fallback', () => {
    const output = formatProviderDiagnostic(new ModelProviderError('unknown', 'something odd'));

    assert.ok(output.includes('unexpected'), `should stay honest about uncertainty, got: ${output}`);
    assert.ok(output.includes('something odd'), `should include the message, got: ${output}`);
  });

  test('every kind includes the message and never prints undefined', () => {
    for (const kind of ALL_KINDS) {
      const output = formatProviderDiagnostic(new ModelProviderError(kind, 'provider said X'));

      assert.ok(output.includes('provider said X'), `${kind} should include the message, got: ${output}`);
      assert.ok(!output.includes('undefined'), `${kind} must not print undefined, got: ${output}`);
    }
  });
});
