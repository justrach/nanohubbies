// Unified diffs, as GitHub returns them per file, parsed into hunks of rows,
// with the words that changed marked inside each pair of edited lines.

/** [start, end) character offsets into a row's text. */
export type Range = [number, number];

export type Row =
  | { kind: "add" | "del" | "ctx"; old: number | null; new: number | null; text: string; words: Range[] }
  | { kind: "meta"; old: null; new: null; text: string; words: Range[] };

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** The enclosing function or block, when the diff names it. */
  section: string;
  /** Unchanged lines skipped between the previous hunk (or the top) and this one. */
  hidden: number;
  rows: Row[];
}

const HEAD = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

export function parsePatch(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let h: Hunk | null = null;
  let o = 0;
  let n = 0;
  let oldEnd = 1;
  for (const raw of patch.split("\n")) {
    const m = HEAD.exec(raw);
    if (m) {
      const oldStart = Number(m[1]);
      h = {
        oldStart,
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        section: m[5] ?? "",
        hidden: Math.max(0, oldStart - oldEnd),
        rows: [],
      };
      hunks.push(h);
      o = h.oldStart;
      n = h.newStart;
      oldEnd = h.oldStart + h.oldLines;
      continue;
    }
    if (!h) continue;
    const sign = raw[0];
    const text = raw.slice(1);
    if (sign === "+") h.rows.push({ kind: "add", old: null, new: n++, text, words: [] });
    else if (sign === "-") h.rows.push({ kind: "del", old: o++, new: null, text, words: [] });
    else if (sign === "\\") h.rows.push({ kind: "meta", old: null, new: null, text: raw.slice(2), words: [] });
    else if (o < h.oldStart + h.oldLines || n < h.newStart + h.newLines) h.rows.push({ kind: "ctx", old: o++, new: n++, text, words: [] });
  }
  for (const hunk of hunks) markWords(hunk.rows);
  return hunks;
}

/** Pairs each run of deleted lines with the added lines right after it, line
 *  by line, and marks the words that differ. Lines that share too little are
 *  left whole: highlighting all of a rewritten line says nothing. */
export function markWords(rows: Row[]) {
  for (let i = 0; i < rows.length; ) {
    if (rows[i].kind !== "del") {
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].kind === "del") j++;
    let k = j;
    while (k < rows.length && rows[k].kind === "add") k++;
    const pairs = Math.min(j - i, k - j);
    for (let p = 0; p < pairs; p++) {
      const [a, b] = wordDiff(rows[i + p].text, rows[j + p].text);
      rows[i + p].words = a;
      rows[j + p].words = b;
    }
    i = k;
  }
}

const TOKEN = /\w+|\s+|[^\w\s]/g;

/** The ranges of `a` and `b` outside their longest common token sequence. */
export function wordDiff(a: string, b: string): [Range[], Range[]] {
  const ta = a.match(TOKEN) ?? [];
  const tb = b.match(TOKEN) ?? [];
  if (!ta.length || !tb.length || ta.length * tb.length > 60_000) return [[], []];
  const n = ta.length;
  const m = tb.length;
  // lcs[i][j]: the common length of ta[i..] and tb[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = ta[i] === tb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const keepA = new Uint8Array(n);
  const keepB = new Uint8Array(m);
  let shared = 0;
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (ta[i] === tb[j]) {
      keepA[i++] = 1;
      keepB[j++] = 1;
      shared++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  if (shared * 2 < Math.min(n, m)) return [[], []];
  return [ranges(ta, keepA), ranges(tb, keepB)];
}

/** Changed tokens as ranges. Whitespace alone never counts as a change, but
 *  whitespace between two changed tokens joins them into one range. */
function ranges(tokens: string[], keep: Uint8Array): Range[] {
  const out: Range[] = [];
  let at = 0;
  let gap = -1;
  for (let i = 0; i < tokens.length; i++) {
    const end = at + tokens[i].length;
    const last = out[out.length - 1];
    if (!keep[i] && tokens[i].trim()) {
      if (last && (last[1] === at || last[1] === gap)) last[1] = end;
      else out.push([at, end]);
      gap = -1;
    } else if (!tokens[i].trim() && last && last[1] === at) {
      gap = at;
    } else {
      gap = -1;
    }
    at = end;
  }
  return out;
}
