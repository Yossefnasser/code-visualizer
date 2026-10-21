# Development Workflow for AI Coding Agents

## 1. Before coding
1. Read `AGENTS.md` and the relevant docs.
2. Inspect the current repository, package files, scripts, and existing code.
3. Identify the current roadmap milestone. The current priority is the end-to-end AI analysis proof of concept (ROADMAP Milestone 3).
4. Summarize the intended change and list the files likely to change.
5. Check for a simpler approach that reuses the existing setup.

For a small, unambiguous task, proceed after a concise plan. Ask the user only when a consequential decision is genuinely unclear.

## 2. During implementation
- Keep the change focused on one milestone or subtask.
- Follow the existing project structure and coding conventions.
- Prefer small components and explicit types.
- Keep the shared data contract separate from UI presentation, and keep the UI provider-agnostic.
- AI-specific rules:
  - Deterministic utilities support the agent; never extend rule-based interpretation to substitute for it. Do not add hand-written framework rules.
  - Validate findings in two tiers -- source-location validation and semantic relationship validation -- and encode results honestly. `confirmed` is reserved for relationships that were deterministically verified, not merely for claims whose endpoints exist.
  - Inject model access behind the `ModelProvider` interface so all AI-dependent behavior is testable offline.
  - Keep budgets, timeouts, retries, and model selection configurable rather than hardcoded.
- Keep UI fixtures separate from production data.
- Handle errors explicitly; do not suppress TypeScript/Python errors merely to make the build pass.
- Do not update unrelated dependencies or formatting across the whole repository without a reason.
- Do not replace working configuration wholesale to solve a local issue.

## 3. Dependency policy
Before adding a dependency:
- State what capability it provides.
- Explain why the current dependencies cannot reasonably provide it.
- Consider maintenance, bundle size, and compatibility with the existing Vite/Tailwind v4 setup.
- Avoid adding packages for tiny visual details that can be implemented locally.

Additional rules for the AI pipeline:
- The OpenRouter integration uses plain HTTP from the extension host; do not add provider SDKs.
- Do not add telemetry, authentication, or analytics packages.
- LLM usage is now a core product capability, but every new package still requires the justification above.

## 4. Testing and verification
Run the narrowest relevant checks first, then the project build/tests where feasible:
- Webview: existing lint/build scripts and focused component tests if configured.
- Extension: TypeScript compile/lint and VS Code extension launch checks available in the scaffold.
- Indexer sidecar: Python unit tests, e.g. `python -m unittest discover -s services/analyzer/tests -t services/analyzer`.
- Contract: validate sample JSON against the schema on both sides.
- AI pipeline: run against a mocked `ModelProvider` only. Never call real model APIs in tests.

Never report a test as passing unless it was actually run. If a command cannot be run, say why and provide the exact command the user can run.
### 4a. Verified command reference

From the repository root (`code-visualizer/`):

| Command | Purpose | Observed result |
| --- | --- | --- |
| `npm run compile` | type-check -> lint -> webview build -> extension bundle | exit 0 |
| `npm test` | extension host tests (Mocha via `@vscode/test-cli`) | 12 passing |
| `python -m unittest discover -s services/analyzer/tests -t services/analyzer` | analyzer/indexer tests | 40 tests, OK |
| `python -m analyzer <root> --index` | emit the deterministic index document as JSON on stdout | used by the future `IndexService` |

`npm run compile` is the one-shot build used by the F5 pre-launch task, so
running it before F5 is not necessary -- but it is the fastest way to check that
a change compiles.

### 4b. Running the extension (F5)

- F5 runs the one-shot `build` task from `.vscode/tasks.json`
  (`npm run compile`) and then opens the Extension Development Host.
- The `build` task deliberately replaces the background `watch` task as the
  pre-launch task: `watch` never signals readiness to the problem matcher in
  this environment, so F5 would hang before the host opened.
- The background `watch` tasks remain available for manual use
  (`npm run watch`).
- The `Run Extension` launch configuration is only offered when this repository
  is the opened workspace folder; opening a different folder hides it.
- On Windows, `code --extensionDevelopmentPath=...` can fail with an ICU
  launcher error; launching `Code.exe` directly is the fallback.

### 4c. Configuring the model provider

- API key: `Ctrl+Shift+P` -> `Code Visualizer: Set OpenRouter API Key`. The key
  is stored in VS Code SecretStorage only.
- Model: setting `codeVisualizer.openRouter.model` (default
  `openai/gpt-4o-mini`).
- Structured output: setting `codeVisualizer.openRouter.structuredOutput`
  (default `true`); disable it for models without `response_format` json_schema
  support.
- Provider tests inject `fetchImpl` and `sleep`, so they never touch the
  network. Keep it that way: no test may call a real model API.


## 5. Review before finishing
Check:
- Does the change satisfy the milestone acceptance criteria?
- Did it introduce unrelated changes?
- Are paths and imports correct for the actual repository?
- Are errors surfaced to the user?
- AI-specific checks:
  - Are `origin` and evidence statuses set honestly (`confirmed` only after semantic verification)?
  - Are source locations validated before display?
  - Are credentials only in SecretStorage and never logged?
  - Is the privacy disclosure present and are exclude patterns honored?
  - Did the change add hand-written framework interpretation rules? It should not.
  - Does the UI distinguish missing data from an empty result, and show partial status when applicable?
- Were the relevant docs updated?

## 6. Completion report
Use this format:

### Changed
- Brief description of behavior implemented.

### Files
- List important files changed and why.

### Verification
- Commands actually run and observed results.

### AI run notes (when applicable)
- Model used, token usage, estimated cost, partial/unexplored scopes.

### Known limitations
- Anything not yet implemented or uncertain.

### Next step
- Recommend one small next action, staying within the current milestone.

## 7. Avoid these failure patterns
- Implementing multiple milestones at once.
- Inventing project structure without inspecting it.
- Growing hand-written framework rules to do the LLM's job.
- Assuming one prompt or one model call can understand an entire repository.
- Treating the existence of two symbols as proof of a relationship between them.
- Hardcoding model names, API keys, or budgets that should be configurable.
- Calling real model APIs in tests, or claiming unrun tests/validation passed.
- Building a large generic framework before a working vertical slice exists.
- Replacing working configuration wholesale to solve a local issue.