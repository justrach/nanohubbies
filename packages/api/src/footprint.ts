import { parse } from "acorn";
import { key, type Edit } from "./types";

/** acorn's ESTree nodes, loosely typed: this module only walks them. */
type Node = { type: string; start: number; end: number; [field: string]: any };

export interface Sym {
  name: string;
  kind: string;
  /** Span in the file, including the comments directly above. */
  start: number;
  end: number;
  text: string;
  line: number;
  /** Names the symbol uses but does not declare. */
  refs: Set<string>;
  /** What code using the symbol depends on: its name and parameters. */
  iface: string;
}

/** A change that cannot apply to the trunk as written. Unlike a conflict,
 *  re-planning on a newer base does not help unless the agent changes it. */
export class EditError extends Error {}

export const isCode = (path: string) => /\.[cm]?js$/.test(path);

/** Parses kept by path and text, the most recent up to about PARSED_BYTES of
 *  text. A landing parses the file it leaves behind, and the next change to
 *  that file parses the same text as its tip: kept long enough for every
 *  agent of a big swarm to come round again. */
const parsed = new Map<string, Sym[] | Error>();
let parsedBytes = 0;
const PARSED_BYTES = 4 * 1024 * 1024;

/** Splits a file into top-level symbols. A file that is not code is one
 *  symbol, "*". So is a .js file the parser cannot read (JSX, Flow, a syntax
 *  error), unless `strict`, which throws instead. The result is shared:
 *  callers read it and never change it. */
export function symbols(path: string, src: string, strict = false): Sym[] {
  const whole = (): Sym[] => [{ name: "*", kind: "file", start: 0, end: src.length, text: src, line: 1, refs: new Set(), iface: "" }];
  if (!isCode(path)) return whole();
  const k = `${path}\0${src}`;
  let got = parsed.get(k);
  if (!got) {
    got = split(src);
    parsed.set(k, got);
    parsedBytes += k.length;
    for (const [old] of parsed) {
      if (parsedBytes <= PARSED_BYTES) break;
      parsed.delete(old);
      parsedBytes -= old.length;
    }
  }
  if (!(got instanceof Error)) return got;
  if (strict) throw new EditError(`${path} does not parse: ${got.message}`);
  return whole();
}

function split(src: string): Sym[] | Error {
  const comments: Node[] = [];
  let program: Node;
  try {
    program = parse(src, { ecmaVersion: "latest", sourceType: "module", onComment: comments as never }) as unknown as Node;
  } catch (e) {
    return e as Error;
  }
  const out: Sym[] = [];
  const seen = new Map<string, number>();
  let statements = 0;
  let prevEnd = 0;
  for (const node of program.body as Node[]) {
    // A comment directly above a statement belongs to it.
    let start = node.start;
    for (const c of comments.filter((c) => c.start >= prevEnd && c.end <= node.start).reverse()) {
      if (src.slice(c.end, start).trim() !== "") break;
      start = c.start;
    }
    const d = describe(node, src, () => `stmt:${statements++}`);
    const n = (seen.get(d.name) ?? 0) + 1;
    seen.set(d.name, n);
    out.push({
      name: n === 1 ? d.name : `${d.name}~${n}`,
      kind: d.kind,
      start,
      end: node.end,
      text: src.slice(start, node.end),
      line: src.slice(0, start).split("\n").length,
      refs: uses(node, d.own),
      iface: d.iface,
    });
    prevEnd = node.end;
  }
  return out;
}

export interface Footprint {
  writes: Set<string>;
  reads: Set<string>;
}

/** Keys the edits name directly, known without parsing anything. The
 *  sequencer checks these first, so an edit to a symbol another change
 *  already rewrote is reported as a conflict, not as a missing symbol. */
