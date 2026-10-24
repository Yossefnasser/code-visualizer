/**
 * IndexBackend interface and types for the deterministic index document (v1.1).
 *
 * The index document is produced by the Python indexer sidecar (`python -m analyzer <root> --index`).
 * This interface abstracts the index source so the extension can swap backends.
 */

/** Supported index schema version. */
export const INDEX_SCHEMA_VERSION = '1.1' as const;

/** Primary language of the indexed project. */
export type IndexLanguage = 'python';

/** Index document root metadata. */
export interface IndexRoot {
  readonly schemaVersion: typeof INDEX_SCHEMA_VERSION;
  readonly root: string;
  readonly language: IndexLanguage;
}

/** Per-file manifest entry in the digest. */
export interface DigestManifestEntry {
  readonly path: string;
  readonly lineCount: number;
  readonly frameworks: readonly string[];
  readonly imports: number;
  readonly symbols: number;
}

/** Aggregate counts in the digest. */
export interface DigestCounts {
  readonly files: number;
  readonly totalLines: number;
  readonly endpoints: number;
  readonly models: number;
  readonly ormRelationships: number;
  readonly references: number;
  readonly diagnostics: number;
}

/** Repository digest for agent survey (Stage 0). */
export interface IndexDigest {
  readonly tree: readonly string[];
  readonly manifest: readonly DigestManifestEntry[];
  readonly counts: DigestCounts;
}

/** Import reference in a file. */
export interface ImportRef {
  readonly local: string;
  readonly module: string;
  readonly name: string | null;
}

/** Symbol (function or class) in a file. */
export interface SymbolRef {
  readonly id: string;
  readonly kind: 'function' | 'class';
  readonly name: string;
  readonly qualname: string;
  readonly className: string | null;
  readonly startLine: number;
  readonly endLine: number;
  readonly bases?: readonly string[];
}

/** Per-file document in the index. */
export interface FileDoc {
  readonly path: string;
  readonly module: string;
  readonly language: IndexLanguage;
  readonly lineCount: number;
  readonly frameworks: readonly string[];
  readonly imports: readonly ImportRef[];
  readonly symbols: readonly SymbolRef[];
}

/** FastAPI endpoint hint. */
export interface EndpointHint {
  readonly id: string;
  readonly module: string;
  readonly methods: readonly string[];
  readonly path: string;
  readonly sourcePath: string;
  readonly line: number | null;
}

/** Route binding: endpoint -> handler function. */
export interface RouteBinding {
  readonly endpointId: string;
  readonly handlerModule: string;
  readonly handlerQualname: string;
}

/** Database model field hint. */
export interface ModelFieldHint {
  readonly name: string;
  readonly kind: string;
  readonly type: string | null;
  readonly targetHint: string | null;
  readonly line: number | null;
}

/** Database model hint (SQLAlchemy/Django). */
export interface ModelHint {
  readonly id: string;
  readonly module: string;
  readonly name: string;
  readonly table: string | null;
  readonly sourcePath: string;
  readonly startLine: number | null;
  readonly endLine: number | null;
  readonly fields: readonly ModelFieldHint[];
}

/** ORM relationship hint. */
export interface OrmRelationshipHint {
  readonly sourceId: string;
  readonly targetId: string;
  readonly kind: string;
  readonly line: number | null;
}

/** Resolvable cross-symbol call reference. */
export interface CallReference {
  readonly sourceModule: string;
  readonly sourceQualname: string;
  readonly targetModule: string;
  readonly targetQualname: string;
  readonly line: number;
}

/** Diagnostic from the indexer. */
export interface IndexDiagnostic {
  readonly severity: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly message: string;
  readonly source?: {
    readonly path: string;
    readonly startLine: number;
    readonly endLine?: number;
  };
}

