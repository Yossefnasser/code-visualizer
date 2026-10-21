import * as assert from 'assert';

import { ModelProviderError, ModelRequest } from '../analysis/modelProvider';
import { OpenRouterProvider, OpenRouterProviderOptions } from '../analysis/openRouterProvider';

interface RecordedCall {
	url: string;
	body: Record<string, unknown>;
	headers: Record<string, string>;
}

interface FakeHttp {
	calls: RecordedCall[];
	delays: number[];
	fetchImpl: typeof fetch;
}

type FetchHandler = (init?: RequestInit) => Response | Promise<Response>;

/** Builds a fake fetch that replays scripted handlers in order. */
function fakeFetch(handlers: FetchHandler[]): FakeHttp {
	const http: FakeHttp = { calls: [], delays: [], fetchImpl: async () => new Response() };
	http.fetchImpl = async (input, init): Promise<Response> => {
		const index = http.calls.length;
		http.calls.push({
			url: String(input),
			body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
			headers: (init?.headers ?? {}) as Record<string, string>,
		});
		const handler = handlers[index];
		if (!handler) {
			throw new Error(`Unexpected fetch call #${index + 1}`);
		}
		return handler(init);
	};
	return http;
}

function okCompletion(content: string, extra?: { cost?: number; model?: string }): Response {
	return new Response(
		JSON.stringify({
			choices: [{ message: { content }, finish_reason: 'stop' }],
			model: extra?.model ?? 'openai/gpt-4o-mini',
			usage: {
				prompt_tokens: 10,
				completion_tokens: 4,
				total_tokens: 14,
				...(extra?.cost !== undefined ? { cost: extra.cost } : {}),
			},
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } }
	);
}

function errorResponse(status: number, message: string, headers?: Record<string, string>): Response {
	return new Response(JSON.stringify({ error: { message } }), {
		status,
		headers: { 'content-type': 'application/json', ...headers },
	});
}

function abortError(): Error {
	const error = new Error('This operation was aborted');
	error.name = 'AbortError';
	return error;
}

function makeProvider(
	handlers: FetchHandler[] = [],
	overrides: Partial<OpenRouterProviderOptions> = {}
): { provider: OpenRouterProvider; http: FakeHttp } {
	const http = fakeFetch(handlers);
	const provider = new OpenRouterProvider({
		apiKey: 'test-key',
		model: 'openai/gpt-4o-mini',
		fetchImpl: http.fetchImpl,
		sleep: async (ms: number): Promise<void> => {
			http.delays.push(ms);
		},
		...overrides,
	});
	return { provider, http };
}

async function expectProviderError(kind: string, run: () => Promise<unknown>): Promise<ModelProviderError> {
	try {
		await run();
	} catch (error) {
		assert.ok(error instanceof ModelProviderError, `expected ModelProviderError, got ${String(error)}`);
		assert.strictEqual(error.kind, kind);
		return error;
	}
	throw new Error(`expected ${kind} error, but nothing was thrown`);
}

