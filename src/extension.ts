import * as vscode from "vscode";

type Style = "unicode" | "ascii";

type NodeLine = {
  lineNo: number;
  depth: number;
  text: string;
};

let isApplyingEdit = false;

type ParsedTreeLine = {
  prefix: string;
  marker: string;
  markerStart: number;
  markerEnd: number;
  text: string;
};

type IndentInfo = {
  spaceWidth?: number;
};

const TREE_DOCUMENT_SELECTOR: vscode.DocumentSelector = [
  { language: "tree", scheme: "file" },
  { language: "tree", scheme: "untitled" },
];

const TREE_SEMANTIC_TOKEN_LEGEND = new vscode.SemanticTokensLegend(
  ["dottreeFolder", "dottreeFile", "dottreeComment"],
  []
);
const TREE_TOKEN_FOLDER = 0;
const TREE_TOKEN_FILE = 1;
const TREE_TOKEN_COMMENT = 2;

function getConfigStyle(): Style {
  const cfg = vscode.workspace.getConfiguration("dottree");
  return (cfg.get<string>("style", "unicode") as Style) ?? "unicode";
}

function indentSubtreeOnSingleCursor(): boolean {
  const cfg = vscode.workspace.getConfiguration("dottree");
  return cfg.get<boolean>("indentSubtreeOnSingleCursor", true) ?? true;
}

const TREE_LINE_RE = /^([\s│|]*?)([├└][─-]+|\+--|`--|\|-|\\-)\s*(.*)$/u;

function parseTreeLineParts(line: string): ParsedTreeLine | null {
  const trimmedRight = line.replace(/\s+$/, "");
  if (!trimmedRight) return null;

  const match = TREE_LINE_RE.exec(trimmedRight);
  if (!match) return null;

  const prefix = match[1] ?? "";
  const marker = match[2] ?? "";
  const markerStart = prefix.length;
  const markerEnd = markerStart + marker.length;
  const text = (match[3] ?? "").trimEnd();
  return { prefix, marker, markerStart, markerEnd, text };
}

function inferIndentInfo(parts: ParsedTreeLine[]): IndentInfo {
  const candidates: number[] = [];

  for (const part of parts) {
    const positions: number[] = [];
    for (let i = 0; i < part.prefix.length; i++) {
      if (part.prefix[i] === "│" || part.prefix[i] === "|") {
        positions.push(i);
      }
    }
    positions.push(part.markerStart);

    for (let i = 1; i < positions.length; i++) {
      const segment = part.prefix.slice(positions[i - 1], positions[i]);
      if (segment.includes("\t")) continue;
      const width = positions[i] - positions[i - 1];
      if (width > 0) candidates.push(width);
    }

    if (part.markerStart > 0 && !part.prefix.includes("\t")) {
      candidates.push(part.markerStart);
    }
  }

  return { spaceWidth: candidates.length ? Math.min(...candidates) : undefined };
}

function depthFromWhitespace(prefix: string, spaceWidth: number | undefined): number {
  let depth = 0;
  let spaces = 0;

  for (const ch of prefix) {
    if (ch === "\t") {
      if (spaces > 0) {
        depth += spaceWidth ? Math.round(spaces / spaceWidth) : 1;
        spaces = 0;
      }
      depth++;
    } else if (ch === " ") {
      spaces++;
    }
  }

  if (spaces > 0) {
    depth += spaceWidth ? Math.round(spaces / spaceWidth) : 1;
  }

  return depth;
}

function visualColumn(text: string, tabWidth: number): number {
  let column = 0;
  for (const ch of text) {
    if (ch === "\t") {
      const remainder = column % tabWidth;
      column += remainder === 0 ? tabWidth : tabWidth - remainder;
    } else {
      column++;
    }
  }
  return column;
}

function depthFromPrefix(part: ParsedTreeLine, indentInfo: IndentInfo): number {
  const guideDepth = Array.from(part.prefix).filter((ch) => ch === "│" || ch === "|").length;
  if (part.markerStart === 0) return guideDepth;

  if (indentInfo.spaceWidth) {
    const columnDepth = Math.round(
      visualColumn(part.prefix, indentInfo.spaceWidth) / indentInfo.spaceWidth
    );
    return Math.max(guideDepth, columnDepth);
  }

  if (part.prefix.includes("\t")) {
    return Math.max(guideDepth, depthFromWhitespace(part.prefix, undefined));
  }
  return guideDepth;
}

// Detect if a line looks like a tree line (unicode or ascii-ish)
function isTreeLine(line: string): boolean {
  return parseTreeLineParts(line) !== null;
}

// Parse a line to (depth, text). We accept both unicode & ascii formats.
function parseLine(line: string): { depth: number; text: string } | null {
  const part = parseTreeLineParts(line);
  if (!part) return null;
  return { depth: depthFromPrefix(part, inferIndentInfo([part])), text: part.text };
}

function buildLine(
  depth: number,
  text: string,
  isLast: boolean,
  ancestorLast: boolean[],
  style: Style
): string {
  const pieces: string[] = [];

  for (let i = 0; i < depth; i++) {
    const lastAtThisAncestor = ancestorLast[i] ?? false;
    if (style === "unicode") {
      pieces.push(lastAtThisAncestor ? "    " : "│   ");
    } else {
      pieces.push(lastAtThisAncestor ? "   " : "|  ");
    }
  }

  if (style === "unicode") {
    pieces.push(isLast ? "└── " : "├── ");
  } else {
    pieces.push(isLast ? "`-- " : "+-- ");
  }

  pieces.push(text);
  return pieces.join("");
}

