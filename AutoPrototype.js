const vscode = require('vscode');


function activate(context) {

	let disposable = vscode.commands.registerCommand('AutoPrototype.prototypeCreate', function () {
		let editor = vscode.window.activeTextEditor;


		if (editor) {
			
			let document = editor.document;
			let headerName = document.fileName.split("\\")[document.fileName.split("\\").length - 1].replace(/.c/, ".h");

			vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", document.uri).then(function (symbols) {
				let symbolsarr = [];
				let mainStart, prototypeStart = 0;
				for (let i = 0; i < symbols.length; i++) {
					if (symbols[i].kind == 11) {
						let symboltext = document.lineAt(symbols[i].location.range.start.line).text;
						if (symboltext.search("main") == -1) {
							if (symboltext.search(";") == -1) {
								if (symboltext.search("{") != -1)
									symbolsarr.push(symboltext.replace(/{$/, ';'));
								else
									symbolsarr.push(symboltext.concat(";"));
							} else {
								prototypeStart = prototypeStart == 0 ? symbols[i].location.range.start.line : prototypeStart;
							}
						} else {
							mainStart = symbols[i].location.range.start.line;
						}
					}
				}
				if (mainStart == undefined){
					for (let i = 0; i < symbols.length; i++) {
						if (symbols[i].kind == 11) {
							mainStart = document.lineAt(symbols[i].location.range.start.line).lineNumber;
							break;
						}
					}
				}

				let prototypeString = "";
				let headerFound = false;
				let preHeaderData = "";

				for (let i = 0; i < symbolsarr.length; i++) {
					prototypeString = prototypeString.concat(symbolsarr[i]);
					prototypeString = prototypeString.concat("\n");
				}

				vscode.workspace.findFiles(headerName.replace("\"", "")).then(function (header) {
					for (let documentLine = 0; documentLine < document.lineCount; documentLine++) {
						if (document.lineAt(documentLine).text == "#include \"" + headerName + "\"") {
							let headerData = "";
							let modifiedHeaderData = "";
							let commentCount = 0;
							headerFound = true;
							if (documentLine > 0){
								for (let i = 0; i < mainStart; i++) {
									if (document.lineAt(i).text.includes("/*")){
										for (let j = i; j < document.lineCount; j++) {
											if (!document.lineAt(j).text.includes("*/")){
												commentCount++;
											}else{
												break;
											}
										}
										i += commentCount;
									}else if (document.lineAt(i).text != "#include \"" + headerName + "\""){
										preHeaderData += document.lineAt(new vscode.Position(document.lineAt(i).lineNumber, 0)).text;
										preHeaderData = preHeaderData.concat("\n");
									}
								}
							}

							headerData = preHeaderData + "\n" + prototypeString.trim();
							vscode.workspace.openTextDocument(header[0]).then( headerDocument => {
								if (headerDocument.uri.fsPath == header[0].fsPath){
									let currentHeaderData = headerDocument.getText();
									let headerDataLineText = headerData.split("\n");
									for (let headerLine = 0; headerLine < headerDocument.lineCount; headerLine++) {
										headerDataLineText.forEach(str => {
											if ((headerDocument.lineAt(headerLine).text == str) && headerDocument.lineAt(headerLine).text != "\n" && headerDocument.lineAt(headerLine).text != "};"){
												currentHeaderData = currentHeaderData.replace(headerDocument.lineAt(headerLine).text, "");
											}
											
										});

									}


									modifiedHeaderData = currentHeaderData.trim() + "\n" + headerData.trim();
									let substrHeaderData = modifiedHeaderData.split("\n");
									modifiedHeaderData = "";
									substrHeaderData.forEach(str => {
										if (str.startsWith("#include")){
											modifiedHeaderData = str + "\n" + modifiedHeaderData;
										} else if (str.startsWith("#define")){
											if (modifiedHeaderData.search("#include") == -1){
												modifiedHeaderData = str + "\n" + modifiedHeaderData;
											} else{
												let match = modifiedHeaderData.match(/#define .+?\r\n/g) == null ? [] : modifiedHeaderData.match(/#define .+?\r\n/g);
												if (match.length == 0){
													modifiedHeaderData = modifiedHeaderData + "\n" + str + "\n";
													return
												}
												let lastIndex = modifiedHeaderData.lastIndexOf(match[match.length-1]);
												modifiedHeaderData = modifiedHeaderData.slice(0,lastIndex) + str + "\n" + modifiedHeaderData.slice(lastIndex);
											}
										}else if (str != "\r"){
											if (symbolsarr.includes(str.trim())){
												if (headerData.split("\n").includes(str)){
													modifiedHeaderData = modifiedHeaderData + "\n" + str;
												}
											}else if (!str.includes(");")){
												if (str.includes(";")){
													modifiedHeaderData = modifiedHeaderData + "\n" + str + "\n";
												}else{
													modifiedHeaderData = modifiedHeaderData + "\n" + str;
												}
											}
										}
									});
									modifiedHeaderData += "\n";
									
								}
								let precommentText = "",
									postcommentText = "";
								for (let i = 0; i < mainStart; i++) {
									if (document.lineAt(i).text.includes("/*")){
										for (let j = i; j < mainStart; j++) {
											if (!document.lineAt(j).text.includes("*/")){
												postcommentText += document.lineAt(new vscode.Position(document.lineAt(j).lineNumber, 0)).text;
												postcommentText += "\n";

												if (document.lineAt(j+3).text.includes("#")){
													precommentText = postcommentText;
													postcommentText = "";
												}
											}else{
												break;
											}
										}
										if ((precommentText != "" || precommentText.includes("*/")) && postcommentText == ""){
											precommentText += "*/";
											precommentText += "\n\n";
										}else{
											postcommentText += "*/";
										}

										if (!document.lineAt(i+1).text.includes("/*")){
											postcommentText += "\n";
										}
									}
								}

/* 								if (precommentText != ""){
									postcommentText = "\n" + postcommentText;
								} */

								editor.edit(editBuilder => {
									editBuilder.insert(new vscode.Position(0, 0), precommentText);
									editBuilder.replace(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(documentLine, 0), "\n"));
									editBuilder.replace(new vscode.Range(new vscode.Position(documentLine + 1, 0), new vscode.Position(mainStart, 0)), postcommentText);
								});
								let wsEdit = new vscode.WorkspaceEdit();
								wsEdit.replace(header[0], new vscode.Range(new vscode.Position(0, 0), new vscode.Position(document.lineCount, 0)), modifiedHeaderData);
								vscode.workspace.applyEdit(wsEdit);
							});
						}
					}
					if (!headerFound){
						prototypeString = prototypeString.concat("\n");

						editor.edit(editBuilder => {
							editBuilder.replace(new vscode.Range(new vscode.Position(prototypeStart != 0 ? prototypeStart : mainStart, 0), new vscode.Position(mainStart, 0)), prototypeString);
						});
					}
				});
			});
		}
	});

	context.subscriptions.push(disposable);
}

exports.activate = activate;

// this method is called when your extension is deactivated
function deactivate() { }

module.exports = {
	activate,
	deactivate
}
