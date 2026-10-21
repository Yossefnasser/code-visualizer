/**
 * Provider abstraction for model access (docs/ARCHITECTURE.md section 2).
 *
 * All AI-dependent behavior in the extension depends only on this interface so
 * every AI test can run offline against a mocked provider. Implementations of
 * this interface must never log secrets and the webview must never see
 * provider-specific types.
 */

export type MessageRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
	readonly role: MessageRole;
	readonly content: string;
}

/**
 * JSON Schema request for structured output. Providers send it as
 * `response_format` when the selected model/endpoint supports it.
 */
export interface JsonSchemaSpec {
	readonly name: string;
	readonly schema: Record<string, unknown>;
	readonly strict?: boolean;
}

export interface ModelRequest {
	readonly messages: ChatMessage[];
	/** Hard cap on completion tokens for this call (provider default applies). */
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly jsonSchema?: JsonSchemaSpec;
}

/** Token usage (and estimated cost, when the provider reports it). */
export interface TokenUsage {
	readonly promptTokens: number;
	readonly completionTokens: number;
	readonly totalTokens: number;
	/** Estimated cost in USD as reported by the provider (`usage.cost`). */
	readonly costUSD?: number;
}

export interface ModelResponse {
	readonly content: string;
	readonly usage: TokenUsage;
	readonly finishReason: string | null;
	/** The model id that actually served the request. */
	readonly model: string;
}

/**
 * Error taxonomy for provider failures. Kept small for Milestone 3 and
 * extended in Milestone 5. Messages must be actionable but must never include
 * the API key or full request payloads.
 */
export type ModelProviderErrorKind =
	| 'authentication'
	| 'rate_limit'
	| 'timeout'
	| 'network'
	| 'server'
	| 'invalid_request'
	| 'invalid_response'
	| 'cancelled'
	| 'unknown';

export class ModelProviderError extends Error {
	readonly kind: ModelProviderErrorKind;
	/** HTTP status when the failure came from a response. */
	readonly status?: number;
	/** Provider hint (e.g. `Retry-After`) for scheduling the next attempt. */
	readonly retryAfterMs?: number;

	constructor(
		kind: ModelProviderErrorKind,
		message: string,
		options?: { status?: number; retryAfterMs?: number; cause?: unknown }
	) {
		super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
		this.name = 'ModelProviderError';
		this.kind = kind;
		this.status = options?.status;
		this.retryAfterMs = options?.retryAfterMs;
	}
}

export interface CompleteOptions {
	/** Cooperative cancellation; linked to the run's cancellation source. */
	readonly signal?: AbortSignal;
}

export interface ModelProvider {
	/** Stable identifier for settings and diagnostics, e.g. "openrouter". */
	readonly id: string;
	complete(request: ModelRequest, options?: CompleteOptions): Promise<ModelResponse>;
}

/** True when a failure is worth retrying (transient conditions only). */
export function isRetryableProviderError(error: ModelProviderError): boolean {
	switch (error.kind) {
		case 'rate_limit':
		case 'timeout':
		case 'network':
		case 'server':
		case 'invalid_response':
			return true;
		default:
			return false;
	}
}
