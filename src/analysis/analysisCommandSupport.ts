/**
 * Pure helpers for the `code-visualizer.analyze` command.
 *
 * Kept out of `extension.ts` so the user-facing strings and error
 * classification are testable offline: no VS Code APIs, no I/O, no provider
 * calls.
 */

import { AnalysisError, AnalysisRunResult } from './analysisController';
import { IndexBackendError } from './indexBackend';
import { ModelProviderError } from './modelProvider';
import { formatProviderDiagnostic } from './providerDiagnostics';

/** GlobalState key remembering that the user accepted the privacy disclosure. */
export const PRIVACY_DISCLOSURE_ACCEPTED_KEY = 'codeVisualizer.privacyDisclosureAccepted';

/**
 * Shown as a modal before the first analysis. It must stay literally true: if
 * a claim here stops being true (e.g. excludes become enforced), update it.
 */
export const PRIVACY_DISCLOSURE_MESSAGE =
  'Analysis sends selected source-code excerpts to OpenRouter and its upstream model vendors. ' +
  'Nothing is sent until you run an analysis, and this extension sends no telemetry. ' +
  'Exclude-pattern enforcement is not available yet.';

/** One-line summary of a finished run for the notification and output log. */
export function formatAnalysisOutcome(result: AnalysisRunResult): string {
  const { graph, metadata } = result;
  const usage = [
    `${metadata.agent.turns} turn(s)`,
    `${metadata.agent.toolCalls} tool call(s)`,
    `${metadata.agent.totalTokens} token(s)`,
  ];
  if (metadata.agent.totalCostUSD !== undefined) {
    usage.push(`~$${metadata.agent.totalCostUSD.toFixed(4)}`);
  }
  return (
    `analysis ${graph.analysis.status}: ${graph.nodes.length} node(s), ` +
    `${graph.edges.length} edge(s) from ${metadata.entries.facts} fact(s) + ` +
    `${metadata.entries.adapted} AI finding(s); ${usage.join(', ')}`
  );
}

/** Follow `cause` links to the root failure (guards against cycles). */
function rootCause(error: unknown): unknown {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && current.cause !== undefined && !seen.has(current.cause)) {
    seen.add(current);
    current = current.cause;
  }
  return current;
}

function analysisErrorPrefix(code: AnalysisError['code']): string {
  switch (code) {
    case 'index_build_failed':
      return 'Could not build the code index';
    case 'agent_run_failed':
      return 'The analysis agent failed';
    case 'adaptation_failed':
    case 'validation_failed':
    case 'mapping_failed':
      return 'The analysis result was rejected';
    case 'cancelled':
      return 'Analysis cancelled';
  }
}

/**
 * Actionable, human-readable failure text. Classifies the *root* cause, so an
 * `AnalysisError` wrapping an `IndexBackendError` still gets the Python hint.
 */
export function formatAnalysisFailure(error: unknown): string {
  if (error instanceof AnalysisError && error.code === 'cancelled') {
    return 'Analysis cancelled.';
  }

  const root = rootCause(error);
  const detail = root instanceof Error ? root.message : String(root);

  if (root instanceof IndexBackendError) {
    switch (root.code) {
      case 'python_not_found':
        return 'Python was not found. Install Python 3 and make sure "python" is on PATH, then run the analysis again.';
      case 'timeout':
        return `The code indexer timed out: ${detail}`;
      case 'cancelled':
        return 'Analysis cancelled.';
      default:
        return `Could not build the code index (${root.code}): ${detail}`;
    }
  }

  if (root instanceof ModelProviderError) {
    return formatProviderDiagnostic(root);
  }

  if (error instanceof AnalysisError) {
    return `${analysisErrorPrefix(error.code)}: ${detail}`;
  }

  return detail;
}