// Determine last-sibling flags by looking ahead to the next line with depth <= current depth
function computeIsLast(nodes: NodeLine[]): boolean[] {
  const isLast = new Array(nodes.length).fill(false);
  for (let i = 0; i < nodes.length; i++) {
    const d = nodes[i].depth;
    let last = true;
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[j].depth < d) break;
      if (nodes[j].depth === d) {
        last = false;
        break;
      }
    }
    isLast[i] = last;
  }
  return isLast;
}

function formatNodes(nodes: NodeLine[], style: Style): string[] {
  const isLast = computeIsLast(nodes);
  const lines: string[] = [];
  const lastAtDepth: { isLast: boolean }[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const d = nodes[i].depth;
    lastAtDepth.length = d;
    const ancestorLast = lastAtDepth.map((x) => x.isLast);
    lines.push(buildLine(d, nodes[i].text, isLast[i], ancestorLast, style));
    lastAtDepth[d] = { isLast: isLast[i] };
  }

  return lines;
}

// Expand to a contiguous "tree block" around a given line
function findTreeBlock(
  doc: vscode.TextDocument,
  aroundLine: number
): { start: number; end: number } | null {
  const n = doc.lineCount;
  if (aroundLine < 0 || aroundLine >= n) return null;
  if (!isTreeLine(doc.lineAt(aroundLine).text)) return null;

  let start = aroundLine;
  while (start - 1 >= 0 && isTreeLine(doc.lineAt(start - 1).text)) start--;

  let end = aroundLine;
  while (end + 1 < n && isTreeLine(doc.lineAt(end + 1).text)) end++;

  return { start, end };
}

function parseBlock(doc: vscode.TextDocument, start: number, end: number): NodeLine[] {
  const parts: { lineNo: number; parsed: ParsedTreeLine }[] = [];
  for (let ln = start; ln <= end; ln++) {
    const parsed = parseTreeLineParts(doc.lineAt(ln).text);
    if (!parsed) continue;
    parts.push({ lineNo: ln, parsed });
  }

  const indentInfo = inferIndentInfo(parts.map((part) => part.parsed));
  const nodes: NodeLine[] = [];
  for (const part of parts) {
    nodes.push({
      lineNo: part.lineNo,
      depth: depthFromPrefix(part.parsed, indentInfo),
      text: part.parsed.text,
    });
  }
  return nodes;
}

function getTreeLineColumns(line: string): { markerEnd: number; payloadStart: number } | null {
  const parsed = parseTreeLineParts(line);
  if (!parsed) return null;

  let payloadStart = parsed.markerEnd;
  while (/\s/u.test(line[payloadStart] ?? "")) payloadStart++;
  return { markerEnd: parsed.markerEnd, payloadStart };
}

function findInlineCommentStart(text: string): number | undefined {
  const match = /(^|\s)#/u.exec(text);
  if (!match) return undefined;
  return match.index + (match[1]?.length ?? 0);
}

