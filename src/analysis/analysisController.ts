/**
 * AnalysisController — composes the AI analysis pipeline.
 *
 * Pipeline (in order):
 *   1. `IndexService.buildIndex`        → deterministic facts (Index v1.1)
 *   2. `AgentRunner.run`                → AI findings + run metadata
 *   3. `adaptAgentFindings`             → AI interpretations as contract entries
 *   4. `toContractEntries` + merge      → facts + interpretations in one document
 *   5. `validateFindings`               → two-tier validation (the judge)
 *   6. `mapIndexToGraph`                → Graph v2.0 for the webview
 *
 * The controller is deliberately free of VS Code APIs and of provider
 * construction: the caller injects an `IndexServiceInterface` and an agent
 * runner port, so the whole pipeline is testable offline with fakes.
 *
 * Honesty rules enforced here:
 * - A failed agent run is not an exception; it yields a `failed`/`partial`
 *   analysis status plus diagnostics, never a fabricated graph.
 * - A deterministic fact id always wins over an AI entry that reuses it.
 * - `AnalysisError` is thrown only for pipeline-level failures (index build,
 *   invalid documents, mapping), with a stable code for the caller.
 */

import { adaptAgentFindings } from './agentFindingAdapter';
import { AgentRunResult } from './agentRunner';
import { validateFindings } from './findingValidator';
import { IndexDocument } from './indexBackend';
import {
  CoverageStatus,
  IndexDiagnostic,
  IndexDocumentV1,
} from './indexContract';
import { IndexServiceInterface } from './indexService';
import { toContractEntries } from './indexToContractEntries';
import { ArchitectureGraph, mapIndexToGraph } from './indexToGraphMapper';

/** Stable failure codes for callers (command layer, diagnostics UI). */
export type AnalysisErrorCode =
  | 'cancelled'
  | 'index_build_failed'
  | 'agent_run_failed'
  | 'adaptation_failed'
  | 'validation_failed'
  | 'mapping_failed';

/** Typed error for analysis pipeline failures. */
export class AnalysisError extends Error {
  readonly code: AnalysisErrorCode;
  readonly cause?: unknown;

