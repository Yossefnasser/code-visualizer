/**
 * PythonIndexBackend - implements IndexBackend by spawning the Python indexer sidecar.
 *
 * The sidecar is invoked as: `python -m analyzer <root> --index [--exclude DIR ...]`
 * It emits the index document (v1.1) as JSON on stdout; logs go to stderr.
 */

import * as child_process from 'node:child_process';
import * as path from 'node:path';

import {
  INDEX_SCHEMA_VERSION,
  IndexDocument,
  IndexDigest,
  SymbolRef,
  ImportRef,
  CallReference,
  EndpointHint,
  RouteBinding,
  ModelHint,
  OrmRelationshipHint,
  FileDoc,
  IndexDiagnostic,
  IndexQueryFilter,
  IndexQueryResult,
  BuildIndexOptions,
  IndexBackend,
  IndexBackendError,
  IndexBackendErrorCode,
  ProcessExecutor,
} from './indexBackend';

/** Default Python executable name. Can be overridden via configuration. */
export const DEFAULT_PYTHON_EXECUTABLE = 'python';

/** Default timeout for indexer process (5 minutes). */
export const DEFAULT_INDEXER_TIMEOUT_MS = 5 * 60 * 1000;

/** Maximum output size to prevent memory issues (10 MB). */
export const MAX_OUTPUT_SIZE = 10 * 1024 * 1024;

/** Path to the analyzer module relative to the extension root. */
const ANALYZER_MODULE_PATH = path.join('services', 'analyzer', 'src');

