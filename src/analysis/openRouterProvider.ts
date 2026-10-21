import {
	CompleteOptions,
	isRetryableProviderError,
	ModelProvider,
	ModelProviderError,
	ModelRequest,
	ModelResponse,
	TokenUsage,
} from './modelProvider';

export interface OpenRouterProviderOptions {
	/** API key from SecretStorage; never logged or persisted by this class. */
	readonly apiKey: string;
	/** Model id, e.g. "openai/gpt-4o-mini". */
	readonly model: string;
	/** Default completion cap per call (a request may lower it). */
	readonly maxTokens?: number;
	/** Per-attempt timeout in milliseconds. Default 60000. */
	readonly timeoutMs?: number;
	/** Extra attempts after the first for retryable failures. Default 2. */
	readonly maxRetries?: number;
	readonly temperature?: number;
	/** API base URL; default "https://openrouter.ai/api/v1". */
	readonly baseUrl?: string;
	/**
	 * Send `response_format` json_schema when a request carries a schema.
	 * Set false for models without structured-output support. Default true.
	 */
	readonly structuredOutput?: boolean;
	/** Optional app identity headers (HTTP-Referer / X-Title). */
	readonly httpReferer?: string;
	readonly title?: string;
	/** Injectable for tests. */
	readonly fetchImpl?: typeof fetch;
	/** Injectable delay so retry tests run instantly. */
	readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 8_000;
const MAX_SERVER_MESSAGE_CHARS = 500;

/**
 * OpenRouter chat-completions provider over plain HTTP (no SDK, per AGENTS.md).
 *
 * Single non-streaming request per `complete()` call with bounded timeout and
 * retries on transient failures (429/5xx/network/timeout). Structured output
 * is requested via `response_format: json_schema`, routed only to endpoints
 * that advertise support (`provider.require_parameters`).
 */
export class OpenRouterProvider implements ModelProvider {
	readonly id = 'openrouter';

	private readonly options: OpenRouterProviderOptions;

	constructor(options: OpenRouterProviderOptions) {
		if (!options.model) {
			throw new ModelProviderError('invalid_request', 'OpenRouter model id must not be empty.');
		}
		this.options = options;
	}

	async complete(request: ModelRequest, options?: CompleteOptions): Promise<ModelResponse> {
		if (!this.options.apiKey) {
			throw new ModelProviderError(
				'authentication',
				'OpenRouter API key is not configured. Run "Code Visualizer: Set OpenRouter API Key" first.'
			);
		}

		const body = this.buildBody(request);
		const maxRetries = this.options.maxRetries ?? DEFAULT_MAX_RETRIES;
		let delayMs = 0;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			if (options?.signal?.aborted) {
				throw new ModelProviderError('cancelled', 'Model request was cancelled.');
			}
			if (attempt > 0 && delayMs > 0) {
				await this.sleep(delayMs);
			}
			try {
				return await this.attempt(body, options);
			} catch (error) {
				const providerError = this.asProviderError(error);
				if (!isRetryableProviderError(providerError) || attempt === maxRetries) {
					throw providerError;
				}
				delayMs = providerError.retryAfterMs ?? BASE_RETRY_DELAY_MS * 2 ** attempt;
				delayMs = Math.min(delayMs, MAX_RETRY_DELAY_MS);
			}
		}

		// Unreachable: the loop either returns or throws on the final attempt.
		throw new ModelProviderError('unknown', 'Model request failed without a response.');
	}

	private buildBody(request: ModelRequest): Record<string, unknown> {
		const body: Record<string, unknown> = {
			model: this.options.model,
			messages: request.messages.map((message) => ({
				role: message.role,
				content: message.content,
			})),
		};

		const maxTokens = request.maxTokens ?? this.options.maxTokens;
		if (maxTokens !== undefined) {
			body.max_tokens = maxTokens;
		}
		const temperature = request.temperature ?? this.options.temperature;
		if (temperature !== undefined) {
			body.temperature = temperature;
		}

		if (request.jsonSchema && this.options.structuredOutput !== false) {
			body.response_format = {
				type: 'json_schema',
				json_schema: {
					name: request.jsonSchema.name,
					strict: request.jsonSchema.strict ?? true,
					schema: request.jsonSchema.schema,
				},
			};
			// Only route to endpoints that actually advertise the feature.
			body.provider = { require_parameters: true };
		}

		return body;
	}