  constructor(code: AnalysisErrorCode, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'AnalysisError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * The part of `AgentRunner` the controller needs. Structural, so tests can
 * substitute a scripted runner and `AgentRunner` satisfies it as-is.
 */
export interface AgentRunnerPort {
  run(signal?: AbortSignal): Promise<AgentRunResult>;
}

export interface AnalysisControllerOptions {
  readonly indexService: IndexServiceInterface;
  readonly runner: AgentRunnerPort;
  readonly workspaceRoot: string;
  /** Provider id recorded in the contract document (e.g. "openrouter"). */
  readonly providerId?: string;
  /** Model id recorded in the contract document. */
  readonly modelId?: string;
  /** Materialize import edges (see `ContractEntriesOptions.includeImports`). */
  readonly includeImports?: boolean;
}

/** What one analysis run did, beyond the graph itself. */
export interface AnalysisRunMetadata {
  /** Analysis status as it appears in the graph (from run coverage). */
  readonly status: ArchitectureGraph['analysis']['status'];
  /** Raw agent run metadata — token usage, turns, termination reason. */
  readonly agent: AgentRunResult['metadata'];
  readonly index: {
    readonly files: number;
    readonly symbols: number;
    readonly endpoints: number;
    readonly models: number;
    readonly references: number;
    readonly diagnostics: number;
  };
  readonly entries: {
    /** Deterministic fact entries produced from the index. */
    readonly facts: number;
    /** AI findings adapted into interpretation entries (after id collisions). */
    readonly adapted: number;
    /** Entries sent to validation (facts + adapted). */
    readonly merged: number;
    /** Entries that survived validation. */
    readonly validated: number;
    readonly dropped: number;
    readonly repaired: number;
    readonly demoted: number;
    readonly promoted: number;
  };
  readonly graph: { readonly nodes: number; readonly edges: number };
  /** All diagnostics carried by the validated document (shown in the graph). */
  readonly diagnostics: readonly IndexDiagnostic[];
  /** Non-fatal mapper warnings (duplicate ids, dropped dangling edges). */
  readonly warnings: readonly string[];
}

export interface AnalysisRunResult {
  readonly graph: ArchitectureGraph;
  /** The validated Index Contract v1 document the graph was mapped from. */
  readonly document: IndexDocumentV1;
  readonly metadata: AnalysisRunMetadata;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Agent run status → coverage status for the single analysis scope. */
function coverageStatusFor(status: AgentRunResult['metadata']['status']): CoverageStatus {
  return status;
}

export class AnalysisController {
  private readonly indexService: IndexServiceInterface;
  private readonly runner: AgentRunnerPort;
  private readonly workspaceRoot: string;
  private readonly providerId?: string;
  private readonly modelId?: string;
  private readonly includeImports: boolean;

  constructor(options: AnalysisControllerOptions) {
    this.indexService = options.indexService;
    this.runner = options.runner;
    this.workspaceRoot = options.workspaceRoot;
    this.providerId = options.providerId;
    this.modelId = options.modelId;
    this.includeImports = options.includeImports ?? false;
  }

  /**
   * Run one analysis over the configured workspace root.
   *
   * @param signal - Cooperative cancellation, threaded into indexing and the
   *   agent run. Cancellation before the run starts raises `cancelled`.
   * @throws AnalysisError for pipeline-level failures.
   */
  async run(signal?: AbortSignal): Promise<AnalysisRunResult> {
    if (signal?.aborted) {
      throw new AnalysisError('cancelled', 'Analysis was cancelled before it started.');
    }

    // ---- 1. Deterministic facts ----
    let index: IndexDocument;
    try {
      index = await this.indexService.buildIndex({ root: this.workspaceRoot, signal });
    } catch (error) {
      if (signal?.aborted) {
        throw new AnalysisError(
          'cancelled',
          'Analysis was cancelled while indexing the workspace.',
          error
        );
      }
      throw new AnalysisError(
        'index_build_failed',
        `Failed to build the code index: ${errorMessage(error)}`,
        error
      );
    }

    // ---- 2. Agent investigation ----
    let run: AgentRunResult;
    try {
      run = await this.runner.run(signal);
    } catch (error) {
      throw new AnalysisError(
        'agent_run_failed',
        `The analysis agent failed: ${errorMessage(error)}`,
        error
      );
    }

    // ---- 3. Findings → interpretation entries ----
    const factResult = toContractEntries(index, { includeImports: this.includeImports });
    const factIds = new Set(factResult.entries.map((entry) => entry.id));

    let adapted: ReturnType<typeof adaptAgentFindings>;
    try {
      adapted = adaptAgentFindings(run.findings, {
        project: { root: index.root, languages: [index.language] },
        indexer: {
          kind: 'hybrid',
          ...(this.providerId !== undefined ? { provider: this.providerId } : {}),
          ...(this.modelId !== undefined ? { model: this.modelId } : {}),
        },
        coverage: {
          scopes: [
            {
              id: 'scope:analysis',
              scope: index.root,
              status: coverageStatusFor(run.metadata.status),
            },
          ],
        },
        diagnostics: [...factResult.diagnostics, ...index.diagnostics],
        externalEntryIds: [...factIds],
      });
    } catch (error) {
      throw new AnalysisError(
        'adaptation_failed',
        `Agent findings could not be adapted to the Index Contract: ${errorMessage(error)}`,
        error
      );
    }

    // ---- 4. Merge facts + interpretations (deterministic facts win) ----
    const collisionDiagnostics: IndexDiagnostic[] = [];
    const adaptedEntries = adapted.document.entries.filter((entry) => {
      if (!factIds.has(entry.id)) {
        return true;
      }
      collisionDiagnostics.push({
        severity: 'warning',
        code: 'fact_id_collision',
        message: `AI entry "${entry.id}" reuses a deterministic fact id and was dropped; the deterministic fact wins.`,
      });
      return false;
    });

    const budgetDiagnostic: IndexDiagnostic = {
      severity: 'info',
      code: 'analysis_budget',
      message:
        `Agent run: ${run.metadata.turns} turn(s), ${run.metadata.toolCalls} tool call(s), ` +
        `${run.metadata.totalTokens} token(s)` +
        (run.metadata.totalCostUSD !== undefined
          ? `, ~$${run.metadata.totalCostUSD.toFixed(4)}`
          : '') +
        `, ${run.metadata.durationMs} ms (status: ${run.metadata.status}` +
        (run.metadata.terminationReason !== undefined
          ? `, ${run.metadata.terminationReason}`
          : '') +
        ').',
    };

    const combined: IndexDocumentV1 = {
      ...adapted.document,
      entries: [...factResult.entries, ...adaptedEntries],
      diagnostics: [
        ...adapted.document.diagnostics,
        ...collisionDiagnostics,
        ...run.metadata.diagnostics.map(
          (diagnostic): IndexDiagnostic => ({
            severity: 'warning',
            code: diagnostic.code,
            message: diagnostic.message,
          })
        ),
        budgetDiagnostic,
      ],
    };

    // ---- 5. Two-tier validation (the judge) ----
    let validation: ReturnType<typeof validateFindings>;
    try {
      validation = validateFindings(combined, this.indexService);
    } catch (error) {
      throw new AnalysisError(
        'validation_failed',
        `Validation failed: ${errorMessage(error)}`,
        error
      );
    }

    // ---- 6. Contract → Graph v2.0 ----
    let mapped: ReturnType<typeof mapIndexToGraph>;
    try {
      mapped = mapIndexToGraph(validation.document);
    } catch (error) {
      throw new AnalysisError(
        'mapping_failed',
        `The validated document could not be mapped to a graph: ${errorMessage(error)}`,
        error
      );
    }

    const symbols = index.files.reduce((sum, file) => sum + file.symbols.length, 0);
    return {
      graph: mapped.graph,
      document: validation.document,
      metadata: {
        status: mapped.graph.analysis.status,
        agent: run.metadata,
        index: {
          files: index.files.length,
          symbols,
          endpoints: index.endpoints.length,
          models: index.models.length,
          references: index.references.length,
          diagnostics: index.diagnostics.length,
        },
        entries: {
          facts: factResult.entries.length,
          adapted: adaptedEntries.length,
          merged: combined.entries.length,
          validated: validation.document.entries.length,
          dropped: validation.droppedEntryIds.length,
          repaired: validation.repairedEntryIds.length,
          demoted: validation.demotedEntryIds.length,
          promoted: validation.promotedEntryIds.length,
        },
        graph: { nodes: mapped.graph.nodes.length, edges: mapped.graph.edges.length },
        diagnostics: validation.document.diagnostics,
        warnings: mapped.warnings,
      },
    };
  }
}