export function targets(edits: Edit[]): Footprint {
  const writes = new Set<string>();
  const reads = new Set<string>();
  for (const e of edits) {
    if (e.op === "create" || e.op === "remove") {
      writes.add(key.path(e.path));
      continue;
    }
    reads.add(key.path(e.path));
    if (e.op === "replace" || e.op === "delete") writes.add(key.def(e.path, e.symbol));
    if (e.op === "insert" && e.after) reads.add(key.def(e.path, e.after));
  }
  return { writes, reads };
}

export interface Applied extends Footprint {
  /** New contents by path; null for a removed file. */
  files: Map<string, string | null>;
  /** Keys of inserted symbols whose names the file already has. */
  collisions: string[];
}

/** Applies edits to the tip's files and derives the change's full footprint
 *  from what the edits actually do: renames, interface changes, and every use
 *  of a name added or removed. */
export function applyEdits(edits: Edit[], tipText: (path: string) => string | undefined): Applied {
  const { writes, reads } = targets(edits);
  const files = new Map<string, string | null>();
  const collisions: string[] = [];
  const byPath = new Map<string, Edit[]>();
  for (const e of edits) byPath.set(e.path, [...(byPath.get(e.path) ?? []), e]);

  for (const [path, list] of byPath) {
    if (list.length > 1 && list.some((e) => e.op === "create" || e.op === "remove" || e.op === "write")) {
      throw new EditError(`${path}: create, remove and write must be the only edit to a file`);
    }
    const tip = tipText(path);
    const [first] = list;
    if (first.op === "create") {
      if (tip !== undefined) throw new EditError(`${path} already exists`);
      for (const s of symbols(path, first.text, true)) {
        writes.add(key.def(path, s.name));
        usesChanged(new Set(), s.refs, writes);
      }
      files.set(path, first.text);
      continue;
    }
    if (tip === undefined) throw new EditError(`${path} does not exist`);
    if (first.op === "write") {
      // Every symbol before and after is written. A symbol that is gone or
      // takes different parameters reads its uses, as a rename would.
      const before = symbols(path, tip);
      const after = symbols(path, first.text);
      for (const s of [...before, ...after]) writes.add(key.def(path, s.name));
      const ifaces = new Map(after.map((s) => [s.name, s.iface]));
      for (const s of before) if (ifaces.get(s.name) !== s.iface) reads.add(key.refs(s.name));
      usesChanged(new Set(before.flatMap((s) => [...s.refs])), new Set(after.flatMap((s) => [...s.refs])), writes);
      files.set(path, first.text);
      continue;
    }
    const current = symbols(path, tip);
    // A file the parser could not split is one whole-file symbol; edits to it
    // replace the whole file and are not held to parsing.
    const whole = current.length === 1 && current[0].name === "*";
    if (first.op === "remove") {
      for (const s of current) {
        writes.add(key.def(path, s.name));
        reads.add(key.refs(s.name));
        usesChanged(s.refs, new Set(), writes);
      }
      files.set(path, null);
      continue;
    }

    const byName = new Map(current.map((s) => [s.name, s]));
    const need = (name: string) => {
      const s = byName.get(name);
      if (!s) throw new EditError(`${path} has no symbol ${name}`);
      return s;
    };
    const splices: { at: number; end: number; text: string; order: number }[] = [];
    const clashes = collisions.length;
    for (const [order, e] of list.entries()) {
      if (e.op === "replace") {
        const old = need(e.symbol);
        const text = isCode(path) ? e.text.trim() : e.text;
        const replaced = symbols(path, text, !whole);
        if (replaced.length !== 1) throw new EditError(`${path}#${e.symbol}: a replacement must be exactly one top-level statement`);
        const [neu] = replaced;
        // Statement names are positions, not identities, so they never rename.
        const renamed = old.kind !== "statement" && neu.name !== old.name;
        if (renamed) writes.add(key.def(path, neu.name));
        if (renamed || neu.iface !== old.iface) reads.add(key.refs(old.name));
        usesChanged(old.refs, neu.refs, writes);
        splices.push({ at: old.start, end: old.end, text, order });
      } else if (e.op === "insert") {
        if (!isCode(path) || whole) throw new EditError(`${path}: insert needs code the parser can split; replace the whole file instead`);
        const anchor = e.after ? need(e.after) : current.at(-1);
        const text = e.text.trim();
        const added = symbols(path, text, true);
        if (!added.length) throw new EditError(`${path}: nothing to insert`);
        for (const s of added) {
          const k = key.def(path, s.name);
          writes.add(k);
          if (byName.has(s.name)) collisions.push(k);
          usesChanged(new Set(), s.refs, writes);
        }
        const at = anchor ? anchor.end : 0;
        splices.push({ at, end: at, text: anchor ? `\n\n${text}` : `${text}\n\n`, order });
      } else if (e.op === "delete") {
        if (!isCode(path) || whole) throw new EditError(`${path}: delete needs code the parser can split; remove the file instead`);
        const old = need(e.symbol);
        reads.add(key.refs(old.name));
        usesChanged(old.refs, new Set(), writes);
        let end = old.end;
        while (end < tip.length && end - old.end < 2 && tip[end] === "\n") end++;
        splices.push({ at: old.start, end, text: "", order });
      }
    }
    // A clash means the change will not land, and the file would not parse.
    if (collisions.length > clashes) continue;

    // Apply back to front so earlier offsets stay valid. At one offset the
    // later edit goes first, which keeps inserts in their submitted order.
    splices.sort((a, b) => b.at - a.at || b.order - a.order);
    let text = tip;
    let limit = Infinity;
    for (const s of splices) {
      if (s.end > limit) throw new EditError(`${path}: edits overlap`);
      text = text.slice(0, s.at) + s.text + text.slice(s.end);
      limit = s.at;
    }
    if (!whole) symbols(path, text, true); // a file that parsed must still parse
    files.set(path, text);
  }
  return { files, writes, reads, collisions };
}