	private async attempt(body: Record<string, unknown>, options?: CompleteOptions): Promise<ModelResponse> {
		const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const onExternalAbort = (): void => controller.abort();
		options?.signal?.addEventListener('abort', onExternalAbort, { once: true });

		let response: Response;
		try {
			const fetchImpl = this.options.fetchImpl ?? fetch;
			response = await fetchImpl(`${this.baseUrl()}/chat/completions`, {
				method: 'POST',
				headers: this.headers(),
				body: JSON.stringify(body),
				signal: controller.signal,
			});
		} catch (error) {
			if (isAbortError(error)) {
				if (options?.signal?.aborted) {
					throw new ModelProviderError('cancelled', 'Model request was cancelled.', { cause: error });
				}
				throw new ModelProviderError(
					'timeout',
					`OpenRouter request timed out after ${timeoutMs}ms.`,
					{ cause: error }
				);
			}
			throw new ModelProviderError(
				'network',
				`Network error contacting OpenRouter: ${errorMessage(error)}`,
				{ cause: error }
			);
		} finally {
			clearTimeout(timer);
			options?.signal?.removeEventListener('abort', onExternalAbort);
		}

		return this.handleResponse(response);
	}

	private async handleResponse(response: Response): Promise<ModelResponse> {
		if (!response.ok) {
			const serverMessage = await readServerErrorMessage(response);
			const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
			const details = serverMessage ? `: ${serverMessage}` : '';
			const status = response.status;

			if (status === 401 || status === 403) {
				throw new ModelProviderError(
					'authentication',
					`OpenRouter rejected the API key (HTTP ${status})${details}`,
					{ status }
				);
			}
			if (status === 429) {
				throw new ModelProviderError(
					'rate_limit',
					`OpenRouter rate limit exceeded (HTTP 429)${details}`,
					{ status, retryAfterMs }
				);
			}
			if (status >= 500) {
				throw new ModelProviderError('server', `OpenRouter server error (HTTP ${status})${details}`, {
					status,
					retryAfterMs,
				});
			}
			throw new ModelProviderError(
				'invalid_request',
				`OpenRouter rejected the request (HTTP ${status})${details}`,
				{ status }
			);
		}

		let payload: unknown;
		try {
			payload = await response.json();
		} catch (error) {
			throw new ModelProviderError(
				'invalid_response',
				'OpenRouter returned a malformed JSON response.',
				{ cause: error }
			);
		}

		return parseCompletion(payload, this.options.model);
	}

	private baseUrl(): string {
		return (this.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
	}

	private headers(): Record<string, string> {
		const headers: Record<string, string> = {
			Authorization: `Bearer ${this.options.apiKey}`,
			'Content-Type': 'application/json',
		};
		if (this.options.httpReferer) {
			headers['HTTP-Referer'] = this.options.httpReferer;
		}
		if (this.options.title) {
			headers['X-Title'] = this.options.title;
		}
		return headers;
	}

	private sleep(ms: number): Promise<void> {
		if (this.options.sleep) {
			return this.options.sleep(ms);
		}
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private asProviderError(error: unknown): ModelProviderError {
		if (error instanceof ModelProviderError) {
			return error;
		}
		return new ModelProviderError('unknown', `Unexpected provider failure: ${errorMessage(error)}`, {
			cause: error,
		});
	}
}

// --- module helpers ---------------------------------------------------------

function parseCompletion(payload: unknown, fallbackModel: string): ModelResponse {
	const data = payload as {
		choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
		model?: unknown;
		usage?: unknown;
	};
	const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
	const content = choice?.message?.content;
	if (typeof content !== 'string') {
		throw new ModelProviderError(
			'invalid_response',
			'OpenRouter response did not contain completion text.'
		);
	}

	return {
		content,
		usage: parseUsage(data.usage),
		finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
		model: typeof data.model === 'string' ? data.model : fallbackModel,
	};
}

function parseUsage(raw: unknown): TokenUsage {
	const usage = (raw ?? {}) as {
		prompt_tokens?: unknown;
		completion_tokens?: unknown;
		total_tokens?: unknown;
		cost?: unknown;
	};
	const promptTokens = numberOrZero(usage.prompt_tokens);
	const completionTokens = numberOrZero(usage.completion_tokens);
	const totalTokens =
		typeof usage.total_tokens === 'number' ? usage.total_tokens : promptTokens + completionTokens;
	const costUSD = typeof usage.cost === 'number' && Number.isFinite(usage.cost) ? usage.cost : undefined;
	return { promptTokens, completionTokens, totalTokens, ...(costUSD !== undefined ? { costUSD } : {}) };
}

function numberOrZero(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

async function readServerErrorMessage(response: Response): Promise<string> {
	try {
		const payload = (await response.clone().json()) as { error?: { message?: unknown } };
		const message = payload?.error?.message;
		if (typeof message === 'string' && message.trim().length > 0) {
			return message.trim().slice(0, MAX_SERVER_MESSAGE_CHARS);
		}
	} catch {
		// Body is not JSON (or already consumed); fall through.
	}
	return '';
}

function parseRetryAfterMs(header: string | null): number | undefined {
	if (!header) {
		return undefined;
	}
	const seconds = Number(header);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return seconds * 1000;
	}
	const dateMs = Date.parse(header);
	if (!Number.isNaN(dateMs)) {
		return Math.max(0, dateMs - Date.now());
	}
	return undefined;
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
