import { refSuffix, wellFormedName } from "./ref-name";
type Token = string | { kind: "star" | "deep" | "dirs" | "one" } | { kind: "class"; test: RegExp };
function tokens(pattern: string): Token[] {
  if (typeof pattern !== "string" || !pattern.length || pattern.length > 255 || !wellFormedName(pattern) || /[\\\0\r\n]/.test(pattern)) throw Error("Invalid glob pattern");
  const out: Token[] = [], chars = Array.from(pattern);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === "*" && chars[i + 1] === "*") {
      i++;
      if (chars[i + 1] === "/") { i++; out.push({ kind: "dirs" }); }
      else out.push({ kind: "deep" });
    } else if (c === "*") out.push({ kind: "star" });
    else if (c === "?") out.push({ kind: "one" });
    else if (c === "[") {
      const end = chars.indexOf("]", i + 1), set = chars.slice(i + 1, end).join("");
      if (end < 0 || !set || !/^[a-zA-Z0-9._-]+$/.test(set)) throw Error("Unsupported glob character class");
      try { out.push({ kind: "class", test: new RegExp(`^[${set}]$`) }); } catch { throw Error("Invalid glob character range"); }
      i = end;
    } else out.push(c); // Braces and a closing ] are literals, not extglob.
  }
  return out;
}
export function globPattern(pattern: string) { tokens(pattern); return pattern; }
/** Bounded dynamic programming avoids exponential backtracking on many stars. */
export function matchesGlob(pattern: string, value: string) {
  const chars = Array.from(value);
  let prev = new Uint8Array(chars.length + 1); prev[0] = 1;
  for (const t of tokens(pattern)) {
    const row = new Uint8Array(chars.length + 1);
    if (typeof t !== "string" && ["star", "deep", "dirs"].includes(t.kind)) {
      row[0] = prev[0]; let prefix = !!prev[0];
      for (let j = 1; j <= chars.length; j++) {
        row[j] = Number(!!prev[j] || (t.kind === "dirs" ? prefix && chars[j - 1] === "/" : !!row[j - 1] && (t.kind === "deep" || chars[j - 1] !== "/")));
        prefix ||= !!prev[j];
      }
    } else for (let j = 1; j <= chars.length; j++) row[j] = Number(!!prev[j - 1] && (typeof t === "string" ? chars[j - 1] === t : chars[j - 1] !== "/" && (t.kind === "one" || (t.kind === "class" && t.test.test(chars[j - 1])))));
    prev = row;
  }
  return !!prev[chars.length];
}
/** Path-aware branch globs: * and ? stay in one segment, ** crosses /. */
export function branchPattern(pattern: string) {
  if (typeof pattern !== "string" || pattern.length > 255 || !pattern.length)
    throw Error("Invalid branch pattern");
  globPattern(pattern);
  refSuffix(pattern.replace(/\[[^\]]+\]/g, "a").replace(/[?*]/g, "a"), "", 1024);
  return pattern;
}
export function matchesBranch(pattern: string, branch: string) {
  branchPattern(pattern);
  return matchesGlob(pattern, branch);
}