/** Writes r:<name> for every name a symbol started or stopped using. */
function usesChanged(before: Set<string>, after: Set<string>, writes: Set<string>) {
  for (const name of before) if (!after.has(name)) writes.add(key.refs(name));
  for (const name of after) if (!before.has(name)) writes.add(key.refs(name));
}

interface Described {
  name: string;
  kind: string;
  iface: string;
  /** Names the statement itself declares. */
  own: string[];
}

function describe(node: Node, src: string, statement: () => string): Described {
  const exported = node.type.startsWith("Export");
  const decl: Node | null = exported ? (node.declaration ?? null) : node;
  const prefix = exported ? "export " : "";
  if (node.type === "ImportDeclaration") return { name: `import:${node.source.value}`, kind: "import", iface: "", own: [] };
  if (node.type === "ExportDefaultDeclaration") return { name: "default", kind: "export", iface: "export default", own: decl?.id ? [decl.id.name] : [] };
  if (node.type === "ExportAllDeclaration") return { name: `export:*:${node.source.value}`, kind: "export", iface: "", own: [] };
  if (!decl) {
    const names = node.specifiers.map((s: Node) => s.exported.name ?? s.exported.value).join(",");
    return { name: `export:${names}${node.source ? `:${node.source.value}` : ""}`, kind: "export", iface: "", own: [] };
  }
  switch (decl.type) {
    case "FunctionDeclaration":
      return { name: decl.id.name, kind: "function", iface: `${prefix}${decl.id.name}(${params(decl, src)})`, own: [decl.id.name] };
    case "ClassDeclaration":
      return { name: decl.id.name, kind: "class", iface: `${prefix}class ${decl.id.name}`, own: [decl.id.name] };
    case "VariableDeclaration": {
      const own: string[] = decl.declarations.flatMap((d: Node) => bound(d.id));
      const init: Node | null = decl.declarations.length === 1 ? decl.declarations[0].init : null;
      const fn = init && /Function/.test(init.type) ? `(${params(init, src)})` : "";
      return { name: own.join(","), kind: decl.kind, iface: `${prefix}${own.join(",")}${fn}`, own };
    }
    default:
      return { name: statement(), kind: "statement", iface: "", own: [] };
  }
}

