export const INDENT_OFFSET = 2;

export interface LineTextDocument {
  lineAt(line: number): { text: string };
}

export interface PositionLike {
  line: number;
  character: number;
}

export interface IndentEdit {
  line: number;
  start: number;
  end: number;
  text: string;
}

const OPEN = new Set(["(", "{", "[", "=", "<"]);
const CLOSE = new Set([")", "}", "]", ";", ">"]);
const LINE_START_CLOSE = new Set([")", "}", "]", ">", "|"]);

const MATCH: Record<string, string> = {
  "(": ")",
  "{": "}",
  "[": "]",
  "=": ";",
  "<": ">",
};

interface LexedLine {
  ignored: boolean[];
  startsInString: boolean;
}

function leadingWhitespaceIndex(line: string): number {
  let i = 0;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) {
    i++;
  }
  return i;
}

function indentationColumn(line: string): number {
  let i = 0;
  while (
    i < line.length &&
    (line[i] === " " || line[i] === "\t" || line[i] === "|")
  ) {
    i++;
  }
  return i;
}

function lineStartsWithClosingDelimiter(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.length > 0 && LINE_START_CLOSE.has(trimmed[0]);
}

function lexDocument(
  doc: LineTextDocument,
  endLine: number,
  endColumn: number,
): LexedLine[] {
  const result: LexedLine[] = [];
  let quote: "\"" | "`" | undefined;
  let escaped = false;

  for (let line = 0; line <= endLine; line++) {
    const text = doc.lineAt(line).text;
    const limit =
      line === endLine
        ? Math.max(0, Math.min(endColumn, text.length))
        : text.length;
    const ignored = Array<boolean>(text.length).fill(false);
    const startsInString = quote !== undefined;

    for (let i = 0; i < limit; i++) {
      const ch = text[i];

      if (quote !== undefined) {
        ignored[i] = true;
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === quote) {
          quote = undefined;
        }
        continue;
      }

      if (ch === "/" && i + 1 < limit && text[i + 1] === "/") {
        for (let j = i; j < text.length; j++) {
          ignored[j] = true;
        }
        break;
      }

      if (ch === "\"" || ch === "`") {
        quote = ch;
        escaped = false;
        ignored[i] = true;
      }
    }

    result.push({ ignored, startsInString });
  }

  return result;
}

function lineStartsInString(doc: LineTextDocument, line: number): boolean {
  return lexDocument(doc, line, 0)[line]?.startsInString ?? false;
}

function arrowStartAt(
  text: string,
  index: number,
  ignored: readonly boolean[],
): number | undefined {
  if (text[index] !== ">" || ignored[index]) {
    return undefined;
  }

  if (
    index >= 2 &&
    text[index - 1] === ">" &&
    !ignored[index - 1] &&
    (text[index - 2] === "=" || text[index - 2] === "-") &&
    !ignored[index - 2]
  ) {
    return index - 2;
  }

  if (
    index >= 1 &&
    (text[index - 1] === "=" || text[index - 1] === "-") &&
    !ignored[index - 1]
  ) {
    return index - 1;
  }

  return undefined;
}

function isColonEqualAt(
  text: string,
  index: number,
  ignored: readonly boolean[],
): boolean {
  return (
    text[index] === "=" &&
    !ignored[index] &&
    index > 0 &&
    text[index - 1] === ":" &&
    !ignored[index - 1]
  );
}

export function findParentIndent(
  doc: LineTextDocument,
  lineNum: number,
  column: number,
): number {
  const stack: string[] = [];
  const lexed = lexDocument(doc, lineNum, column);

  for (let ln = lineNum; ln >= 0; ln--) {
    const text = doc.lineAt(ln).text;
    const ignored = lexed[ln]?.ignored ?? [];
    let i =
      ln === lineNum ? Math.min(column, text.length) - 1 : text.length - 1;

    while (i >= 0) {
      if (ignored[i]) {
        i--;
        continue;
      }

      const arrowStart = arrowStartAt(text, i, ignored);
      if (arrowStart !== undefined) {
        i = arrowStart - 1;
        continue;
      }

      if (isColonEqualAt(text, i, ignored)) {
        i -= 2;
        continue;
      }

      const ch = text[i];

      if (CLOSE.has(ch)) {
        stack.push(ch);
        i--;
        continue;
      }

      if (OPEN.has(ch)) {
        while (stack[stack.length - 1] === ";" && ch !== "=") {
          stack.pop();
        }

        if (stack.length > 0 && MATCH[ch] === stack[stack.length - 1]) {
          stack.pop();
          i--;
          continue;
        }

        return indentationColumn(doc.lineAt(ln).text);
      }

      i--;
    }
  }

  return -INDENT_OFFSET;
}

export function desiredIndent(
  doc: LineTextDocument,
  lineNum: number,
  lineText = doc.lineAt(lineNum).text,
): number {
  const actual = leadingWhitespaceIndex(lineText);
  if (lineStartsInString(doc, lineNum)) {
    return actual;
  }

  const parentIndent = findParentIndent(doc, lineNum, 0);
  const indent = lineStartsWithClosingDelimiter(lineText)
    ? parentIndent
    : parentIndent + INDENT_OFFSET;
  return Math.max(0, indent);
}

export function indentEditForLine(
  doc: LineTextDocument,
  lineNum: number,
): IndentEdit | undefined {
  const line = doc.lineAt(lineNum).text;
  const want = desiredIndent(doc, lineNum);
  const actual = leadingWhitespaceIndex(line);

  if (actual === want) {
    return undefined;
  }

  return {
    line: lineNum,
    start: 0,
    end: actual,
    text: " ".repeat(want),
  };
}

export function hasOpeningBeforeCursor(
  doc: LineTextDocument,
  pos: PositionLike,
): boolean {
  const line = doc.lineAt(pos.line).text;
  const ignored =
    lexDocument(doc, pos.line, pos.character)[pos.line]?.ignored ?? [];

  let i = Math.min(pos.character, line.length) - 1;
  while (i >= 0 && (ignored[i] || /\s/.test(line[i]))) {
    i--;
  }

  if (i < 0) {
    return false;
  }

  const ch = line[i];
  return ch !== "=" && OPEN.has(ch);
}
