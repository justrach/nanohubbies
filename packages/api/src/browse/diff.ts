// Line diffs in the unified format, as git and GitHub write them: Myers'
// algorithm on the lines between the common start and end, with three lines
// of context around each change.

export interface FilePatch {
  /** The hunks, from the first "@@" line on; empty when nothing differs. */
  hunks: string;
  additions: number;
  deletions: number;
}

const CONTEXT = 3;
/** Past this many differing lines a file reads as rewritten whole, which keeps
 *  the diff's memory and time small. */
const MAX_EDITS = 1000;

/** keep, delete, add */
type Op = 0 | 1 | 2;

interface Side {
  lines: string[];
  /** Whether the text ends with a newline. */
  eol: boolean;
}

function split(text: string): Side {
  if (text === "") return { lines: [], eol: true };
  const lines = text.split("\n");
  const eol = lines[lines.length - 1] === "";
  if (eol) lines.pop();
  return { lines, eol };
}

export function unified(before: string, after: string): FilePatch {
  const a = split(before);
  const b = split(after);
  // A last line without a newline differs from the same text with one, so
  // each line is compared as a number that also says so.
  const ids = new Map<string, number>();
  const id = (s: Side, i: number) => {
    const key = i === s.lines.length - 1 && !s.eol ? `${s.lines[i]}\n` : s.lines[i];
    let n = ids.get(key);
    if (n === undefined) ids.set(key, (n = ids.size));
    return n;
  };
  const ops = script(Int32Array.from(a.lines, (_, i) => id(a, i)), Int32Array.from(b.lines, (_, i) => id(b, i)));
  return hunks(ops, a, b);
}

/** The edit script turning `a` into `b`. */
function script(a: Int32Array, b: Int32Array): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const midA = a.subarray(start, a.length - end);
  const midB = b.subarray(start, b.length - end);
  const mid = myers(midA, midB) ?? [...new Array<Op>(midA.length).fill(1), ...new Array<Op>(midB.length).fill(2)];
  return [...new Array<Op>(start).fill(0), ...mid, ...new Array<Op>(end).fill(0)];
}

/** The shortest edit script, or null past MAX_EDITS edits. Each step keeps
 *  the furthest point reached on every diagonal; the points at each step are
 *  kept for the walk back. */
function myers(a: Int32Array, b: Int32Array): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= Math.min(max, MAX_EDITS); d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) return back(trace, n, m);
    }
  }
  return null;
}

function back(trace: Int32Array[], n: number, m: number): Op[] {
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const at = (k: number) => trace[d][k + d + 1];
    const k = x - y;
    const prev = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const px = at(prev);
    const py = px - prev;
    while (x > px && y > py) {
      ops.push(0);
      x--;
      y--;
    }
    if (d > 0) ops.push(x === px ? 2 : 1);
    x = px;
    y = py;
  }
  return ops.reverse();
}

interface Row {
  op: Op;
  text: string;
  /** The side this line ends lacks a final newline. */
  noEol: boolean;
}

function hunks(ops: Op[], a: Side, b: Side): FilePatch {
  const rows: Row[] = [];
  let i = 0;
  let j = 0;
  let additions = 0;
  let deletions = 0;
  for (const op of ops) {
    const lastA = i === a.lines.length - 1 && !a.eol;
    const lastB = j === b.lines.length - 1 && !b.eol;
    if (op === 0) {
      rows.push({ op, text: a.lines[i++], noEol: lastA && lastB });
      j++;
    } else if (op === 1) {
      rows.push({ op, text: a.lines[i++], noEol: lastA });
      deletions++;
    } else {
      rows.push({ op, text: b.lines[j++], noEol: lastB });
      additions++;
    }
  }
  // Each run of changes with its context; runs closer than twice the
  // context join into one hunk.
  const out: string[] = [];
  const oldBefore = new Int32Array(rows.length + 1);
  const newBefore = new Int32Array(rows.length + 1);
  rows.forEach((r, k) => {
    oldBefore[k + 1] = oldBefore[k] + (r.op !== 2 ? 1 : 0);
    newBefore[k + 1] = newBefore[k] + (r.op !== 1 ? 1 : 0);
  });
  for (let k = 0; k < rows.length; ) {
    if (rows[k].op === 0) {
      k++;
      continue;
    }
    const from = Math.max(0, k - CONTEXT);
    let last = k;
    for (let q = k; q < rows.length && q <= last + 2 * CONTEXT; q++) if (rows[q].op !== 0) last = q;
    const to = Math.min(rows.length, last + CONTEXT + 1);
    const oldLines = oldBefore[to] - oldBefore[from];
    const newLines = newBefore[to] - newBefore[from];
    const oldStart = oldLines ? oldBefore[from] + 1 : oldBefore[from];
    const newStart = newLines ? newBefore[from] + 1 : newBefore[from];
    out.push(`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`);
    for (let q = from; q < to; q++) {
      const r = rows[q];
      out.push(`${r.op === 0 ? " " : r.op === 1 ? "-" : "+"}${r.text}`);
      if (r.noEol) out.push("\\ No newline at end of file");
    }
    k = to;
  }
  return { hunks: out.length ? `${out.join("\n")}\n` : "", additions, deletions };
}

const ZERO = "0".repeat(40);

/** One file's part of a patch that `git apply` and `git am` take. Trunks hold
 *  regular files only, so every mode is 100644. */
export function gitDiff(path: string, before: { sha: string; text: string } | null, after: { sha: string; text: string } | null): string {
  const { hunks } = unified(before?.text ?? "", after?.text ?? "");
  const head = [`diff --git a/${path} b/${path}`];
  if (!before) head.push("new file mode 100644", `index ${ZERO}..${after!.sha}`);
  else if (!after) head.push("deleted file mode 100644", `index ${before.sha}..${ZERO}`);
  else head.push(`index ${before.sha}..${after.sha} 100644`);
  // An empty file added or removed has no hunks, and git writes no file names for it.
  if (hunks) head.push(before ? `--- a/${path}` : "--- /dev/null", after ? `+++ b/${path}` : "+++ /dev/null");
  return `${head.join("\n")}\n${hunks}`;
}
