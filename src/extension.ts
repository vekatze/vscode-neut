import * as vscode from "vscode";
import { ExtensionContext } from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";

let client: LanguageClient;

const indentPattern =
  /^((?!\/\/).)*(\{[^}\"'`]*|\([^)\"'`]*|\[[^\]\"'`]*|(let|try|tie|bind).+=\s*$)$/;

const outdentPattern = /^\s+in\s*$/;

const baseOffset = 2;

function trim(s: string): string {
  return s.replace(/^(\s|\|)+/g, "");
}

function getIndentation(s: string): number {
  return s.length - trim(s).length;
}

function getCurrentLineText(editor: vscode.TextEditor): string {
  const currentLine = editor.selection.active.line;
  return editor.document.lineAt(currentLine).text;
}

function getPreviousLineText(editor: vscode.TextEditor): string | null {
  const currentLine = editor.selection.active.line;
  if (currentLine > 0) {
    return editor.document.lineAt(currentLine - 1).text;
  } else {
    return null;
  }
}

function getCurrentLineIndent(editor: vscode.TextEditor): number {
  const currentLineText = getCurrentLineText(editor);
  if (currentLineText) {
    return getIndentation(currentLineText);
  } else {
    return 0;
  }
}

function getPreviousLineIndent(editor: vscode.TextEditor): number {
  const previousLineText = getPreviousLineText(editor);
  if (previousLineText) {
    return getIndentation(previousLineText);
  } else {
    return 0;
  }
}

function mustIncreaseIndent(editor: vscode.TextEditor): boolean {
  const currentLineText = getCurrentLineText(editor);
  if (currentLineText) {
    return indentPattern.test(currentLineText);
  } else {
    return false;
  }
}

function mustDecreaseIndent(editor: vscode.TextEditor) {
  const currentLineText = getCurrentLineText(editor);
  return outdentPattern.test(currentLineText);
}

function mustSpreadParens(editor: vscode.TextEditor): boolean {
  const currentPosition = editor.selection.active;
  const closedPairOrOther = editor.document.getText(
    new vscode.Range(
      currentPosition.line,
      Math.max(currentPosition.character - 1, 0),
      currentPosition.line,
      currentPosition.character + 1
    )
  );
  return (
    closedPairOrOther == "()" ||
    closedPairOrOther == "{}" ||
    closedPairOrOther == "[]"
  );
}

function newlineAndIncreaseIndent(editor: vscode.TextEditor) {
  const currentPosition = editor.selection.active;
  const previousLineIndent = getPreviousLineIndent(editor);
  editor.edit((editBuilder) => {
    editBuilder.insert(
      currentPosition,
      "\n" + " ".repeat(previousLineIndent + baseOffset)
    );
  });
}

function decreaseIndentAndNewline(editor: vscode.TextEditor) {
  const currentPosition = editor.selection.active;
  if (currentPosition.line > 0) {
    let currentIndent = getCurrentLineIndent(editor);
    let previousIndent = getPreviousLineIndent(editor);
    if (currentIndent == previousIndent && currentIndent >= baseOffset) {
      const line = currentPosition.line;
      const left = new vscode.Position(line, 0);
      const right = new vscode.Position(line, baseOffset);
      editor.edit((editBuilder) => {
        editBuilder.delete(new vscode.Range(left, right));
        editBuilder.insert(
          currentPosition,
          "\n" + " ".repeat(currentIndent - baseOffset)
        );
      });
    } else {
      editor.edit((editBuilder) => {
        editBuilder.insert(currentPosition, "\n" + " ".repeat(currentIndent));
      });
    }
  }
}

function spreadParens(editor: vscode.TextEditor) {
  const currentPosition = editor.selection.active;
  const currentIndent = getCurrentLineIndent(editor);
  editor
    .edit((editBuilder) => {
      editBuilder.replace(
        currentPosition,
        "\n" +
          " ".repeat(currentIndent + baseOffset) +
          "\n" +
          " ".repeat(currentIndent)
      );
    })
    .then(() => {
      const newPosition = new vscode.Position(
        currentPosition.line + 1,
        currentIndent + baseOffset
      );
      editor.selections = [new vscode.Selection(newPosition, newPosition)];
    });
}

function insertNewLine(editor: vscode.TextEditor) {
  const currentPosition = editor.selection.active;
  const currentIndent = getCurrentLineIndent(editor);
  editor.edit((editBuilder) => {
    editBuilder.insert(currentPosition, "\n" + " ".repeat(currentIndent));
  });
}

function newlineAndIndent() {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    if (mustIncreaseIndent(editor)) {
      newlineAndIncreaseIndent(editor);
    } else if (mustDecreaseIndent(editor)) {
      decreaseIndentAndNewline(editor);
    } else if (mustSpreadParens(editor)) {
      spreadParens(editor);
    } else {
      insertNewLine(editor);
    }
  }
}

function insertVerticalBar() {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const currentPosition = editor.selection.active;
    const currentLineContent = getCurrentLineText(editor);
    const regex = /^\s*$/;
    if (regex.test(currentLineContent)) {
      editor.edit((editBuilder) => {
        const fragment = "| ";
        const l = currentPosition.line;
        const c = Math.max(0, currentPosition.character - fragment.length);
        const left = new vscode.Position(l, c);
        editBuilder.delete(new vscode.Range(left, currentPosition));
        editBuilder.insert(currentPosition, fragment);
      });
    } else {
      editor.edit((editBuilder) => {
        editBuilder.insert(currentPosition, "|");
      });
    }
  }
}

function createLanguageClient(): LanguageClient {
  const serverOptions: ServerOptions = {
    command: "neut",
    args: ["lsp"],
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      {
        scheme: "file",
        language: "neut",
      },
    ],
  };
  return new LanguageClient("Neut", serverOptions, clientOptions);
}

export function activate(context: ExtensionContext) {
  client = createLanguageClient();
  client.start().catch((e) => {
    throw e;
  });
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "extension.insertVerticalBar",
      insertVerticalBar
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "extension.newlineAndIndent",
      newlineAndIndent
    )
  );
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
