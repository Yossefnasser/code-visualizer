/**
 * Prototype data path: load a committed Index Contract v1 example document,
 * validate it, and map it deterministically to a Graph v2.0 document with
 * `mapIndexToGraph`. No LLM calls, no agent, no sidecar.
 *
 * This is display wiring only — it is NOT real analysis. Real analysis requires
 * `FindingValidator`, `AnalysisController`, and a live agent run. The example
 * documents in `packages/contracts/examples/` are labeled fixtures.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { validateIndexDocument, type IndexDocumentV1 } from './indexContract';
import { mapIndexToGraph, type ArchitectureGraph } from './indexToGraphMapper';

const CONTRACT_EXAMPLES_DIR = ['packages', 'contracts', 'examples'];

/** Default example: complete coverage, route/endpoint, subsystem/service, one AI relationship. */
export const DEFAULT_EXAMPLE_FILE = 'index-v1.complete.json';

/** Typed error so callers can show actionable diagnostics. */
export class ExampleGraphError extends Error {
  constructor(message: string, readonly code: 'file_not_found' | 'invalid_json' | 'invalid_contract') {
    super(message);
    this.name = 'ExampleGraphError';
  }
}

/**
 * Loads an Index Contract v1 example and maps it to a Graph v2.0 document.
 * The graph is returned unfiltered — the consumer (e.g. the webview) decides
 * which edge types are visible (see docs/ARCHITECTURE_DATA_MODEL.md §12).
 */
export function loadExampleGraph(extensionRoot: string, fileName: string = DEFAULT_EXAMPLE_FILE): ArchitectureGraph {
  const filePath = path.join(extensionRoot, ...CONTRACT_EXAMPLES_DIR, fileName);

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new ExampleGraphError(
      `Index Contract example not readable at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      'file_not_found',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ExampleGraphError(
      `Index Contract example ${fileName} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      'invalid_json',
    );
  }

  const errors = validateIndexDocument(parsed);
  if (errors.length > 0) {
    throw new ExampleGraphError(
      `Index Contract example ${fileName} failed validation: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
      'invalid_contract',
    );
  }

  const { graph, warnings } = mapIndexToGraph(parsed as IndexDocumentV1);
  // Warnings should never occur for the committed examples (all entry types
  // are supported); if one ever does, surface it as a parse diagnostic rather
  // than silently accepting a reduced graph.
  for (const warning of warnings) {
    graph.diagnostics.push({
      severity: 'warning',
      code: 'mapper_warning',
      message: warning,
    });
  }
  return graph;
}
