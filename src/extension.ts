import * as vscode from 'vscode';
import * as fs from 'fs';

function isSourceFile(document: vscode.TextDocument): boolean {
	return document.fileName.endsWith(".c");
}


async function getHeaderFile(document: vscode.TextDocument): Promise<vscode.TextDocument | null> {
	const lastSlashIndex = document.fileName.lastIndexOf('\\');
	const extensionIndex = document.fileName.lastIndexOf(".");
	const fileName = document.fileName.slice(lastSlashIndex + 1, extensionIndex);
	const path = document.fileName.slice(0, lastSlashIndex + 1);
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (workspaceFolder) {
		if ((await vscode.workspace.findFiles(`*/${fileName}.h`)).length < 1) 
		{
			await fs.open(`${path}${fileName}.h`, 'w', (err, file) => {
				if (err) {
					throw err;
				} 
			});
		}
		return await vscode.workspace.openTextDocument(`${path}${fileName}.h`);
	}
	return null;
};


export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "c-auto-prototypes" is now active!');

	const createPrototypes = async () => {
		let editor = vscode.window.activeTextEditor;
		if (editor && isSourceFile(editor.document)) {
			if (vscode.workspace.getConfiguration("c-auto-prototypes").get("UseHeader")) {
				const headerDocument = await getHeaderFile(editor.document);
			}
		}
	};

	context.subscriptions.push(vscode.commands.registerCommand('c-auto-prototypes.createPrototypes', createPrototypes));
}

export function deactivate() { }
