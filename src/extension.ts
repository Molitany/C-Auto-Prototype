import * as vscode from 'vscode';

type VSCodeSymbol = (vscode.SymbolInformation & vscode.DocumentSymbol);

interface Symbol {
	prefix: string;
	codeSymbol: VSCodeSymbol;
}
const FUNCTION = 11;

export function activate(context: vscode.ExtensionContext) {
	const createPrototypes = async () => {
		let editor = vscode.window.activeTextEditor;
		if (editor && isCLanguageFile(editor.document)) {
			const currentDocument = editor.document;
			let symbols: Symbol[];
			if (vscode.workspace.getConfiguration("c-auto-prototypes").get("UseHeader")) {
				const oppositeDocument = await getOppositeFile(currentDocument);
				const { sourceDocument, headerDocument } = determineDocument(currentDocument, oppositeDocument);
				if (headerDocument) {
					symbols = await getSymbols(sourceDocument, headerDocument);
					const headerText = createHeaderText(symbols, headerDocument);
					const workEdits = new vscode.WorkspaceEdit();
					await cleanSource(sourceDocument, symbols, workEdits);
					await editDocument(headerText, headerDocument, workEdits);
					await includeHeader(sourceDocument, headerDocument, workEdits);
					await vscode.workspace.applyEdit(workEdits);
				} else {
					throw new Error(`Header document for ${currentDocument.fileName} could not be accessed`);
				}
			} else {
				const { sourceDocument } = determineDocument(currentDocument);
				symbols = await getSymbols(sourceDocument);
				const sourceText = createSourceText(symbols, sourceDocument);
				const workEdits = new vscode.WorkspaceEdit();
				await editDocument(sourceText, sourceDocument, workEdits);
				await vscode.workspace.applyEdit(workEdits);
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

async function editDocument(text: string, document: vscode.TextDocument, workEdits: vscode.WorkspaceEdit) {
	const endOfFile = new vscode.Position(document.lineCount, document.lineAt(document.lineCount - 1).text.length);
	const startOfFile = new vscode.Position(0, 0);
	workEdits.replace(document.uri, new vscode.Range(startOfFile, endOfFile), text);
}

async function getSymbols(sourceDocument: vscode.TextDocument, headerDocument: vscode.TextDocument | null = null): Promise<Symbol[]> {
	const sourceSymbols = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", sourceDocument.uri) as VSCodeSymbol[];
	if (!sourceSymbols) {
		throw new Error("No symbols found");
	}
	const sourceFunctions: Symbol[] = sourceSymbols.filter(symbol => {
		const main = symbol.name.slice(0, symbol.name.indexOf("("));
		return symbol.kind === FUNCTION && main !== "main";
	}).map(symbol => {
		const functionName = symbol.name.slice(0, symbol.name.indexOf('('));
		const line = sourceDocument.lineAt(symbol.range.start).text.trim();
		const prefix = line.slice(0, line.indexOf(functionName));
		return { prefix: prefix, codeSymbol: symbol };
	});
	let headerPrototypes: Symbol[];

	if (headerDocument) {
		const documentSymbols = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", headerDocument.uri) as VSCodeSymbol[];
		if (documentSymbols) {
			headerPrototypes = documentSymbols.filter(symbol => symbol.kind === FUNCTION)
				.map(symbol => {
					const functionName = symbol.name.slice(0, symbol.name.indexOf('('));
					const line = headerDocument.lineAt(symbol.range.start).text.trim();
					const prefix = line.slice(0, line.indexOf(functionName));
					return { prefix: prefix, codeSymbol: symbol };
				});
		} else {
			headerPrototypes = [];
		}
	} else {
		headerPrototypes = [];
	}

	return sourceFunctions.concat(headerPrototypes);
	// .filter((value, index, array) => {
	// 	return array.map(mapSymbol => mapSymbol.symbol.name).indexOf(value.symbol.name) === index;
	// });
}

function determineDocument(currentDocument: vscode.TextDocument, oppositeDocument: vscode.TextDocument | null = null): { sourceDocument: vscode.TextDocument; headerDocument: vscode.TextDocument | null; } {
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

function createHeaderText(symbols: Symbol[], headerDocument: vscode.TextDocument): string {
	const { fileName } = getDocumentNamePathExtension(headerDocument);
	const headerGuard = `${fileName.toUpperCase()}_H`;
	const headerGuardEnd = `\n\n#endif //${headerGuard}`;
	let preText: string = "";
	let prototypeText: string = "";
	let postText: string = "";
	let textToWrite = `#ifndef ${headerGuard}\n` +
		`#define ${headerGuard}\n\n`;

	symbols.forEach(symbol => {
		if (symbol.codeSymbol.detail !== "declaration") {
			prototypeText += `${symbol.prefix}${symbol.codeSymbol.name};\n`;
		}
	});

	const prevPrototypeText = symbols.map(symbol => `${symbol.prefix}${symbol.codeSymbol.name};\n`).join("");
	const checkText = textToWrite + prototypeText + prevPrototypeText + headerGuardEnd;
	for (let i = 0; i < headerDocument.lineCount; ++i) {
		const lineRange = headerDocument.lineAt(i).rangeIncludingLineBreak;
		const lineText = headerDocument.getText(lineRange);
		if (!checkText.includes(lineText.trim())) {
			if (lineText.startsWith('#')) {
				preText += `${lineText}`;
			} else {
				postText += `${lineText}`;
			}
		}
	}

	textToWrite += `${preText}\n${prototypeText}\n${postText}`.trim();
	textToWrite += headerGuardEnd;
	return textToWrite;
}

async function includeHeader(document: vscode.TextDocument, headerDocument: vscode.TextDocument, workEdits: vscode.WorkspaceEdit) {
	const { fileName } = getDocumentNamePathExtension(headerDocument);
	if (!document.getText().includes(`#include "${fileName}.h"`)) {
		const position = new vscode.Position(0, 0);
		workEdits.insert(document.uri, position, `#include "${fileName}.h"\n`);
	}
}

async function cleanSource(sourceDocument: vscode.TextDocument, symbols: Symbol[], workEdits: vscode.WorkspaceEdit) {
	symbols.filter(symbol => symbol.codeSymbol.detail === "declaration" &&
		symbol.codeSymbol.kind === FUNCTION &&
		symbol.codeSymbol.location.uri === sourceDocument.uri)
		.forEach(symbol => {
			const rangeIncludingLineBreak = new vscode.Range(symbol.codeSymbol.range.start, new vscode.Position(symbol.codeSymbol.range.end.line + 1, 0));
			workEdits.delete(symbol.codeSymbol.location.uri, rangeIncludingLineBreak);
		});
}
function createSourceText(symbols: Symbol[], sourceDocument: vscode.TextDocument) {
	let preText: string = "";
	let prototypeText: string = "";
	let postText: string = "";

	symbols.forEach(symbol => {
		if (symbol.codeSymbol.detail !== "declaration") {
			prototypeText += `${symbol.prefix}${symbol.codeSymbol.name};\n`;
		}
	});
	const prevPrototypeText = symbols.map(symbol => `${symbol.prefix}${symbol.codeSymbol.name};\n`).join("");
	const checkText = prototypeText + prevPrototypeText;
	for (let i = 0; i < sourceDocument.lineCount; ++i) {
		const lineRange = sourceDocument.lineAt(i).rangeIncludingLineBreak;
		const lineText = sourceDocument.getText(lineRange);
		if (!checkText.includes(lineText.trim())) {
			if (lineText.startsWith('#')) {
				preText += `${lineText}`;
			} else {
				postText += `${lineText}`;
			}
		}
	}

	return `${preText}\n${prototypeText}${postText}`.trim();
	
}

