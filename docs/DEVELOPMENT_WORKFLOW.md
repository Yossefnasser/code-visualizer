# Development Workflow for AI Coding Agents

## 1. Before coding
1. Read `AGENTS.md` and the relevant docs.
2. Inspect the current repository, package files, scripts, and existing code.
3. Identify the current roadmap milestone.
4. Summarize the intended change and list the files likely to change.
5. Check for a simpler approach that reuses the existing setup.

For a small, unambiguous task, proceed after a concise plan. Ask the user only when a consequential decision is genuinely unclear.

## 2. During implementation
- Keep the change focused on one milestone or subtask.
- Follow the existing project structure and coding conventions.
- Prefer small components and explicit types.
- Keep the shared data contract separate from UI presentation.
- Add tests for analyzer parsing and contract behavior.
- Keep UI fixtures separate from production data.
- Handle errors explicitly.
- Do not suppress TypeScript/Python errors merely to make the build pass.
- Do not update unrelated dependencies or formatting across the whole repository without a reason.
- Do not replace working configuration wholesale to solve a local issue.

## 3. Dependency policy
Before adding a dependency:
- State what capability it provides.
- Explain why the current dependencies cannot reasonably provide it.
- Consider maintenance, bundle size, and compatibility with the existing Vite/Tailwind v4 setup.
- Avoid adding packages for tiny visual details that can be implemented locally.

Do not add an LLM API, cloud service, database, telemetry, or authentication to the MVP unless the user explicitly approves it.

## 4. Testing and verification
Run the narrowest relevant checks first, then the project build/tests where feasible. Examples:
- Webview: existing lint/build scripts and focused component tests if configured.
- Extension: TypeScript compile/lint and VS Code extension launch checks available in the scaffold.
- Analyzer: Python unit tests and sample-project integration test.
- Contract: validate sample JSON against the schema.

Never report a test as passing unless it was actually run. If a command cannot be run, say why and provide the exact command the user can run.

## 5. Review before finishing
Check:
- Does the change satisfy the milestone acceptance criteria?
- Did it introduce unrelated changes?
- Are paths and imports correct for the actual repository?
- Are errors surfaced to the user?
- Are source relationships evidence-backed?
- Does the UI distinguish missing data from an empty result?
- Were the relevant docs updated?
- Are new files included in the correct repository location?

## 6. Completion report
Use this format:

### Changed
- Brief description of behavior implemented.

### Files
- List important files changed and why.

### Verification
- Commands actually run and observed results.

### Known limitations
- Anything not yet implemented or uncertain.

### Next step
- Recommend one small next action, staying within the current milestone.

## 7. Avoid these failure patterns
- Implementing multiple milestones at once.
- Inventing project structure without inspecting it.
- Repeatedly reinstalling packages without diagnosing the error.
- Replacing configs without understanding existing settings.
- Building a large generic framework before a working vertical slice exists.
- Claiming static analysis proves runtime behavior.
- Adding features because they sound impressive rather than because they meet the agreed MVP.
