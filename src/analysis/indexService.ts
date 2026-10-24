/**
 * IndexService - high-level service for repository index operations.
 *
 * Wraps an IndexBackend to provide a clean API for the agent and analysis pipeline.
 * Does not instantiate backends; receives them via dependency injection.
 */

import {
  INDEX_SCHEMA_VERSION,
  IndexBackend,
  IndexBackendError,
  IndexBackendErrorCode,
  BuildIndexOptions,
  IndexDocument,
  IndexDigest,
  IndexQueryFilter,
  IndexQueryResult,
  SymbolRef,
  ImportRef,
  CallReference,
  EndpointHint,
  RouteBinding,
  ModelHint,
  OrmRelationshipHint,
  FileDoc,
  IndexDiagnostic,
} from './indexBackend';

/** Repository overview for agent survey (maps to `repo.overview` tool). */
export interface RepoOverview {
  readonly schemaVersion: typeof INDEX_SCHEMA_VERSION;
  readonly root: string;
  readonly language: string;
  readonly digest: IndexDigest;
  readonly counts: {
    readonly files: number;
    readonly totalLines: number;
    readonly endpoints: number;
    readonly models: number;
    readonly ormRelationships: number;
    readonly references: number;
    readonly diagnostics: number;
    readonly symbols: number;
    readonly imports: number;
  };
  readonly diagnostics: readonly IndexDiagnostic[];
}

/** Query types supported by the index (maps to `index.query` tool). */
export type IndexQueryType =
  | 'symbols'
  | 'imports'
  | 'references'
  | 'reverseReferences'
  | 'endpoints'
  | 'models'
  | 'routeBindings'
  | 'ormRelationships'
  | 'files';

/** Options for index queries. */
export interface IndexQueryOptions {
  readonly type: IndexQueryType;
  readonly filter?: IndexQueryFilter;
  readonly targetKey?: string; // for reverseReferences
}

/** Result of a generic index query. */
export interface IndexQueryResultWrapper<T> {
  readonly results: readonly T[];
  readonly total: number;
}

/** Error indicating the index has not been built yet. */
export class IndexNotBuiltError extends Error {
  readonly code = 'index_not_built' as const;

  constructor(message = 'Index has not been built. Call buildIndex() first.') {
    super(message);
    this.name = 'IndexNotBuiltError';
  }
}

/** IndexService configuration options. */
export interface IndexServiceOptions {
  /** The index backend to use. */
  readonly backend: IndexBackend;
}

/**
 * IndexServiceInterface - minimal interface for index operations needed by AgentRunner.
 * This allows faking the service for tests without implementing all private methods.
 */
export interface IndexServiceInterface {
  /** Build or rebuild the repository index. */
  buildIndex(options: BuildIndexOptions): Promise<IndexDocument>;
  /** Refresh the index (alias for buildIndex with same root). */
  refreshIndex(options: BuildIndexOptions): Promise<IndexDocument>;
  /** Check if an index has been built. */
  hasIndex(): boolean;
  /** Get the repository overview for agent survey. */
  getRepoOverview(): RepoOverview;
  /** Get the raw index digest. */
  getDigest(): IndexDigest;
  /** Query the index with a unified interface. */
  queryIndex<T>(options: IndexQueryOptions): Promise<IndexQueryResultWrapper<T>>;
  /** Get all endpoint hints. */
  getEndpoints(): readonly EndpointHint[];
  /** Get all route bindings. */
  getRouteBindings(): readonly RouteBinding[];
  /** Get all database model hints. */
  getModels(): readonly ModelHint[];
  /** Get all ORM relationship hints. */
  getOrmRelationships(): readonly OrmRelationshipHint[];
  /** Get all file documents. */
  getFiles(): readonly FileDoc[];
  /** Get all diagnostics. */
  getDiagnostics(): readonly IndexDiagnostic[];
  /** Get the complete index document. */
  getIndex(): IndexDocument;
}

/**
 * IndexService - provides high-level index operations for the agent.
 *
 * The service delegates to an IndexBackend but adds:
 * - Repository overview assembly
 * - Unified query interface matching agent tool concepts
 * - Lifecycle management (build once, query many)
 * - Clear error handling for unbuilt index
 */
export class IndexService implements IndexServiceInterface {
  private readonly backend: IndexBackend;
  private indexBuilt = false;

  constructor(options: IndexServiceOptions) {
    this.backend = options.backend;
  }

  /**
   * Build or rebuild the repository index.
   * @param options - Root path, optional excludes, and cancellation signal
   * @returns The built index document
   */
  async buildIndex(options: BuildIndexOptions): Promise<IndexDocument> {
    const doc = await this.backend.buildIndex(options);
    this.indexBuilt = true;
    return doc;
  }