/** Complete index document (v1.1). */
export interface IndexDocument {
  readonly schemaVersion: typeof INDEX_SCHEMA_VERSION;
  readonly root: string;
  readonly language: IndexLanguage;
  readonly digest: IndexDigest;
  readonly files: readonly FileDoc[];
  readonly endpoints: readonly EndpointHint[];
  readonly routeBindings: readonly RouteBinding[];
  readonly models: readonly ModelHint[];
  readonly ormRelationships: readonly OrmRelationshipHint[];
  readonly references: readonly CallReference[];
  readonly reverseReferences: Readonly<Record<string, readonly CallReference[]>>;
  readonly diagnostics: readonly IndexDiagnostic[];
}

/** Filter for index queries. */
export interface IndexQueryFilter {
  readonly module?: string;
  readonly modulePrefix?: string;
  readonly qualname?: string;
  readonly qualnamePrefix?: string;
  readonly kind?: 'function' | 'class';
  readonly sourceModule?: string;
  readonly targetModule?: string;
  readonly limit?: number;
}

/** Query result wrapper. */
export interface IndexQueryResult<T> {
  readonly results: readonly T[];
  readonly total: number;
}

/** Options for building an index. */
export interface BuildIndexOptions {
  readonly root: string;
  readonly excludes?: readonly string[];
  readonly signal?: AbortSignal;
}

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

/** Error codes for index backend failures. */
export type IndexBackendErrorCode =
  | 'python_not_found'
  | 'process_failed'
  | 'timeout'
  | 'invalid_json'
  | 'unsupported_schema_version'
  | 'validation_failed'
  | 'cancelled'
  | 'unknown';

/** Typed error for index backend operations. */
export class IndexBackendError extends Error {
  readonly code: IndexBackendErrorCode;
  readonly status?: number;
  readonly cause?: unknown;

  constructor(
    code: IndexBackendErrorCode,
    message: string,
    options?: { status?: number; cause?: unknown }
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'IndexBackendError';
    this.code = code;
    this.status = options?.status;
    this.cause = options?.cause;
  }
}

/** Process execution abstraction for testability. */
export interface ProcessExecutor {
  execute(
    command: string,
    args: readonly string[],
    options: {
      readonly cwd?: string;
      readonly env?: NodeJS.ProcessEnv;
      readonly timeoutMs?: number;
      readonly signal?: AbortSignal;
    }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

/** IndexBackend interface - implemented by PythonIndexBackend. */
export interface IndexBackend {
  /**
   * Build the index for a repository root.
   * Returns the parsed, validated index document.
   */
  buildIndex(options: BuildIndexOptions): Promise<IndexDocument>;

  /**
   * Get the cached index document (after buildIndex has been called).
   * Throws if no index has been built yet.
   */
  getIndex(): IndexDocument;

  /**
   * Get the repository digest for agent survey.
   */
  getDigest(): IndexDigest;

  /**
   * Query symbols from the index.
   */
  querySymbols(filter?: IndexQueryFilter): Promise<IndexQueryResult<SymbolRef>>;

  /**
   * Query imports from the index.
   */
  queryImports(filter?: IndexQueryFilter): Promise<IndexQueryResult<{ module: string; imports: readonly ImportRef[] }>>;

  /**
   * Query call references from the index.
   */
  queryReferences(filter?: IndexQueryFilter): Promise<IndexQueryResult<CallReference>>;

  /**
   * Query reverse references (who calls a given target).
   */
  queryReverseReferences(targetKey: string): Promise<IndexQueryResult<CallReference>>;

  /**
   * Get all FastAPI endpoint hints.
   */
  getEndpoints(): readonly EndpointHint[];

  /**
   * Get all route bindings (endpoint -> handler).
   */
  getRouteBindings(): readonly RouteBinding[];

  /**
   * Get all database model hints.
   */
  getModels(): readonly ModelHint[];

  /**
   * Get all ORM relationship hints.
   */
  getOrmRelationships(): readonly OrmRelationshipHint[];

  /**
   * Get all file documents.
   */
  getFiles(): readonly FileDoc[];

  /**
   * Get all diagnostics.
   */
  getDiagnostics(): readonly IndexDiagnostic[];
}