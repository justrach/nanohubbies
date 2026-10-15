import { isCode, symbols } from "../footprint";

/** Top-level edit targets, excluding imports and generated agent scratch work. */
export function listTargets(sql: SqlStorage, limit: number) {
  const out: { path: string; name: string }[] = [];
  const rows = sql.exec<{ path: string; text: string }>("SELECT path, text FROM files WHERE path NOT LIKE 'src/swarm/%' ORDER BY path").toArray();
  for (const row of rows) {
    if (!isCode(row.path)) continue;
    for (const s of symbols(row.path, row.text)) {
      if (s.kind === "import" || s.kind === "file") continue;
      out.push({ path: row.path, name: s.name });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
