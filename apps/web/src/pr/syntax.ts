import { Prism } from "prism-react-renderer";
import type { Range, Row } from "./patch";

// Syntax highlighting for diffs. Each side of a file (the old text and the new
// text) is tokenized as one block, so a construct that spans lines, like a
// block comment, is coloured right on every line it covers.

/** A run of text and the classes it is drawn with. */
export interface Piece {
  text: string;
  cls: string;
}

const EXT: Record<string, string> = {
  rs: "rust",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  md: "markdown",
  py: "python",
  go: "go",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  css: "css",
  sql: "sql",
  swift: "swift",
  kt: "kotlin",
  yml: "yaml",
  yaml: "yaml",
  html: "markup",
  xml: "markup",
  svg: "markup",
  graphql: "graphql",
};

export function languageOf(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const lang = EXT[ext];
  return lang && Prism.languages[lang] ? lang : null;
}

/** The language a markdown fence names: "rust" or "rs", "typescript" or "ts". */
export function fenceLanguage(name: string): string | null {
  const lower = name.toLowerCase();
  return Prism.languages[lower] ? lower : languageOf(`x.${lower}`);
}

/** Highlights `code` and returns its pieces, one array per line. */
export function highlightLines(code: string, lang: string | null): Piece[][] {
  const grammar = lang ? Prism.languages[lang] : undefined;
  const flat: Piece[] = [];
  if (grammar) flatten(Prism.tokenize(code, grammar), [], flat);
  else flat.push({ text: code, cls: "" });
  const lines: Piece[][] = [[]];
  for (const piece of flat) {
    const parts = piece.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, cls: piece.cls });
    });
  }
  return lines;
}

function flatten(stream: (string | Prism.Token)[], types: string[], out: Piece[]) {
  for (const t of stream) {
    if (typeof t === "string") {
      out.push({ text: t, cls: types.join(" ") });
      continue;
    }
    const alias = t.alias ? (Array.isArray(t.alias) ? t.alias : [t.alias]) : [];
    const next = [...types, `t-${t.type}`, ...alias.map((a) => `t-${a}`)];
    if (typeof t.content === "string") out.push({ text: t.content, cls: next.join(" ") });
    else flatten(Array.isArray(t.content) ? t.content : [t.content], next, out);
  }
}

/** The highlighted pieces of every row: context and added rows from the new
 *  side, deleted rows from the old one. */
export function highlightRows(rows: Row[], lang: string | null): Piece[][] {
  const oldSide = rows.filter((r) => r.kind === "ctx" || r.kind === "del").map((r) => r.text);
  const newSide = rows.filter((r) => r.kind === "ctx" || r.kind === "add").map((r) => r.text);
  const before = highlightLines(oldSide.join("\n"), lang);
  const after = highlightLines(newSide.join("\n"), lang);
  let o = 0;
  let n = 0;
  return rows.map((r) => {
    if (r.kind === "meta") return [{ text: r.text, cls: "" }];
    if (r.kind === "del") return before[o++] ?? [];
    if (r.kind === "add") return after[n++] ?? [];
    o++;
    return after[n++] ?? [];
  });
}

/** Splits pieces at the edges of `words` and marks the pieces inside them. */
export function markPieces(pieces: Piece[], words: Range[]): Piece[] {
  if (!words.length) return pieces;
  const out: Piece[] = [];
  let at = 0;
  for (const p of pieces) {
    let start = 0;
    while (start < p.text.length) {
      const pos = at + start;
      const inside = words.find(([a, b]) => pos >= a && pos < b);
      const edge = inside ? inside[1] : Math.min(...words.map(([a]) => a).filter((a) => a > pos), at + p.text.length);
      const end = Math.min(p.text.length, edge - at);
      out.push({ text: p.text.slice(start, end), cls: inside ? `${p.cls} w` : p.cls });
      start = end;
    }
    at += p.text.length;
  }
  return out;
}