function treeItemTextBeforeComment(text: string): string {
  const commentOffset = findInlineCommentStart(text);
  const itemText = commentOffset === undefined ? text : text.slice(0, commentOffset);
  return itemText.trimEnd();
}

function pushTreeItemSemanticTokens(
  builder: vscode.SemanticTokensBuilder,
  lineNo: number,
  payloadStart: number,
  text: string,
  isFolder: boolean
) {
  const payload = text.slice(payloadStart).replace(/\s+$/u, "");
  if (!payload) return;

  const commentOffset = findInlineCommentStart(payload);
  const itemEndOffset =
    commentOffset === undefined
      ? payload.length
      : payload.slice(0, commentOffset).trimEnd().length;

  if (itemEndOffset > 0) {
    builder.push(
      lineNo,
      payloadStart,
      itemEndOffset,
      isFolder ? TREE_TOKEN_FOLDER : TREE_TOKEN_FILE
    );
  }

  if (commentOffset !== undefined) {
    const commentStart = payloadStart + commentOffset;
    builder.push(lineNo, commentStart, text.length - commentStart, TREE_TOKEN_COMMENT);
  }
}

function buildTreeSemanticTokens(doc: vscode.TextDocument): vscode.SemanticTokens {
  const builder = new vscode.SemanticTokensBuilder(TREE_SEMANTIC_TOKEN_LEGEND);
  let line = 0;

  while (line < doc.lineCount) {
    const lineText = doc.lineAt(line).text;
    const lineComment = /^\s*#/u.exec(lineText);
    if (lineComment) {
      const start = lineText.indexOf("#");
      builder.push(line, start, lineText.length - start, TREE_TOKEN_COMMENT);
      line++;
      continue;
    }

    if (!isTreeLine(lineText)) {
      if (line + 1 < doc.lineCount && isTreeLine(doc.lineAt(line + 1).text)) {
        const payloadStart = lineText.search(/\S/u);
        if (payloadStart >= 0) {
          pushTreeItemSemanticTokens(builder, line, payloadStart, lineText, true);
        }
      }
      line++;
      continue;
    }

    const block = findTreeBlock(doc, line);
    if (!block) {
      line++;
      continue;
    }

    const nodes = parseBlock(doc, block.start, block.end);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const text = doc.lineAt(node.lineNo).text;
      const cols = getTreeLineColumns(text);
      if (!cols) continue;

      const hasChildren = i + 1 < nodes.length && nodes[i + 1].depth > node.depth;
      const itemText = treeItemTextBeforeComment(node.text);
      const isFolder = hasChildren || itemText.endsWith("/");
      pushTreeItemSemanticTokens(builder, node.lineNo, cols.payloadStart, text, isFolder);
    }

    line = block.end + 1;
  }

  return builder.build();
}

async function normalizeTreeBlock(doc: vscode.TextDocument, block: { start: number; end: number }) {
  const nodes = parseBlock(doc, block.start, block.end);
  if (nodes.length === 0) return;

  const style = getConfigStyle();
  const formatted = formatNodes(nodes, style);
  const outLines = new Map<number, string>();
  for (let i = 0; i < nodes.length; i++) {
    outLines.set(nodes[i].lineNo, formatted[i]);
  }

  let needsEdit = false;
  for (let ln = block.start; ln <= block.end; ln++) {
    if (!outLines.has(ln)) continue;
    if (doc.lineAt(ln).text !== outLines.get(ln)) {
      needsEdit = true;
      break;
    }
  }
  if (!needsEdit) return;

  const edit = new vscode.WorkspaceEdit();
  for (let ln = block.start; ln <= block.end; ln++) {
    if (!outLines.has(ln)) continue;
    const range = doc.lineAt(ln).range;
    edit.replace(doc.uri, range, outLines.get(ln)!);
  }
  isApplyingEdit = true;
  try {
    await vscode.workspace.applyEdit(edit);
  } finally {
    isApplyingEdit = false;
  }
}

// Given cursor line index within nodes, returns [i, j] indices for subtree range
function subtreeRange(nodes: NodeLine[], i: number): { i0: number; i1: number } {
  const baseDepth = nodes[i].depth;
  let j = i;
  while (j + 1 < nodes.length && nodes[j + 1].depth > baseDepth) j++;
  return { i0: i, i1: j };
}

