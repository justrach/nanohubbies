import type { PullFile } from "./types";

// A big pull request reads best in an order that follows what the files do:
// what the change says it does, where the code is reached from, the code,
// its tests, then the build around it. Generated files come last, collapsed.

export type Role = "docs" | "entry" | "source" | "tests" | "config" | "generated";

export const ROLES: { role: Role; label: string }[] = [
  { role: "docs", label: "Docs" },
  { role: "entry", label: "Entry points" },
  { role: "source", label: "Source" },
  { role: "tests", label: "Tests" },
  { role: "config", label: "Build and CI" },
  { role: "generated", label: "Generated" },
];

const CONFIG_NAMES =
  /^(cargo\.toml|package\.json|tsconfig[\w.-]*\.json|go\.mod|pyproject\.toml|setup\.(py|cfg)|makefile|dockerfile|build\.zig(\.zon)?|wrangler\.(toml|jsonc?)|\.gitignore|\.npmrc|vite\.config\.\w+)$/;

export function roleOf(f: PullFile): Role {
  if (f.generated) return "generated";
  const path = f.path.toLowerCase();
  const name = path.split("/").pop() ?? path;
  if (/\.(md|mdx|rst|adoc|txt)$/.test(name) || /(^|\/)docs?\//.test(path)) return "docs";
  if (/(^|\/)(tests?|__tests__|spec|e2e|fixtures?|testdata)\//.test(path) || /[._-](test|spec)\.\w+$/.test(name) || /^test_\w+\.py$/.test(name)) return "tests";
  if (path.startsWith(".github/") || CONFIG_NAMES.test(name) || /\.(ya?ml|toml)$/.test(name)) return "config";
  if (/^(lib|main|mod|index|cli|app)\.\w+$/.test(name)) return "entry";
  return "source";
}

/** Files grouped by role, in reading order; paths sorted within a group. */
export function readingOrder(files: PullFile[]): { role: Role; label: string; files: PullFile[] }[] {
  return ROLES.map(({ role, label }) => ({
    role,
    label,
    files: files.filter((f) => roleOf(f) === role).sort((a, b) => a.path.localeCompare(b.path)),
  })).filter((g) => g.files.length);
}

/** Lines changed per directory, `depth` levels deep, biggest first. */
export function areas(files: PullFile[], depth = 2) {
  const by = new Map<string, { dir: string; files: number; additions: number; deletions: number }>();
  for (const f of files) {
    const parts = f.path.split("/");
    const dir = parts.length > 1 ? parts.slice(0, Math.min(depth, parts.length - 1)).join("/") : "(top level)";
    const a = by.get(dir) ?? { dir, files: 0, additions: 0, deletions: 0 };
    a.files++;
    a.additions += f.additions;
    a.deletions += f.deletions;
    by.set(dir, a);
  }
  return [...by.values()].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions));
}

/** Top-level definitions a new or changed file adds, found by shape, for the
 *  file's outline. Good enough to jump around a long file; not a parser. */
const OUTLINE: Record<string, RegExp> = {
  rs: /^\s*(?:pub(?:\([\w:]+\))?\s+)?(?:async\s+)?(fn|struct|enum|trait|impl|mod|type|const|static)\s+(?:<[^>]*>\s*)?([A-Za-z_][\w:]*(?:\s+for\s+[A-Za-z_][\w:<>]*)?)/,
  ts: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(function|class|interface|type|enum|const)\s+([A-Za-z_$][\w$]*)/,
  py: /^(def|class|async def)\s+([A-Za-z_]\w*)/,
  go: /^(func|type)\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
  zig: /^\s*(?:pub\s+)?(fn|const|var)\s+([A-Za-z_]\w*)/,
};
const OUTLINE_EXT: Record<string, string> = { rs: "rs", ts: "ts", tsx: "ts", js: "ts", jsx: "ts", mjs: "ts", py: "py", go: "go", zig: "zig" };

export function outlineRule(path: string): RegExp | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return OUTLINE_EXT[ext] ? OUTLINE[OUTLINE_EXT[ext]] : null;
}