/** Default process executor using child_process.spawn. */
export const defaultProcessExecutor: ProcessExecutor = {
  async execute(command, args, options) {
    return new Promise((resolve, reject) => {
      const { cwd, env, timeoutMs, signal } = options;

      const child = child_process.spawn(command, args, {
        cwd,
        env: { ...process.env, ...env, PYTHONPATH: ANALYZER_MODULE_PATH },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let stdoutSize = 0;
      let stderrSize = 0;
      let resolved = false;

      const cleanup = () => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      const onAbort = () => {
        if (!resolved) {
          resolved = true;
          child.kill('SIGTERM');
          reject(new IndexBackendError('cancelled', 'Indexer process was cancelled'));
        }
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      const timeoutId = timeoutMs
        ? setTimeout(() => {
          if (!resolved) {
            resolved = true;
            child.kill('SIGTERM');
            reject(new IndexBackendError('timeout', `Indexer process timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs)
        : undefined;

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutSize += chunk.length;
        if (stdoutSize > MAX_OUTPUT_SIZE) {
          if (!resolved) {
            resolved = true;
            child.kill('SIGTERM');
            reject(new IndexBackendError('process_failed', 'Indexer stdout exceeded maximum allowed size'));
          }
          return;
        }
        stdout += chunk.toString('utf8');
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderrSize += chunk.length;
        if (stderrSize > MAX_OUTPUT_SIZE) {
          // Truncate stderr but don't fail
          return;
        }
        stderr += chunk.toString('utf8');
      });

      child.on('error', (error: Error) => {
        if (!resolved) {
          resolved = true;
          if (timeoutId) clearTimeout(timeoutId);
          cleanup();
          if (error.message.includes('ENOENT') || error.message.includes('spawn')) {
            reject(new IndexBackendError('python_not_found', `Failed to spawn Python process: ${error.message}`, { cause: error }));
          } else {
            reject(new IndexBackendError('process_failed', `Indexer process error: ${error.message}`, { cause: error }));
          }
        }
      });

      child.on('close', (exitCode: number | null) => {
        if (!resolved) {
          resolved = true;
          if (timeoutId) clearTimeout(timeoutId);
          cleanup();

          if (exitCode !== 0) {
            const errorMsg = stderr.trim() || `Indexer exited with code ${exitCode}`;
            reject(new IndexBackendError('process_failed', `Indexer process failed: ${errorMsg}`, { status: exitCode ?? undefined }));
            return;
          }

          resolve({ stdout, stderr, exitCode: exitCode ?? 0 });
        }
      });
    });
  },
};

/** Configuration options for PythonIndexBackend. */
export interface PythonIndexBackendOptions {
  /** Python executable to use (e.g., 'python', 'python3', '/usr/bin/python3'). */
  readonly pythonExecutable?: string;
  /** Additional arguments to pass to the Python interpreter. */
  readonly pythonArgs?: readonly string[];
  /** Timeout for the indexer process in milliseconds. */
  readonly timeoutMs?: number;
  /** Custom process executor (for testing). */
  readonly executor?: ProcessExecutor;
}

/**
 * PythonIndexBackend implementation.
 *
 * Spawns the Python indexer sidecar and parses its JSON output.
 * Caches the index document in memory for subsequent queries.
 */
export class PythonIndexBackend implements IndexBackend {
  private readonly pythonExecutable: string;
  private readonly pythonArgs: readonly string[];
  private readonly timeoutMs: number;
  private readonly executor: ProcessExecutor;
  private indexDocument: IndexDocument | null = null;

  constructor(options: PythonIndexBackendOptions = {}) {
    this.pythonExecutable = options.pythonExecutable ?? DEFAULT_PYTHON_EXECUTABLE;
    this.pythonArgs = options.pythonArgs ?? [];
    this.timeoutMs = options.timeoutMs ?? DEFAULT_INDEXER_TIMEOUT_MS;
    this.executor = options.executor ?? defaultProcessExecutor;
  }

  async buildIndex(options: BuildIndexOptions): Promise<IndexDocument> {
    const { root, excludes = [], signal } = options;

    // Build command arguments
    const args = [
      ...this.pythonArgs,
      '-m',
      'analyzer',
      root,
      '--index',
      ...excludes.flatMap((dir) => ['--exclude', dir]),
    ];

    // Determine working directory (extension root)
    // The analyzer module expects to be run from the repository root (code-visualizer/)
    // where services/analyzer/src is the PYTHONPATH
    const cwd = process.cwd();

    try {
      const { stdout, exitCode } = await this.executor.execute(this.pythonExecutable, args, {
        cwd,
        timeoutMs: this.timeoutMs,
        signal,
      });

      // Check exit code first - non-zero means process failure regardless of stdout
      if (exitCode !== 0) {
        throw new IndexBackendError('process_failed', `Indexer process exited with code ${exitCode}`);
      }

      // Parse and validate the JSON output
      const document = this.parseAndValidate(stdout);
      this.indexDocument = document;
      return document;
    } catch (error) {
      // Re-throw IndexBackendError as-is
      if (error instanceof IndexBackendError) {
        throw error;
      }
      // Wrap unexpected errors
      throw new IndexBackendError('unknown', `Unexpected error during indexing: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  getIndex(): IndexDocument {
    if (!this.indexDocument) {
      throw new IndexBackendError('validation_failed', 'No index has been built yet. Call buildIndex() first.');
    }
    return this.indexDocument;
  }

  getDigest(): IndexDigest {
    return this.getIndex().digest;
  }

  async querySymbols(filter?: IndexQueryFilter): Promise<IndexQueryResult<SymbolRef>> {
    const index = this.getIndex();
    const results = this.filterSymbols(index.files, filter);
    return { results, total: results.length };
  }

  async queryImports(filter?: IndexQueryFilter): Promise<IndexQueryResult<{ module: string; imports: readonly ImportRef[] }>> {
    const index = this.getIndex();
    const results = this.filterImports(index.files, filter);
    return { results, total: results.length };
  }

  async queryReferences(filter?: IndexQueryFilter): Promise<IndexQueryResult<CallReference>> {
    const index = this.getIndex();
    const results = this.filterReferences(index.references, filter);
    return { results, total: results.length };
  }

  async queryReverseReferences(targetKey: string): Promise<IndexQueryResult<CallReference>> {
    const index = this.getIndex();
    const results = index.reverseReferences[targetKey] ?? [];
    return { results, total: results.length };
  }

  getEndpoints(): readonly EndpointHint[] {
    return this.getIndex().endpoints;
  }

  getRouteBindings(): readonly RouteBinding[] {
    return this.getIndex().routeBindings;
  }

  getModels(): readonly ModelHint[] {
    return this.getIndex().models;
  }

  getOrmRelationships(): readonly OrmRelationshipHint[] {
    return this.getIndex().ormRelationships;
  }

  getFiles(): readonly FileDoc[] {
    return this.getIndex().files;
  }

  getDiagnostics(): readonly IndexDiagnostic[] {
    return this.getIndex().diagnostics;
  }

  // --- Private validation and filtering methods ---

  private parseAndValidate(jsonText: string): IndexDocument {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (error) {
      throw new IndexBackendError('invalid_json', `Indexer output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }

    // Validate required top-level fields
    if (!parsed || typeof parsed !== 'object') {
      throw new IndexBackendError('validation_failed', 'Index document is not an object');
    }

    const doc = parsed as Record<string, unknown>;

    // Check schema version
    if (doc.schemaVersion !== INDEX_SCHEMA_VERSION) {
      throw new IndexBackendError(
        'unsupported_schema_version',
        `Unsupported index schema version: expected "${INDEX_SCHEMA_VERSION}", got "${doc.schemaVersion}"`
      );
    }

    // Validate required fields exist
    const requiredFields = [
      'root',
      'language',
      'digest',
      'files',
      'endpoints',
      'routeBindings',
      'models',
      'ormRelationships',
      'references',
      'reverseReferences',
      'diagnostics',
    ] as const;

    for (const field of requiredFields) {
      if (!(field in doc)) {
        throw new IndexBackendError('validation_failed', `Index document missing required field: ${field}`);
      }
    }

    // Validate language
    if (doc.language !== 'python') {
      throw new IndexBackendError('validation_failed', `Unsupported index language: ${doc.language}`);
    }

    // Type assertion after validation - use unknown as intermediate
    return doc as unknown as IndexDocument;
  }

  private filterSymbols(files: readonly FileDoc[], filter?: IndexQueryFilter): SymbolRef[] {
    const limit = filter?.limit ?? 100;
    const results: SymbolRef[] = [];

    // Handle limit of 0 explicitly
    if (limit <= 0) {
      return results;
    }

    for (const file of files) {
      // Module filter
      if (filter?.module && file.module !== filter.module) continue;
      if (filter?.modulePrefix && !file.module.startsWith(filter.modulePrefix)) continue;

      for (const symbol of file.symbols) {
        // Qualname filter
        if (filter?.qualname && symbol.qualname !== filter.qualname) continue;
        if (filter?.qualnamePrefix && !symbol.qualname.startsWith(filter.qualnamePrefix)) continue;

        // Kind filter
        if (filter?.kind && symbol.kind !== filter.kind) continue;

        results.push(symbol);
        if (results.length >= limit) return results;
      }
    }

    return results;
  }

  private filterImports(
    files: readonly FileDoc[],
    filter?: IndexQueryFilter
  ): { module: string; imports: readonly ImportRef[] }[] {
    const limit = filter?.limit ?? 100;
    const results: { module: string; imports: readonly ImportRef[] }[] = [];

    for (const file of files) {
      if (filter?.module && file.module !== filter.module) continue;
      if (filter?.modulePrefix && !file.module.startsWith(filter.modulePrefix)) continue;

      // Filter imports if sourceModule/targetModule specified
      let imports = file.imports;
      if (filter?.sourceModule) {
        // This would filter by the module that contains the import
        // For now, we return all imports for matching modules
      }

      if (imports.length > 0) {
        results.push({ module: file.module, imports });
        if (results.length >= limit) break;
      }
    }

    return results;
  }

  private filterReferences(references: readonly CallReference[], filter?: IndexQueryFilter): CallReference[] {
    const limit = filter?.limit ?? 100;
    const results: CallReference[] = [];

    for (const ref of references) {
      if (filter?.sourceModule && ref.sourceModule !== filter.sourceModule) continue;
      if (filter?.targetModule && ref.targetModule !== filter.targetModule) continue;
      if (filter?.qualname && ref.sourceQualname !== filter.qualname) continue;

      results.push(ref);
      if (results.length >= limit) break;
    }

    return results;
  }
}