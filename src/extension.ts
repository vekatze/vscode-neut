import * as vscode from "vscode";
import { ExtensionContext } from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";
import {
  desiredIndent,
  hasOpeningBeforeCursor,
  indentEditForLine,
} from "./indent";

function editForLine(
  doc: vscode.TextDocument,
  lineNum: number,
): vscode.TextEdit[] {
  const edit = indentEditForLine(doc, lineNum);
  if (!edit) {
    return [];
  }

  return [
    vscode.TextEdit.replace(
      new vscode.Range(edit.line, edit.start, edit.line, edit.end),
      edit.text,
    ),
  ];
}

const onTypeFormattingEditProvider: vscode.OnTypeFormattingEditProvider = {
  provideOnTypeFormattingEdits(doc, pos, ch) {
    const ln = pos.line;
    const editList1 = editForLine(doc, ln);
    if (ch != "\n") {
      return editList1;
    } else {
      const previousLine = ln - 1;
      const previousLineLength = doc.lineAt(previousLine).text.length;
      const newPos = new vscode.Position(previousLine, previousLineLength);
      if (hasOpeningBeforeCursor(doc, newPos) && ln + 1 < doc.lineCount) {
        const editList2 = editForLine(doc, ln + 1);
        return editList1.concat(editList2);
      } else {
        return editList1;
      }
    }
  },
};

let client: LanguageClient | undefined;

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

async function insertVerticalBar() {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const currentPosition = editor.selection.active;
    const currentLineContent = editor.document.lineAt(currentPosition.line).text;
    const regex = /^\s*$/;
    if (regex.test(currentLineContent)) {
      const indent = desiredIndent(editor.document, currentPosition.line, "| ");
      const fragment = `${" ".repeat(indent)}| `;
      const applied = await editor.edit((editBuilder) => {
        const l = currentPosition.line;
        editBuilder.replace(
          new vscode.Range(l, 0, l, currentLineContent.length),
          fragment,
        );
      });
      if (applied) {
        const pos = new vscode.Position(currentPosition.line, fragment.length);
        editor.selection = new vscode.Selection(pos, pos);
      }
    } else {
      await editor.edit((editBuilder) => {
        editBuilder.insert(currentPosition, "|");
      });
    }
  }
}

const TRIGGERS = ["\n", ")", "}", "]", ">", ";", "|"] as const;

export function activate(context: ExtensionContext) {
  client = createLanguageClient();
  client.start().catch((e) => {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Failed to start Neut language server: ${message}`);
    void vscode.window.showWarningMessage(
      "Failed to start the Neut language server. Ensure `neut` is available on PATH.",
    );
  });
  context.subscriptions.push(
    vscode.languages.registerOnTypeFormattingEditProvider(
      "neut",
      onTypeFormattingEditProvider,
      ...TRIGGERS,
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "extension.insertVerticalBar",
      insertVerticalBar,
    ),
  );
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
