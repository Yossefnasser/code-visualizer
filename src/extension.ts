import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { OPENROUTER_API_KEY_SECRET } from './analysis/openRouterConfig';

// The webview UI is a Vite app built into webview-ui/dist. Only the production
// build is ever loaded here; no development-server paths are used.
const WEBVIEW_DIST_DIR = path.join('webview-ui', 'dist');

/**
 * Reads the built webview index.html and rewrites it so its assets load from
 * the sandboxed webview resource scheme.
 */
function getWebviewHtml(webview: vscode.Webview, context: vscode.ExtensionContext): string {
	const distPath = path.join(context.extensionPath, WEBVIEW_DIST_DIR);
	const indexPath = path.join(distPath, 'index.html');

	if (!fs.existsSync(indexPath)) {
		throw new Error(
			`Code Visualizer webview build not found at ${indexPath}. ` +
			'Run "npm run build:webview" (or "npm run compile") first.'
		);
	}

	// Vite is configured with base: './', so asset URLs look like "./assets/...".
	// Rewrite them to webview resource URIs.
	const baseUrl = webview.asWebviewUri(vscode.Uri.file(distPath)).toString();
	let html = fs.readFileSync(indexPath, 'utf8');

	html = html.replace(
		/(src|href)="\.\/([^"]*)"/g,
		(_match: string, attribute: string, asset: string) => `${attribute}="${baseUrl}/${asset}"`
	);

	// Vite emits `crossorigin` on scripts, stylesheets, and modulepreload links.
	// The VS Code webview resource scheme does not handle CORS requests, so the
	// attribute must be removed for module scripts to load.
	html = html.replace(/\s+crossorigin(="[^"]*")?/g, '');

	// Restrict the webview to resources served by this extension.
	const csp = [
		"default-src 'none'",
		`img-src ${webview.cspSource} https:`,
		`script-src ${webview.cspSource}`,
		`style-src ${webview.cspSource}`,
		`font-src ${webview.cspSource}`,
	].join('; ');
	html = html.replace('<head>', `<head>\n\t\t<meta http-equiv="Content-Security-Policy" content="${csp}">`);

	return html;
}

function openVisualizer(context: vscode.ExtensionContext, output: vscode.OutputChannel): void {
	const distPath = path.join(context.extensionPath, WEBVIEW_DIST_DIR);

	const panel = vscode.window.createWebviewPanel(
		'codeVisualizer',
		'Code Visualizer',
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			localResourceRoots: [vscode.Uri.file(distPath)],
			retainContextWhenHidden: true,
		}
	);

	try {
		panel.webview.html = getWebviewHtml(panel.webview, context);
		output.appendLine('[openVisualizer] Webview panel opened.');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		output.appendLine(`[openVisualizer] Error: ${message}`);
		panel.webview.html = `<!doctype html><html><body><p>${message}</p></body></html>`;
		vscode.window.showErrorMessage(`Code Visualizer: ${message}`);
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Output channel so activation and command execution can be traced.
	// View it via: View -> Output -> "Code Visualizer"
	const output = vscode.window.createOutputChannel('Code Visualizer');
	output.appendLine('[activate] Extension is activating...');

	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('code-visualizer.openVisualizer', () => {
		output.appendLine('[openVisualizer] Command was executed!');
		openVisualizer(context, output);
	});

	// Store the OpenRouter API key in SecretStorage via the command palette:
	// "Code Visualizer: Set OpenRouter API Key". The value is never logged.
	const setApiKey = vscode.commands.registerCommand(
		'code-visualizer.setOpenRouterApiKey',
		async () => {
			const input = await vscode.window.showInputBox({
				title: 'OpenRouter API Key',
				prompt:
					'Paste your OpenRouter API key from https://openrouter.ai/keys. ' +
					'It is stored in SecretStorage and never logged.',
				password: true,
				ignoreFocusOut: true,
				validateInput: (value: string): string | undefined =>
					value.trim().length === 0 ? 'API key must not be empty.' : undefined,
			});
			if (input === undefined) {
				output.appendLine('[setOpenRouterApiKey] Cancelled; stored key unchanged.');
				return;
			}
			await context.secrets.store(OPENROUTER_API_KEY_SECRET, input.trim());
			output.appendLine('[setOpenRouterApiKey] API key saved to SecretStorage.');
			void vscode.window.showInformationMessage('OpenRouter API key saved.');
		}
	);

	context.subscriptions.push(disposable, setApiKey);
	context.subscriptions.push(output);
}

// This method is called when your extension is deactivated
export function deactivate() {}