async function indentOrOutdent(editor: vscode.TextEditor, delta: number) {
  const doc = editor.document;
  const sel = editor.selection;

  const around = sel.active.line;
  const block = findTreeBlock(doc, around);
  if (!block) {
    await vscode.commands.executeCommand(delta > 0 ? "tab" : "outdent");
    return;
  }

  const nodes = parseBlock(doc, block.start, block.end);
  if (nodes.length === 0) return;

  const style = getConfigStyle();

  const lineToIdx = new Map<number, number>();
  nodes.forEach((n, idx) => lineToIdx.set(n.lineNo, idx));

  const targets = new Set<number>();

  const hasSelection =
    !sel.isEmpty &&
    (sel.start.line !== sel.end.line || sel.start.character !== sel.end.character);

  if (hasSelection) {
    const a = Math.min(sel.start.line, sel.end.line);
    const b = Math.max(sel.start.line, sel.end.line);
    const selectedIdx: number[] = [];
    for (let ln = a; ln <= b; ln++) {
      const idx = lineToIdx.get(ln);
      if (idx !== undefined) selectedIdx.push(idx);
    }
    for (const idx of selectedIdx) {
      const { i0, i1 } = subtreeRange(nodes, idx);
      for (let k = i0; k <= i1; k++) targets.add(k);
    }
  } else {
    const idx = lineToIdx.get(sel.active.line);
    if (idx === undefined) return;
    if (indentSubtreeOnSingleCursor()) {
      const { i0, i1 } = subtreeRange(nodes, idx);
      for (let k = i0; k <= i1; k++) targets.add(k);
    } else {
      targets.add(idx);
    }
  }

  if (delta > 0) {
    const applyIndent = new Array(nodes.length).fill(false);
    for (const idx of targets) applyIndent[idx] = true;

    const proposed: number[] = new Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      const prevDepth = i === 0 ? -1 : proposed[i - 1];
      let nextDepth = nodes[i].depth + (applyIndent[i] ? delta : 0);
      if (applyIndent[i] && nextDepth > prevDepth + 1) {
        applyIndent[i] = false;
        nextDepth = nodes[i].depth;
      }
      proposed[i] = nextDepth;
    }

    for (let i = 0; i < nodes.length; i++) {
      if (applyIndent[i]) nodes[i].depth = proposed[i];
    }
  } else {
    for (const idx of targets) {
      nodes[idx].depth = Math.max(0, nodes[idx].depth + delta);
    }
  }

  const formatted = formatNodes(nodes, style);
  const outLines = new Map<number, string>();
  for (let i = 0; i < nodes.length; i++) {
    outLines.set(nodes[i].lineNo, formatted[i]);
  }

  const edit = new vscode.WorkspaceEdit();
  for (let ln = block.start; ln <= block.end; ln++) {
    if (!outLines.has(ln)) continue;
    const range = doc.lineAt(ln).range;
    edit.replace(doc.uri, range, outLines.get(ln)!);
  }
  isApplyingEdit = true;
  try {
    await vscode.workspace.applyEdit(edit);
  } finally {
    isApplyingEdit = false;
  }
}

