const vscode = require('vscode');


function activate(context) {

	let disposable = vscode.commands.registerCommand('AutoPrototype.prototypeCreate', function () {
		let editor = vscode.window.activeTextEditor;


		if (editor) {
			let document = editor.document;
			let headerName = document.fileName.split("\\")[document.fileName.split("\\").length - 1].replace(/.c/, ".h");
			let headerUri;
			//Get all symbols
			vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", document.uri).then(function (symbols) {
				let symbolsarr = [];
				let mainStart, prototypeStart = 0;
				//Check if they are a function that requires a prototype and add the to symbolsarr
				for (let i = 0; i < symbols.length; i++) {
					if (symbols[i].kind == 11) {
						let symboltext = document.lineAt(symbols[i].location.range.start.line).text;
						if (symboltext.search("main") == -1) {
							if (symboltext.search(";") == -1) {
								if (symboltext.search("{") != -1)
									symbolsarr.push(symboltext.replace(/[^\)]*$/, ';'));
								else
									symbolsarr.push(symboltext.concat(";"));
							} else {
								//If the first function isn't main find the line
								prototypeStart = prototypeStart == 0 ? symbols[i].location.range.start.line : prototypeStart;
							}
						} else {
							// find line for main
							mainStart = symbols[i].location.range.start.line;
						}
					}
				}
				// if there is no main
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

				// get all prototypes for creation
				for (let i = 0; i < symbolsarr.length; i++) {
					prototypeString += symbolsarr[i];
					prototypeString += "\n";
				}
				if (vscode.workspace.getConfiguration("prototype").get("headerBool") == true){
				// Look for a header with same name
					vscode.workspace.findFiles(headerName.replace("\"", "")).then(function (header) {
						headerUri = header[0];
						for (let documentLine = 0; documentLine < document.lineCount; documentLine++) {
							// Check if it is in the .c file
							if (document.lineAt(documentLine).text == "#include \"" + headerName + "\"") {
								let headerData = "";
								let modifiedHeaderData = "";
								let stringsave = ["","",""];
								let commentCount = 0;
								headerFound = true;
								for (let i = 0; i < mainStart; i++) {
									//look for header comments and set next line after
									if (document.lineAt(i).text.includes("/*")){
										for (let j = i; j < document.lineCount; j++) {
											if (!document.lineAt(j).text.includes("*/")){
												commentCount++;
											}else{
												break;
											}
										}
										i += commentCount;
									// get all data to be stored in a string
									}else if (document.lineAt(i).text != "#include \"" + headerName + "\""){
										preHeaderData += document.lineAt(new vscode.Position(document.lineAt(i).lineNumber, 0)).text;
										preHeaderData += "\n";
									}
								}
								// Make the input for the header from everything above include and the prototypes
								headerData = preHeaderData + "\n" + prototypeString.trim();
								// Get the header document as a TextDocument
								vscode.workspace.openTextDocument(headerUri).then( headerDocument => {
									// Check if they are the same
									if (headerDocument.uri.fsPath == headerUri.fsPath){
										// Get the text inside the header and store it
										let currentHeaderData = headerDocument.getText();
										let headerDataLineText = headerData.split("\n");
										for (let headerLine = 0; headerLine < headerDocument.lineCount; headerLine++) {
											headerDataLineText.forEach(str => {
												// if the string already exists in the header and it isn't a newline and not a prototype then remove it
												if ((headerDocument.lineAt(headerLine).text == str) && headerDocument.lineAt(headerLine).text != "\n" && headerDocument.lineAt(headerLine).text != "};"){
													currentHeaderData = currentHeaderData.replace(headerDocument.lineAt(headerLine).text, "");
												}
											});
										}

										// The data that needs to be added to the header
										modifiedHeaderData = currentHeaderData.trim() + "\n" + headerData.trim();
										let substrHeaderData = modifiedHeaderData.split("\n");
										modifiedHeaderData = "";
										substrHeaderData.forEach(str => {
											// if it is an #include put it first
											if (str.startsWith("#include")){
												modifiedHeaderData = str + "\n" + modifiedHeaderData;
											} else if (str.startsWith("#define")){
												// if it is a define where there is no include in the header put it first
												if (str.includes("#define " + headerName.replace(/.h/, "").toUpperCase())){
													stringsave[1] = str;
												}else if (modifiedHeaderData.search("#include") == -1){
													modifiedHeaderData = str + "\n" + modifiedHeaderData;
												// if there is already a define in the header find it and at it to the end of the defines (causes them to flip)
												}else{
													let match = modifiedHeaderData.match(/#define .+?\r\n/g) == null ? [] : modifiedHeaderData.match(/#define .+?\r\n/g);
													//if there isn't just add them
													if (match.length == 0){
														modifiedHeaderData = modifiedHeaderData + "\n" + str + "\n";
														return;
													}
													let lastIndex = modifiedHeaderData.lastIndexOf(match[match.length-1]);
													modifiedHeaderData = modifiedHeaderData.slice(0,lastIndex) + str + "\n" + modifiedHeaderData.slice(lastIndex);
												}
											// ignore "new lines"
											}else if (str != "\r"){
												if (symbolsarr.includes(str.trim())){
													if (headerData.split("\n").includes(str)){
														if (!modifiedHeaderData.includes(str)){
															modifiedHeaderData = modifiedHeaderData + "\n" + str;
														}
													}
												// if it already is in the symbol array and in the prototype list then add it
												}else if (str.includes("#ifndef") || str.includes("#endif")){
													if (str.includes("#ifndef"))
														stringsave[0] = str;
													else
														stringsave[2] = str;
														
												}
												// else check if there isn't a prototype and append it
												else if (!str.includes(");")){
													if (str.includes(";")){
														modifiedHeaderData = modifiedHeaderData + str + "\n";
													}else{
														modifiedHeaderData = modifiedHeaderData + "\n" + str;
													}
												}
											}
										});
									}
									modifiedHeaderData = (stringsave[0] == "" ? "" : (stringsave[0] + "\n")) + (stringsave[1] == "" ? "" : (stringsave[1] + "\n\n")) + modifiedHeaderData;
									modifiedHeaderData += (stringsave[2] == "" ? "" : ("\n" + stringsave[2]));
									let precommentText = "",
										postcommentText = "";
									// checks for comments before and after includes keep in the file
									for (let i = 0; i < mainStart; i++) {
										// TODO: make non ansi comments as well

										// check for a start comment
										if (document.lineAt(i).text.includes("/*")){
											for (let j = i; j < mainStart; j++) {
												// as long as it isn't the end of the comment then add it
												if (!document.lineAt(j).text.includes("*/")){
													postcommentText += document.lineAt(new vscode.Position(document.lineAt(j).lineNumber, 0)).text;
													postcommentText += "\n";
													// if there is a # then stop the precomment and start postcomment
													if (document.lineAt(j+3).text.includes("#")){
														precommentText = postcommentText;
														postcommentText = "";
													}
												}else{
													break;
												}
											}
											// add an end of the comment for comments
											if ((precommentText != "" || precommentText.includes("*/")) && postcommentText == ""){
												precommentText += "*/";
												precommentText += "\n\n";
											}else{
												postcommentText += "*/";
											}

											// add a new line if this line does not have a start comment
											if (!document.lineAt(i+1).text.includes("/*")){
												postcommentText += "\n";
											}
										}
									}

									//adds the comments then replaces everything above the include with newlines and adds comments after include until the first function
									editor.edit(editBuilder => {
										editBuilder.insert(new vscode.Position(0, 0), precommentText);
										editBuilder.replace(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(documentLine, 0), "\n"));
										editBuilder.replace(new vscode.Range(new vscode.Position(documentLine + 1, 0), new vscode.Position(mainStart, 0)), postcommentText);
									});
									// replaces the current header with the new data
									let wsEdit = new vscode.WorkspaceEdit();
									wsEdit.replace(headerUri, new vscode.Range(new vscode.Position(0, 0), new vscode.Position(headerDocument.lineCount, 0)), modifiedHeaderData);
									vscode.workspace.applyEdit(wsEdit);

									headerDocument.save();
								});
								if (!headerFound){
									prototypeString = prototypeString.concat("\n");

									editor.edit(editBuilder => {
										editBuilder.replace(new vscode.Range(new vscode.Position(prototypeStart != 0 ? prototypeStart : mainStart, 0), new vscode.Position(mainStart, 0)), prototypeString);
									});
								}
							}
						}
					});
				}
				// if there is no header just add it to the file
				if (!(vscode.workspace.getConfiguration("prototype").get("headerBool"))){
					prototypeString = prototypeString.concat("\n");

					editor.edit(editBuilder => {
						editBuilder.replace(new vscode.Range(new vscode.Position(prototypeStart != 0 ? prototypeStart : mainStart, 0), new vscode.Position(mainStart, 0)), prototypeString);
					});
				}
				document.save()
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
