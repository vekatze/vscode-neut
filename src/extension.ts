import * as vscode from "vscode";
import { ExtensionContext } from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";

const OPEN = new Set(["(", "{", "[", "=", "<"]);

const CLOSE = new Set([")", "}", "]", ";", ">"]);

const MATCH: Record<string, string> = {
  "(": ")",
  "{": "}",
  "[": "]",
  "=": ";",
  "<": ">",
};

const offset = 2;

type Doc = vscode.TextDocument;

function isArrow(line: string, i: number) {
  return line[i] === ">" && i > 0 && ["=", "-"].includes(line[i - 1]);
}

function isColonEq(line: string, i: number) {
  return line[i] === "=" && i > 0 && line[i - 1] === ":";
}

function lineStartsWithCloser(text: string): boolean {
  const l = text.trimStart();
  if (!l) {
    return false;
  }
  const c = l[0];
  if ([")", "}", "]", ";", ">"].includes(c)) {
    return true;
  }
  return false;
}

function firstSignificantCharacterIndex(line: string): number {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch !== " " && ch !== "|") {
      return i;
    }
  }
  return line.length;
}

function findParentIndent(doc: Doc, lineNum: number, col: number): number {
  let stack: string[] = [];

  for (let ln = lineNum; ln >= 0; ln--) {
    let text = doc.lineAt(ln).text;
    const comment = text.indexOf("//");
    if (comment >= 0) text = text.slice(0, comment);

    let i = ln === lineNum ? col - 1 : text.length - 1;
    while (i >= 0) {
      const ch = text[i];

      if (isArrow(text, i)) {
        i -= 2;
        continue;
      }
      if (isColonEq(text, i)) {
        i -= 2;
        continue;
      }

      if (CLOSE.has(ch)) {
        stack.unshift(ch);
        i--;
        continue;
      }

      if (OPEN.has(ch)) {
        while (stack[0] === ";" && ch !== "=") {
          stack.shift();
        }
        if (stack[0] && MATCH[ch] === stack[0]) {
          stack.shift();
          i--;
          continue;
        }
        return firstSignificantCharacterIndex(doc.lineAt(ln).text);
      }
      i--;
    }
  }
  return -1 * offset;
}

function desiredIndent(doc: Doc, lineNum: number): number {
  const line = doc.lineAt(lineNum).text;
  const parentIndent = findParentIndent(doc, lineNum, 0);
  return lineStartsWithCloser(line) ? parentIndent : parentIndent + offset;
}

function editForLine(
  doc: vscode.TextDocument,
  lineNum: number,
): vscode.TextEdit[] {
  const want = desiredIndent(doc, lineNum);
  const actual = firstSignificantCharacterIndex(doc.lineAt(lineNum).text);
  if (actual === want) {
    return [];
  }

  return [
    vscode.TextEdit.replace(
      new vscode.Range(lineNum, 0, lineNum, actual),
      " ".repeat(want),
    ),
  ];
}

function hasOpeningBeforeCursor(
  doc: vscode.TextDocument,
  pos: vscode.Position,
): boolean {
  const txt = doc.lineAt(pos.line).text.slice(0, pos.character);

  let i = txt.length - 1;
  while (i >= 0 && /\s/.test(txt[i])) {
    i--;
  }
  if (i < 0) {
    return false;
  }

  const ch = txt[i];

  if (ch == "=") {
    return false;
  }

  return OPEN.has(ch);
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
      let newPos = new vscode.Position(previousLine, previousLineLength);
      if (hasOpeningBeforeCursor(doc, newPos)) {
        const editList2 = editForLine(doc, ln + 1);
        return editList1.concat(editList2);
      } else {
        return editList1;
      }
    }
  },
};

let client: LanguageClient;

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

function getCurrentLineText(editor: vscode.TextEditor): string {
  const currentLine = editor.selection.active.line;
  return editor.document.lineAt(currentLine).text;
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

const TRIGGERS = ["\n", ")", "}", "]", ">", ";", "|"] as const;

export function activate(context: ExtensionContext) {
  client = createLanguageClient();
  client.start().catch((e) => {
    throw e;
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
