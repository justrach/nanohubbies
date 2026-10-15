import type { ChangeRequest, Head, Owner } from "../types";

export interface Branch { name: string; commit: string; tree: string; updatedAt: number }
export interface Pull {
  number: number; title: string; body: string; head: string; base: string;
  anchor: string; anchorTree: string; author: Owner;
  headCommit: string; headTree: string;
  parent: number | null;
  state: "open" | "closed" | "merged"; createdAt: number; updatedAt: number;
  mergedCommit: string | null; mergedVersion: number | null;
}
export interface Review {
  id: number; pull: number; author: Owner; body: string;
  verdict: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
  commit: string; anchor: string; at: number;
}
export interface ReviewSnapshot { branches: Branch[]; pulls: Pull[]; reviews: Review[] }
export type ReviewCommand =
  | { op: "snapshot" }
  | { op: "branch"; name: string; old: string | null; next: { commit: string; tree: string } | null; source?: Branch;
      rebased?: { number: number; anchor: string; base: Branch }[] }
  | { op: "open"; title: string; body: string; head: Branch; base: Branch; anchor: string; anchorTree: string; author: Owner }
  | { op: "close"; number: number }
  | { op: "review"; number: number; author: Owner; body: string; verdict: Review["verdict"]; commit: string; anchor: string }
  | { op: "restack"; number: number; head: Branch; base: Branch; anchor: string; next: { commit: string; tree: string } }
  | { op: "merge"; number: number; head: Branch; base: Head; anchor: string; request: ChangeRequest };

export function branchName(name: string) {
  if (typeof name !== "string" || name.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)
    || name.includes("..") || name.includes("//") || name.endsWith(".") || name.endsWith("/")
    || name.split("/").some((p) => p.startsWith(".") || p.endsWith(".lock"))) throw new Error("Invalid branch name");
  return name;
}
