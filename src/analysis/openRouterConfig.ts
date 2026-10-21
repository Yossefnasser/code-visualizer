import * as vscode from 'vscode';

/**
 * SecretStorage key for the OpenRouter API key.
 * The value is only ever read via `context.secrets` and never logged.
 */
export const OPENROUTER_API_KEY_SECRET = 'codeVisualizer.openrouter.apiKey';

const CONFIG_SECTION = 'codeVisualizer.openRouter';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

/** Reads the stored OpenRouter API key; empty string when not configured. */
export async function getOpenRouterApiKey(
	context: vscode.ExtensionContext
): Promise<string> {
	return (await context.secrets.get(OPENROUTER_API_KEY_SECRET)) ?? '';
}

/** Reads the configured OpenRouter model id, falling back to the default. */
export function getOpenRouterModel(): string {
	const model = vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<string>('model', DEFAULT_MODEL)
		.trim();
	return model.length > 0 ? model : DEFAULT_MODEL;
}

/** Whether structured output (response_format json_schema) should be requested. */
export function getStructuredOutput(): boolean {
	return vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<boolean>('structuredOutput', true);
}
