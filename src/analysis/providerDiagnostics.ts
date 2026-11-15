/**
 * Human-readable diagnostics for `ModelProviderError`.
 *
 * Design decision #2 (`docs/PRODUCT_SPEC.md`): callers switch on
 * `ModelProviderError.kind` to produce actionable UI diagnostics. This module
 * is the single source of those sentences. Every output follows one pattern:
 * category, action, then the sanitized provider message. It never mentions
 * the API key and never prints "undefined" (optional fields are checked).
 */

import { ModelProviderError } from './modelProvider';

export function formatProviderDiagnostic(error: ModelProviderError): string {
  switch (error.kind) {
    case 'authentication':
      return `Authentication failed. Check your configured API key and try again. Details: ${error.message}`;
    case 'rate_limit': {
      const wait = error.retryAfterMs !== undefined ? ` Retry after ${error.retryAfterMs} ms.` : '';
      return `Rate limit exceeded. Wait before trying again.${wait} Details: ${error.message}`;
    }
    case 'timeout':
      return `The request timed out. Try again later. Details: ${error.message}`;
    case 'network':
      return `Network error. Check your internet connection and try again. Details: ${error.message}`;
    case 'server': {
      const status = error.status !== undefined ? ` (HTTP ${error.status})` : '';
      return `The provider server returned an error${status}. Try again later. Details: ${error.message}`;
    }
    case 'invalid_request':
      return `The request was rejected as invalid. Check the provider settings and try again. Details: ${error.message}`;
    case 'invalid_response':
      return `The provider returned an unexpected response. Try again later. Details: ${error.message}`;
    case 'cancelled':
      return `The request was cancelled. Details: ${error.message}`;
    case 'unknown':
      return `An unexpected provider error occurred. Details: ${error.message}`;
    default:
      // Unreachable for the current union; kept so a kind added to
      // `ModelProviderErrorKind` later cannot silently degrade the output.
      return `An unexpected error occurred. Details: ${error.message}`;
  }
}
