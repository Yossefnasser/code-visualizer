// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Create an output channel so we can trace activation and command execution
	// View it via: View -> Output -> "Code Visualizer"
	const output = vscode.window.createOutputChannel('Code Visualizer');
	output.appendLine('[activate] Extension is activating...');
	output.show(true);

	// This line goes to the Debug Console of the window that launched the debugger
	console.log('Congratulations, your extension "code-visualizer" is now active!');

	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('code-visualizer.helloWorld', () => {
		output.appendLine('[helloWorld] Command was executed!');
		console.log('helloWorld command executed');
		// Show the toast in the bottom-right corner AND log to the output channel
		vscode.window.showInformationMessage('Hello World from code visualizer! (command ran successfully)');
		var panel = vscode.window.createWebviewPanel(
			'visual',
			'Code Visualizer',
			vscode.ViewColumn.One
		);
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(output);
}

// This method is called when your extension is deactivated
export function deactivate() {}
