# Code Visualizer

A VS Code extension that helps developers understand the architecture of an
existing codebase. A deterministic code index supports a single tool-using AI
agent that explores the repository in bounded steps, identifies architectural
components and relationships, and the extension renders the findings as an
interactive, navigable graph (React Flow).

> **Status:** Milestone 3 (end-to-end AI analysis proof of concept) is in
> progress. The provider layer, deterministic index, index service, and agent
> runner are implemented and tested offline; validation, the v2.0 document
> assembly, and the analysis command are not yet built. The webview currently
> renders a clearly labeled mock fixture. See
> [`docs/MILESTONE_3_STATUS.md`](docs/MILESTONE_3_STATUS.md) for the verified
> state of the project.

## How it works

1. A Python sidecar (`services/analyzer/`) builds a deterministic index of the
   workspace: files, symbols, imports, resolvable call references (plus reverse
   references), and high-confidence framework hints (FastAPI routes,
   SQLAlchemy/Django models). It never executes the analyzed code.
2. The extension host (`src/analysis/`) spawns the sidecar through the
   `IndexBackend` interface and exposes it to the agent via `IndexService`.
3. `AgentRunner` runs a bounded single-agent loop over a `ModelProvider`
   (OpenRouter is the first implementation, plain HTTP, no SDK) using the
   tools `repo.overview`, `index.query`, `files.read`, and `files.search`.
   Findings are returned as structured JSON and can only be `inferred` or
   `unresolved` -- never `confirmed`.
4. (Planned) A two-tier validator checks source locations against the index
   and gates `confirmed` status on deterministic verification of the
   relationship itself; an architecture store assembles the contract v2.0
   document for the webview.

Design documents: [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md),
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/ARCHITECTURE_DATA_MODEL.md`](docs/ARCHITECTURE_DATA_MODEL.md),
[`docs/AGENT_TOOLS.md`](docs/AGENT_TOOLS.md),
[`docs/INDEX_TO_GRAPH_MAPPING.md`](docs/INDEX_TO_GRAPH_MAPPING.md),
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## Requirements

- VS Code `^1.107.0`
- Node.js and npm (for building the extension and webview)
- Python 3.10+ (for the indexer sidecar; developed and tested on 3.12)
- An OpenRouter API key (for AI analysis; stored only in VS Code
  SecretStorage)

## Getting started

```powershell
cd code-visualizer
npm install
npm run compile        # type-check -> lint -> webview build -> extension bundle
```

Then press **F5** (`Run Extension`) to open the Extension Development Host,
and run **Code Visualizer: Open Code Visualizer** from the command palette to
open the webview (currently showing the labeled mock fixture).

To configure the model provider:

1. Run **Code Visualizer: Set OpenRouter API Key** and paste your key from
   https://openrouter.ai/keys. It is stored in SecretStorage only.
2. Set the model via `codeVisualizer.openRouter.model`
   (default `openai/gpt-4o-mini`).
3. If your model does not support JSON-schema structured output, set
   `codeVisualizer.openRouter.structuredOutput` to `false`.

## Extension settings

This extension contributes the following settings:

- `codeVisualizer.openRouter.model`: OpenRouter model id used for AI analysis
  (default `openai/gpt-4o-mini`).
- `codeVisualizer.openRouter.structuredOutput`: request JSON-schema structured
  output from the model (default `true`).

## Commands

- `code-visualizer.openVisualizer` -- Open Code Visualizer (webview).
- `code-visualizer.setOpenRouterApiKey` -- Store the OpenRouter API key in
  SecretStorage.

## Privacy

When analysis runs, source excerpts the agent selects are sent to the
configured model provider (OpenRouter and its upstream model vendors). The
extension itself sends no telemetry. API keys live only in VS Code
SecretStorage and are never logged.

## Development

```powershell
npm run compile        # one-shot build (also the F5 pre-launch task)
npm run watch          # background watch builds (manual use)
npm test               # extension host tests (Mocha via @vscode/test-cli)
python -m unittest discover -s services/analyzer/tests -t services/analyzer
```

All AI-dependent behavior is testable offline behind a mocked `ModelProvider`;
tests never call real model APIs. See
[`docs/DEVELOPMENT_WORKFLOW.md`](docs/DEVELOPMENT_WORKFLOW.md) for the full
workflow and [`AGENTS.md`](AGENTS.md) for contributor rules.

## Known issues

- No analysis command yet: the agent pipeline is implemented but not wired to
  the UI, so the webview still shows the mock fixture.
- The webview types still describe contract v1.0; v2.0 fields (`origin`,
  `parentId`, `analysis`, `units`, `summaries`) are not yet typed in the UI.

## Release notes

See [`CHANGELOG.md`](CHANGELOG.md).