function params(fn: Node, src: string) {
  return fn.params.length ? src.slice(fn.params[0].start, fn.params[fn.params.length - 1].end) : "";
}

/** Names a binding pattern declares. */
function bound(p: Node | null): string[] {
  if (!p) return [];
  switch (p.type) {
    case "Identifier":
      return [p.name];
    case "ObjectPattern":
      return p.properties.flatMap((q: Node) => bound(q.type === "RestElement" ? q.argument : q.value));
    case "ArrayPattern":
      return p.elements.flatMap((q: Node | null) => bound(q));
    case "RestElement":
      return bound(p.argument);
    case "AssignmentPattern":
      return bound(p.left);
    default:
      return [];
  }
}

/** Names a statement uses but does not declare. Scopes are flattened: a name
 *  declared anywhere inside the statement counts as local throughout it. That
 *  can hide a use of a shadowed name; it never invents one. */
function uses(stmt: Node, own: string[]): Set<string> {
  const used = new Set<string>();
  const local = new Set<string>(own);

  const bind = (p: Node | null) => {
    if (!p) return;
    for (const name of bound(p)) local.add(name);
    patternUses(p);
  };
  // Default values and computed keys inside a pattern are uses.
  const patternUses = (p: Node | null): void => {
    if (!p) return;
    switch (p.type) {
      case "ObjectPattern":
        for (const q of p.properties) {
          if (q.type === "RestElement") patternUses(q.argument);
          else {
            if (q.computed) visit(q.key);
            patternUses(q.value);
          }
        }
        return;
      case "ArrayPattern":
        for (const q of p.elements) patternUses(q);
        return;
      case "RestElement":
        patternUses(p.argument);
        return;
      case "AssignmentPattern":
        patternUses(p.left);
        visit(p.right);
        return;
      case "MemberExpression":
        visit(p);
        return;
    }
  };
  const visit = (n: Node | null | undefined): void => {
    if (!n || typeof n.type !== "string") return;
    switch (n.type) {
      case "Identifier":
        used.add(n.name);
        return;
      case "MemberExpression":
        visit(n.object);
        if (n.computed) visit(n.property);
        return;
      case "Property":
      case "PropertyDefinition":
      case "MethodDefinition":
        if (n.computed) visit(n.key);
        visit(n.value);
        return;
      case "VariableDeclarator":
        bind(n.id);
        visit(n.init);
        return;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (n.id) local.add(n.id.name);
        for (const p of n.params) bind(p);
        visit(n.body);
        return;
      case "ClassDeclaration":
      case "ClassExpression":
        if (n.id) local.add(n.id.name);
        visit(n.superClass);
        visit(n.body);
        return;
      case "CatchClause":
        bind(n.param);
        visit(n.body);
        return;
      case "LabeledStatement":
        visit(n.body);
        return;
      case "BreakStatement":
      case "ContinueStatement":
      case "MetaProperty":
        return;
      case "ImportDeclaration":
        // Importing a name uses that export of the other module.
        for (const s of n.specifiers) {
          used.add(s.type === "ImportSpecifier" ? (s.imported.name ?? s.imported.value) : s.type === "ImportDefaultSpecifier" ? "default" : "*");
        }
        return;
      case "ExportNamedDeclaration":
        if (n.declaration) visit(n.declaration);
        else if (!n.source) for (const s of n.specifiers) used.add(s.local.name ?? s.local.value);
        return;
    }
    for (const field of Object.keys(n)) {
      if (field === "type" || field === "start" || field === "end") continue;
      const v = n[field];
      if (Array.isArray(v)) for (const c of v) visit(c);
      else if (v && typeof v === "object") visit(v);
    }
  };

  visit(stmt);
  for (const name of local) used.delete(name);
  return used;
}