async function insertSiblingLine(editor: vscode.TextEditor) {
  const doc = editor.document;
  const sel = editor.selection;
  if (!sel.isEmpty) {
    await vscode.commands.executeCommand("type", { text: "\n" });
    return;
  }

  const around = sel.active.line;
  const block = findTreeBlock(doc, around);
  if (!block) {
    await vscode.commands.executeCommand("type", { text: "\n" });
    return;
  }

  const nodes = parseBlock(doc, block.start, block.end);
  if (nodes.length === 0) return;

  const treeCols = getTreeLineColumns(doc.lineAt(around).text);
  if (
    treeCols &&
    sel.active.character >= treeCols.markerEnd &&
    sel.active.character <= treeCols.payloadStart
  ) {
    const lineToIdx = new Map<number, number>();
    nodes.forEach((n, idx) => lineToIdx.set(n.lineNo, idx));

    const idx = lineToIdx.get(around);
    if (idx === undefined) {
      await vscode.commands.executeCommand("type", { text: "\n" });
      return;
    }

    const insertIndex = idx;
    nodes.splice(insertIndex, 0, { lineNo: -1, depth: nodes[idx].depth, text: "" });

    const style = getConfigStyle();
    const formatted = formatNodes(nodes, style);

    const startPos = doc.lineAt(block.start).range.start;
    const endLine = doc.lineAt(block.end);
    const endHasLineBreak = !endLine.rangeIncludingLineBreak.end.isEqual(endLine.range.end);
    const replaceRange = new vscode.Range(startPos, endLine.rangeIncludingLineBreak.end);

    const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    let newText = formatted.join(eol);
    if (endHasLineBreak) newText += eol;

    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, replaceRange, newText);
    isApplyingEdit = true;
    try {
      await vscode.workspace.applyEdit(edit);
    } finally {
      isApplyingEdit = false;
    }

    const newLineNo = block.start + insertIndex;
    const newLine = editor.document.lineAt(newLineNo);
    const pos = new vscode.Position(newLineNo, newLine.text.length);
    editor.selection = new vscode.Selection(pos, pos);
    return;
  }

  const lineToIdx = new Map<number, number>();
  nodes.forEach((n, idx) => lineToIdx.set(n.lineNo, idx));

  const idx = lineToIdx.get(around);
  if (idx === undefined) {
    await vscode.commands.executeCommand("type", { text: "\n" });
    return;
  }

  const lineText = doc.lineAt(around).text;
  const trimmedRightLen = lineText.replace(/\s+$/, "").length;
  let didSplit = false;
  let insertIndex = -1;
  if (
    treeCols &&
    sel.active.character > treeCols.payloadStart &&
    sel.active.character < trimmedRightLen
  ) {
    const leftText = lineText
      .slice(treeCols.payloadStart, sel.active.character)
      .replace(/\s+$/, "");
    const rightText = lineText
      .slice(sel.active.character, trimmedRightLen)
      .replace(/^\s+/, "");
    if (rightText.length > 0) {
      const { i1 } = subtreeRange(nodes, idx);
      nodes[idx].text = leftText;
      insertIndex = i1 + 1;
      nodes.splice(insertIndex, 0, {
        lineNo: -1,
        depth: nodes[idx].depth,
        text: rightText,
      });
      didSplit = true;
    }
  }

  if (!didSplit) {
    const { i1 } = subtreeRange(nodes, idx);
    insertIndex = i1 + 1;
    nodes.splice(insertIndex, 0, { lineNo: -1, depth: nodes[idx].depth, text: "" });
  }

  const style = getConfigStyle();
  const formatted = formatNodes(nodes, style);

  const startPos = doc.lineAt(block.start).range.start;
  const endLine = doc.lineAt(block.end);
  const endHasLineBreak = !endLine.rangeIncludingLineBreak.end.isEqual(endLine.range.end);
  const replaceRange = new vscode.Range(startPos, endLine.rangeIncludingLineBreak.end);

  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  let newText = formatted.join(eol);
  if (endHasLineBreak) newText += eol;

  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, replaceRange, newText);
  isApplyingEdit = true;
  try {
    await vscode.workspace.applyEdit(edit);
  } finally {
    isApplyingEdit = false;
  }

  const newLineNo = block.start + insertIndex;
  const newLine = editor.document.lineAt(newLineNo);
  const pos = new vscode.Position(newLineNo, newLine.text.length);
  editor.selection = new vscode.Selection(pos, pos);
}

