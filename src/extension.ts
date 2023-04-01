import * as vscode from 'vscode';
import * as diff from "fast-diff";

interface Symbol {
	returnType: string;
	symbol: vscode.DocumentSymbol;
}

function isSourceFile(document: vscode.TextDocument): boolean {
	return document.fileName.endsWith(".c");
}

async function getHeaderFile(document: vscode.TextDocument): Promise<vscode.TextDocument | null> {
	const { fileName, path } = getDocumentNameAndPath(document);
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (workspaceFolder) {
		if ((await vscode.workspace.findFiles(`*/${fileName}.h`)).length < 1) {
			const workEdits = new vscode.WorkspaceEdit();
			workEdits.createFile(vscode.Uri.file(`${path}${fileName}.h`));
			await vscode.workspace.applyEdit(workEdits);

		}
		return await vscode.workspace.openTextDocument(`${path}${fileName}.h`);
	}
	return null;
};

function getDocumentNameAndPath(document: vscode.TextDocument): { fileName: string, path: string } {
	const lastSlashIndex = document.fileName.lastIndexOf('\\');
	const extensionIndex = document.fileName.lastIndexOf(".");
	const fileName = document.fileName.slice(lastSlashIndex + 1, extensionIndex);
	const path = document.fileName.slice(0, lastSlashIndex + 1);
	return { fileName, path };
}

function editDocument(text: string, document: vscode.TextDocument) {
	const workEdits = new vscode.WorkspaceEdit();
	const endOfFile = new vscode.Position(document.lineCount, document.lineAt(document.lineCount - 1).text.length);
	const startOfFile = new vscode.Position(0, 0);
	workEdits.replace(document.uri, new vscode.Range(startOfFile, endOfFile), text);
	vscode.workspace.applyEdit(workEdits);
}

async function getPrototypes(sourceDocument: vscode.TextDocument, document: vscode.TextDocument | null = null): Promise<Symbol[]> {
	const sourceSymbols = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", sourceDocument.uri) as vscode.DocumentSymbol[];
	if (!sourceSymbols) {
		throw new Error("No symbols found");
	}
	const sourceFunctions: Symbol[] = sourceSymbols.filter(symbol => {
		const main = symbol.name.slice(0, symbol.name.indexOf("("));
		return symbol.kind === 11 && main !== "main";
	}).map(symbol => {
		const returnType = sourceDocument.lineAt(symbol.range.start).text.trim().replace(/ .*/, "");
		return { returnType: returnType, symbol: symbol };
	});
	let headerPrototypes: Symbol[];

	if (document) {
		const documentSymbols = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", document.uri) as vscode.DocumentSymbol[];
		if (documentSymbols) {
			headerPrototypes = documentSymbols.filter(symbol => symbol.kind === 11 && symbol.detail === "declaration")
				.map(symbol => {
					const returnType = document.lineAt(symbol.range.start).text.trim().replace(/ .*/, "");
					return { returnType: returnType, symbol: symbol };
				});
		} else {
			headerPrototypes = [];
		}
	} else {
		headerPrototypes = [];
	}

	return sourceFunctions.concat(headerPrototypes)
		.filter((value, index, array) => {
			return array.map(mapSymbol => mapSymbol.symbol.name).indexOf(value.symbol.name) === index;
		});
}

function createHeaderText(prototypes: Symbol[], document: vscode.TextDocument): string {
	const { fileName } = getDocumentNameAndPath(document);
	const headerGuard = `${fileName.toUpperCase()}_H`;
	const headerGuardEnd = `\n\n#endif //${headerGuard}`;
	let textToWrite = `#ifndef ${headerGuard}\n` +
		`#define ${headerGuard}\n\n`;
	prototypes.forEach(symbol => {
		textToWrite += `${symbol.returnType} ${symbol.symbol.name};\n`;
	});
	textToWrite += '\n';
	const additionalHeaderText = diff((textToWrite + headerGuardEnd), document.getText().replace(/\r/gm, ""));
	additionalHeaderText.forEach(difference => {
		if (difference[0] === 1) {
			textToWrite += difference[1];
		}
	});
	textToWrite = textToWrite.trim();
	textToWrite += headerGuardEnd;
	return textToWrite;
}

function includeHeader(document: vscode.TextDocument, headerDocument: vscode.TextDocument) {
	const { fileName } = getDocumentNameAndPath(headerDocument);
	if (!document.getText().includes(`#include "${fileName}.h"`)) {
		const workEdits = new vscode.WorkspaceEdit();
		const position = new vscode.Position(0, 0);
		workEdits.insert(document.uri, position, `#include "${fileName}.h"\n`);
		vscode.workspace.applyEdit(workEdits);
	}
}

export function activate(context: vscode.ExtensionContext) {
	const createPrototypes = async () => {
		let editor = vscode.window.activeTextEditor;
		if (editor && isSourceFile(editor.document)) {
			const sourceDocument = editor.document;
			let prototypes: Symbol[];
			if (vscode.workspace.getConfiguration("c-auto-prototypes").get("UseHeader")) {
				const headerDocument = await getHeaderFile(sourceDocument);
				if (headerDocument) {
					prototypes = await getPrototypes(sourceDocument, headerDocument);
					const headerText = createHeaderText(prototypes, headerDocument);
					editDocument(headerText, headerDocument);
					includeHeader(sourceDocument, headerDocument);
				} else {
					throw new Error(`Header document for ${sourceDocument.fileName} could not be accessed`);
				}
			} else {
				prototypes = await getPrototypes(sourceDocument);
			}
		}
	};

	context.subscriptions.push(vscode.commands.registerCommand('c-auto-prototypes.createPrototypes', createPrototypes));
}

export function deactivate() { }

