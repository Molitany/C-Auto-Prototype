import * as vscode from 'vscode';

interface Symbol {
	returnType: string;
	symbol: vscode.DocumentSymbol;
}

export function activate(context: vscode.ExtensionContext) {
	const createPrototypes = async () => {
		let editor = vscode.window.activeTextEditor;
		if (editor && isCLanguageFile(editor.document)) {
			const currentDocument = editor.document;
			let prototypes: Symbol[];
			if (vscode.workspace.getConfiguration("c-auto-prototypes").get("UseHeader")) {
				const oppositeDocument = await getOppositeFile(currentDocument);
				const { sourceDocument, headerDocument } = determineDocument(currentDocument, oppositeDocument);
				if (headerDocument) {
					prototypes = await getPrototypes(sourceDocument, headerDocument);
					const headerText = createHeaderText(prototypes, headerDocument);
					editDocument(headerText, headerDocument);
					includeHeader(sourceDocument, headerDocument);
				} else {
					throw new Error(`Header document for ${currentDocument.fileName} could not be accessed`);
				}
			} else {
				prototypes = await getPrototypes(currentDocument);
			}
		}
	};

	context.subscriptions.push(vscode.commands.registerCommand('c-auto-prototypes.createPrototypes', createPrototypes));
}

export function deactivate() { }


function isCLanguageFile(document: vscode.TextDocument): boolean {
	return document.fileName.endsWith(".c") || document.fileName.endsWith(".h");
}

async function getOppositeFile(document: vscode.TextDocument): Promise<vscode.TextDocument | null> {
	const { fileName, path, extension } = getDocumentNamePathExtension(document);
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (workspaceFolder) {
		if (extension === ".c") {
			await createFileIfNotExist(".h");
			return await vscode.workspace.openTextDocument(`${path}${fileName}.h`);
		} else {
			await createFileIfNotExist(".c");
			return await vscode.workspace.openTextDocument(`${path}${fileName}.c`);
		}
	}
	return null;

	async function createFileIfNotExist(extension: string) {
		if ((await vscode.workspace.findFiles(`*/${fileName}${extension}`)).length < 1) {
			const workEdits = new vscode.WorkspaceEdit();
			workEdits.createFile(vscode.Uri.file(`${path}${fileName}${extension}`));
			await vscode.workspace.applyEdit(workEdits);
		}
	}
};

function getDocumentNamePathExtension(document: vscode.TextDocument): { fileName: string, path: string, extension: string } {
	const lastSlashIndex = document.fileName.lastIndexOf('\\');
	const extensionIndex = document.fileName.lastIndexOf(".");
	const path = document.fileName.slice(0, lastSlashIndex + 1);
	const fileName = document.fileName.slice(lastSlashIndex + 1, extensionIndex);
	const extension = document.fileName.slice(extensionIndex, document.fileName.length + 1);
	return { fileName, path, extension };
}

function editDocument(text: string, document: vscode.TextDocument) {
	const workEdits = new vscode.WorkspaceEdit();
	const endOfFile = new vscode.Position(document.lineCount, document.lineAt(document.lineCount - 1).text.length);
	const startOfFile = new vscode.Position(0, 0);
	workEdits.replace(document.uri, new vscode.Range(startOfFile, endOfFile), text);
	vscode.workspace.applyEdit(workEdits);
}

async function getPrototypes(sourceDocument: vscode.TextDocument, headerDocument: vscode.TextDocument | null = null): Promise<Symbol[]> {
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

	if (headerDocument) {
		const documentSymbols = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", headerDocument.uri) as vscode.DocumentSymbol[];
		if (documentSymbols) {
			headerPrototypes = documentSymbols.filter(symbol => symbol.kind === 11 && symbol.detail === "declaration")
				.map(symbol => {
					const returnType = headerDocument.lineAt(symbol.range.start).text.trim().replace(/ .*/, "");
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

function determineDocument(currentDocument: vscode.TextDocument, oppositeDocument: vscode.TextDocument | null): { sourceDocument: vscode.TextDocument; headerDocument: vscode.TextDocument | null; }  {
	const { extension } = getDocumentNamePathExtension(currentDocument);
	let sourceDocument: vscode.TextDocument;
	let headerDocument: vscode.TextDocument | null;
	if (oppositeDocument) {
		if (extension === ".c") {
			sourceDocument = currentDocument;
			headerDocument = oppositeDocument;
		} else {
			sourceDocument = oppositeDocument;
			headerDocument = currentDocument;
		}
	} else {
		sourceDocument = currentDocument;
		headerDocument = null;
	}
	return { sourceDocument, headerDocument };
}

function createHeaderText(prototypes: Symbol[], document: vscode.TextDocument): string {
	const { fileName } = getDocumentNamePathExtension(document);
	const headerGuard = `${fileName.toUpperCase()}_H`;
	const headerGuardEnd = `\n\n#endif //${headerGuard}`;
	let preText: string = "";
	let prototypeText: string = "";
	let postText: string = "";
	let textToWrite = `#ifndef ${headerGuard}\n` +
		`#define ${headerGuard}\n\n`;

	prototypes.forEach(symbol => {
		prototypeText += `${symbol.returnType} ${symbol.symbol.name};\n`;
	});

	const checkText = textToWrite + prototypeText + headerGuardEnd;
	for (let i = 0; i < document.lineCount; ++i) {
		const lineText = document.lineAt(i).text;
		if (!checkText.includes(lineText)) {
			if (lineText.startsWith('#')) {
				preText += `${lineText}\n`;
			} else {
				postText += `${lineText}\n`;
			}
		}
	}

	textToWrite += `${preText}\n${prototypeText}\n${postText}`;
	textToWrite = textToWrite.trim();
	textToWrite += headerGuardEnd;
	return textToWrite;
}

function includeHeader(document: vscode.TextDocument, headerDocument: vscode.TextDocument) {
	const { fileName } = getDocumentNamePathExtension(headerDocument);
	if (!document.getText().includes(`#include "${fileName}.h"`)) {
		const workEdits = new vscode.WorkspaceEdit();
		const position = new vscode.Position(0, 0);
		workEdits.insert(document.uri, position, `#include "${fileName}.h"\n`);
		vscode.workspace.applyEdit(workEdits);
	}
}