  /**
   * Refresh the index (alias for buildIndex with same root).
   * Use when the repository has changed and a fresh index is needed.
   */
  async refreshIndex(options: BuildIndexOptions): Promise<IndexDocument> {
    return this.buildIndex(options);
  }

  /**
   * Check if an index has been built.
   */
  hasIndex(): boolean {
    return this.indexBuilt;
  }

  /**
   * Get the repository overview for agent survey (maps to `repo.overview` tool).
   * Throws IndexNotBuiltError if no index has been built.
   */
  getRepoOverview(): RepoOverview {
    if (!this.indexBuilt) {
      throw new IndexNotBuiltError();
    }

    const index = this.backend.getIndex();
    const files = index.files;
    const totalSymbols = files.reduce((sum, f) => sum + f.symbols.length, 0);
    const totalImports = files.reduce((sum, f) => sum + f.imports.length, 0);

    return {
      schemaVersion: index.schemaVersion,
      root: index.root,
      language: index.language,
      digest: index.digest,
      counts: {
        files: index.digest.counts.files,
        totalLines: index.digest.counts.totalLines,
        endpoints: index.digest.counts.endpoints,
        models: index.digest.counts.models,
        ormRelationships: index.digest.counts.ormRelationships,
        references: index.digest.counts.references,
        diagnostics: index.digest.counts.diagnostics,
        symbols: totalSymbols,
        imports: totalImports,
      },
      diagnostics: index.diagnostics,
    };
  }

  /**
   * Get the raw index digest (for direct access).
   */
  getDigest(): IndexDigest {
    if (!this.indexBuilt) {
      throw new IndexNotBuiltError();
    }
    return this.backend.getDigest();
  }

  /**
   * Query the index with a unified interface (maps to `index.query` tool).
   * @param options - Query type, filter, and optional targetKey for reverseReferences
   * @returns Query results with total count
   */
  async queryIndex<T>(options: IndexQueryOptions): Promise<IndexQueryResultWrapper<T>> {
    if (!this.indexBuilt) {
      throw new IndexNotBuiltError();
    }

    const { type, filter, targetKey } = options;

    switch (type) {
      case 'symbols': {
        const result = await this.backend.querySymbols(filter);
        return result as IndexQueryResultWrapper<T>;
      }
      case 'imports': {
        const result = await this.backend.queryImports(filter);
        return result as IndexQueryResultWrapper<T>;
      }
      case 'references': {
        const result = await this.backend.queryReferences(filter);
        return result as IndexQueryResultWrapper<T>;
      }
      case 'reverseReferences': {
        if (!targetKey) {
          throw new Error('targetKey is required for reverseReferences query');
        }
        const result = await this.backend.queryReverseReferences(targetKey);
        return result as IndexQueryResultWrapper<T>;
      }
      case 'endpoints': {
        const endpoints = this.backend.getEndpoints();
        const filtered = this.filterEndpoints(endpoints, filter);
        return { results: filtered as T[], total: filtered.length };
      }
      case 'models': {
        const models = this.backend.getModels();
        const filtered = this.filterModels(models, filter);
        return { results: filtered as T[], total: filtered.length };
      }
      case 'routeBindings': {
        const bindings = this.backend.getRouteBindings();
        const filtered = this.filterRouteBindings(bindings, filter);
        return { results: filtered as T[], total: filtered.length };
      }
      case 'ormRelationships': {
        const rels = this.backend.getOrmRelationships();
        const filtered = this.filterOrmRelationships(rels, filter);
        return { results: filtered as T[], total: filtered.length };
      }
      case 'files': {
        const files = this.backend.getFiles();
        const filtered = this.filterFiles(files, filter);
        return { results: filtered as T[], total: filtered.length };
      }
      default: {
        const _exhaustive: never = type;
        throw new Error(`Unknown query type: ${_exhaustive}`);
      }
    }
  }

  /**
   * Get all endpoint hints.
   */
  getEndpoints(): readonly EndpointHint[] {
    if (!this.indexBuilt) {
      throw new IndexNotBuiltError();
    }
    return this.backend.getEndpoints();
  }

  /**
   * Get all route bindings (endpoint -> handler).
   */
  getRouteBindings(): readonly RouteBinding[] {
    if (!this.indexBuilt) {
      throw new IndexNotBuiltError();
    }
    return this.backend.getRouteBindings();
  }

  /**
   * Get all database model hints.
   */
  getModels(): readonly ModelHint[] {
    if (!this.indexBuilt) {
      throw new IndexNotBuiltError();
    }
    return this.backend.getModels();
  }

  /**
   * Get all ORM relationship hints.
   */
  getOrmRelationships(): readonly OrmRelationshipHint[] {
    if (!this.indexBuilt) {
      throw new IndexNotBuiltError();
    }
    return this.backend.getOrmRelationships();
  }

