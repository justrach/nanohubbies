"use client";

import { Files } from "@/pr/Files";
import { pathHref } from "../paths";
import type { ChangedFile } from "../types";

/** A version's changed files, drawn the way the pull request page draws a
 *  pull request's: reading order, highlighted diffs, j/k/v to work down them.
 *  Each file links to itself at `v`. */
export function ChangeFiles({ trunk, files, v, viewedKey }: { trunk: string; files: ChangedFile[]; v: number; viewedKey: string }) {
  const linked = files.map((f) => ({ ...f, url: pathHref(trunk, "blob", f.path, f.status === "removed" ? Math.max(1, v - 1) : v) }));
  return <Files files={linked} viewedKey={viewedKey} local />;
}