suite('OpenRouterProvider', () => {
	const request: ModelRequest = { messages: [{ role: 'user', content: 'hello' }] };

	test('returns content, mapped usage and cost', async () => {
		const { provider, http } = makeProvider([
			() => okCompletion('{"ok":true}', { cost: 0.0012 }),
		]);
		const response = await provider.complete(request);
		assert.strictEqual(response.content, '{"ok":true}');
		assert.strictEqual(response.model, 'openai/gpt-4o-mini');
		assert.strictEqual(response.finishReason, 'stop');
		assert.deepStrictEqual(response.usage, {
			promptTokens: 10,
			completionTokens: 4,
			totalTokens: 14,
			costUSD: 0.0012,
		});
		assert.strictEqual(http.calls.length, 1);
		assert.strictEqual(http.calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
		const auth = http.calls[0].headers['Authorization'];
		assert.strictEqual(auth, 'Bearer test-key');
		assert.strictEqual(http.calls[0].body.model, 'openai/gpt-4o-mini');
	});

	test('sends json_schema response_format when a schema is provided', async () => {
		const { provider, http } = makeProvider([() => okCompletion('{}')]);
		await provider.complete({
			...request,
			jsonSchema: { name: 'findings', schema: { type: 'object' } },
		});
		const body = http.calls[0].body as {
			response_format?: { type?: string; json_schema?: { name?: string; strict?: boolean } };
			provider?: { require_parameters?: boolean };
		};
		assert.strictEqual(body.response_format?.type, 'json_schema');
		assert.strictEqual(body.response_format?.json_schema?.name, 'findings');
		assert.strictEqual(body.response_format?.json_schema?.strict, true);
		assert.strictEqual(body.provider?.require_parameters, true);
	});

	test('omits response_format when structured output is disabled', async () => {
		const { provider, http } = makeProvider([() => okCompletion('{}')], {
			structuredOutput: false,
		});
		await provider.complete({ ...request, jsonSchema: { name: 'x', schema: {} } });
		const body = http.calls[0].body as Record<string, unknown>;
		assert.strictEqual('response_format' in body, false);
		assert.strictEqual('provider' in body, false);
	});

	test('retries 429 honoring Retry-After, then succeeds', async () => {
		const { provider, http } = makeProvider([
			() => errorResponse(429, 'slow down', { 'retry-after': '1' }),
			() => okCompletion('done'),
		]);
		const response = await provider.complete(request);
		assert.strictEqual(response.content, 'done');
		assert.strictEqual(http.calls.length, 2);
		assert.deepStrictEqual(http.delays, [1000]);
	});

	test('does not retry authentication failures', async () => {
		const { provider, http } = makeProvider([
			() => errorResponse(401, 'invalid api key'),
		]);
		const error = await expectProviderError('authentication', () => provider.complete(request));
		assert.strictEqual(error.status, 401);
		assert.ok(error.message.includes('invalid api key'));
		assert.strictEqual(http.calls.length, 1);
	});

	test('surfaces request rejection as actionable invalid_request without retry', async () => {
		const { provider, http } = makeProvider([
			() => errorResponse(400, 'response_format is not supported by this model'),
		]);
		const error = await expectProviderError('invalid_request', () =>
			provider.complete({ ...request, jsonSchema: { name: 'x', schema: {} } })
		);
		assert.ok(error.message.includes('response_format is not supported by this model'));
		assert.strictEqual(http.calls.length, 1);
	});

	test('times out per attempt and reports timeout after retries', async () => {
		const hang: FetchHandler = (init): Promise<Response> =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(abortError()), { once: true });
			});
		const { provider, http } = makeProvider([hang, hang], { timeoutMs: 5, maxRetries: 1 });
		const error = await expectProviderError('timeout', () => provider.complete(request));
		assert.ok(error.message.includes('timed out'));
		assert.strictEqual(http.calls.length, 2);
	});

	test('maps external cancellation to cancelled without retrying', async () => {
		const { provider, http } = makeProvider();
		const controller = new AbortController();
		controller.abort();
		await expectProviderError('cancelled', () =>
			provider.complete(request, { signal: controller.signal })
		);
		assert.strictEqual(http.calls.length, 0);
	});

	test('retries network failures then succeeds', async () => {
		const { provider, http } = makeProvider([
			() => Promise.reject(new TypeError('fetch failed')),
			() => okCompletion('recovered'),
		]);
		const response = await provider.complete(request);
		assert.strictEqual(response.content, 'recovered');
		assert.strictEqual(http.calls.length, 2);
	});

	test('rejects immediately when the API key is missing', async () => {
		const { provider, http } = makeProvider([], { apiKey: '' });
		await expectProviderError('authentication', () => provider.complete(request));
		assert.strictEqual(http.calls.length, 0);
	});

	test('retries malformed JSON and surfaces invalid_response when exhausted', async () => {
		const { provider, http } = makeProvider(
			[
				() => new Response('<html>gateway error</html>', { status: 200 }),
				() => okCompletion('second try'),
			],
			{ maxRetries: 1 }
		);
		const response = await provider.complete(request);
		assert.strictEqual(response.content, 'second try');
		assert.strictEqual(http.calls.length, 2);
	});
});