  /**
   * Get all file documents.
   */
  getFiles(): readonly FileDoc[] {
    if (!this.indexBuilt) {
      throw new IndexNotBuiltError();
    }
    return this.backend.getFiles();
  }

  /**
   * Get all diagnostics from the indexer.
   */
  getDiagnostics(): readonly IndexDiagnostic[] {
    if (!this.indexBuilt) {
      throw new IndexNotBuiltError();
    }
    return this.backend.getDiagnostics();
  }

  /**
   * Get the complete index document (use sparingly; prefer specific queries).
   */
  getIndex(): IndexDocument {
    if (!this.indexBuilt) {
      throw new IndexNotBuiltError();
    }
    return this.backend.getIndex();
  }

  // --- Private filtering helpers for query types not directly supported by backend ---

  private filterEndpoints(endpoints: readonly EndpointHint[], filter?: IndexQueryFilter): EndpointHint[] {
    if (!filter) return [...endpoints];
    const limit = filter.limit ?? 100;
    const results: EndpointHint[] = [];

    for (const ep of endpoints) {
      if (filter.module && ep.module !== filter.module) continue;
      if (filter.modulePrefix && !ep.module.startsWith(filter.modulePrefix)) continue;
      results.push(ep);
      if (results.length >= limit) break;
    }
    return results;
  }

  private filterModels(models: readonly ModelHint[], filter?: IndexQueryFilter): ModelHint[] {
    if (!filter) return [...models];
    const limit = filter.limit ?? 100;
    const results: ModelHint[] = [];

    for (const model of models) {
      if (filter.module && model.module !== filter.module) continue;
      if (filter.modulePrefix && !model.module.startsWith(filter.modulePrefix)) continue;
      if (filter.qualname && model.name !== filter.qualname) continue;
      if (filter.qualnamePrefix && !model.name.startsWith(filter.qualnamePrefix)) continue;
      results.push(model);
      if (results.length >= limit) break;
    }
    return results;
  }

  private filterRouteBindings(bindings: readonly RouteBinding[], filter?: IndexQueryFilter): RouteBinding[] {
    if (!filter) return [...bindings];
    const limit = filter.limit ?? 100;
    const results: RouteBinding[] = [];

    for (const binding of bindings) {
      if (filter.module && binding.handlerModule !== filter.module) continue;
      if (filter.modulePrefix && !binding.handlerModule.startsWith(filter.modulePrefix)) continue;
      if (filter.qualname && binding.handlerQualname !== filter.qualname) continue;
      if (filter.qualnamePrefix && !binding.handlerQualname.startsWith(filter.qualnamePrefix)) continue;
      results.push(binding);
      if (results.length >= limit) break;
    }
    return results;
  }

  private filterOrmRelationships(rels: readonly OrmRelationshipHint[], filter?: IndexQueryFilter): OrmRelationshipHint[] {
    if (!filter) return [...rels];
    const limit = filter.limit ?? 100;
    const results: OrmRelationshipHint[] = [];

    for (const rel of rels) {
      // Filter by source/target module if we can extract from IDs
      // IDs are like "database_model:app.models.user:User"
      if (filter.sourceModule) {
        const sourceModule = rel.sourceId.split(':')[1];
        if (sourceModule !== filter.sourceModule) continue;
      }
      if (filter.targetModule) {
        const targetModule = rel.targetId.split(':')[1];
        if (targetModule !== filter.targetModule) continue;
      }
      results.push(rel);
      if (results.length >= limit) break;
    }
    return results;
  }

  private filterFiles(files: readonly FileDoc[], filter?: IndexQueryFilter): FileDoc[] {
    if (!filter) return [...files];
    const limit = filter.limit ?? 100;
    const results: FileDoc[] = [];

    for (const file of files) {
      if (filter.module && file.module !== filter.module) continue;
      if (filter.modulePrefix && !file.module.startsWith(filter.modulePrefix)) continue;
      results.push(file);
      if (results.length >= limit) break;
    }
    return results;
  }
}

/**
 * Gaps between IndexService and AGENT_TOOLS.md:
 *
 * 1. `files.read` - NOT IMPLEMENTED
 *    Requires file system access with path validation and exclude enforcement.
 *    Should be implemented in the extension host with privileged file access.
 *
 * 2. `files.search` - NOT IMPLEMENTED
 *    Requires ripgrep or similar search tool integration.
 *    Should be implemented in the extension host.
 *
 * 3. `findings.submit` - NOT IMPLEMENTED
 *    Requires FindingValidator and ArchitectureStore (future milestones).
 *    This service only provides index data for validation.
 *
 * 4. Budget enforcement - NOT IMPLEMENTED
 *    Per AGENT_TOOLS.md, budgets are enforced by the extension host/agent runner.
 *    This service does not track token/turn budgets.
 */