function getTreeSnippetCompletion(
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.CompletionItem[] | undefined {
  const line = document.lineAt(position.line);
  if (line.text.trim() !== "|") return;
  const before = line.text.slice(0, position.character);
  if (!before.endsWith("|")) return;

  const indent = line.text.slice(0, line.firstNonWhitespaceCharacterIndex);
  const snippet = new vscode.SnippetString(`${indent}./\n${indent}└── README.md`);

  const item = new vscode.CompletionItem("dottree template", vscode.CompletionItemKind.Snippet);
  item.detail = "dottree";
  item.insertText = snippet;
  item.filterText = "|";
  item.sortText = "\u0000dottree";
  item.range = line.range;
  return [item];
}

function buildTreeFoldingRanges(doc: vscode.TextDocument): vscode.FoldingRange[] {
  const ranges: vscode.FoldingRange[] = [];
  let line = 0;
  while (line < doc.lineCount) {
    if (!isTreeLine(doc.lineAt(line).text)) {
      if (line + 1 < doc.lineCount && isTreeLine(doc.lineAt(line + 1).text)) {
        const block = findTreeBlock(doc, line + 1);
        if (block && block.end > line) {
          ranges.push(new vscode.FoldingRange(line, block.end));
        }
      }
      line++;
      continue;
    }

    const block = findTreeBlock(doc, line);
    if (!block) {
      line++;
      continue;
    }

    const nodes = parseBlock(doc, block.start, block.end);
    if (nodes.length === 0) {
      line = block.end + 1;
      continue;
    }

    for (let i = 0; i < nodes.length; i++) {
      const { i1 } = subtreeRange(nodes, i);
      if (i1 <= i) continue;
      const start = nodes[i].lineNo;
      const end = nodes[i1].lineNo;
      if (end > start) {
        ranges.push(new vscode.FoldingRange(start, end));
      }
    }

    line = block.end + 1;
  }

  return ranges;
}

export function activate(context: vscode.ExtensionContext) {
  const docLineCounts = new Map<string, number>();

  // Update context key so Tab/Shift+Tab only override on tree lines
  const updateContext = (editor?: vscode.TextEditor) => {
    if (!editor) editor = vscode.window.activeTextEditor;
    const doc = editor?.document;
    if (!editor || !doc) return;

    const line = editor.selection.active.line;
    const active = line >= 0 && line < doc.lineCount && isTreeLine(doc.lineAt(line).text);
    void vscode.commands.executeCommand("setContext", "dottree.activeTreeLine", active);
    docLineCounts.set(doc.uri.toString(), doc.lineCount);
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateContext(editor);
    }),
    vscode.window.onDidChangeTextEditorSelection(() => updateContext()),
    vscode.workspace.onDidChangeTextDocument(async (e) => {
      updateContext();
      if (isApplyingEdit) return;

      const docKey = e.document.uri.toString();
      const prevLineCount = docLineCounts.get(docKey);
      const currentLineCount = e.document.lineCount;
      docLineCounts.set(docKey, currentLineCount);
      const lineCountDecreased = prevLineCount !== undefined && currentLineCount < prevLineCount;

      const deletedLineBreak = e.contentChanges.some(
        (change) => change.text === "" && change.range.start.line !== change.range.end.line
      );
      if (!deletedLineBreak && !lineCountDecreased) return;

      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document !== e.document) return;

      const line = Math.min(
        Math.max(0, e.contentChanges[0]?.range.start.line ?? 0),
        e.document.lineCount - 1
      );
      const candidates = [line, line - 1, line + 1];
      for (const ln of candidates) {
        if (ln < 0 || ln >= e.document.lineCount) continue;
        const block = findTreeBlock(e.document, ln);
        if (!block) continue;
        await normalizeTreeBlock(e.document, block);
        break;
      }
    })
  );

  updateContext();

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      TREE_DOCUMENT_SELECTOR,
      {
        provideDocumentSemanticTokens: (document) => buildTreeSemanticTokens(document),
      },
      TREE_SEMANTIC_TOKEN_LEGEND
    ),
    vscode.languages.registerFoldingRangeProvider(
      TREE_DOCUMENT_SELECTOR,
      {
        provideFoldingRanges: (document) => buildTreeFoldingRanges(document),
      }
    ),
    vscode.languages.registerCompletionItemProvider(
      TREE_DOCUMENT_SELECTOR,
      {
        provideCompletionItems: (document, position) =>
          getTreeSnippetCompletion(document, position),
      },
      "|"
    ),
    vscode.commands.registerCommand("dottree.indent", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      await indentOrOutdent(editor, +1);
      updateContext(editor);
    }),
    vscode.commands.registerCommand("dottree.outdent", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      await indentOrOutdent(editor, -1);
      updateContext(editor);
    }),
    vscode.commands.registerCommand("dottree.newline", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      await insertSiblingLine(editor);
      updateContext(editor);
    })
  );
}

export function deactivate() {}
