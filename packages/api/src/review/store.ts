import type { ChangeRequest, Head, Submitted } from "../types";
import { branchName, type Branch, type Pull, type Review, type ReviewCommand, type ReviewSnapshot } from "./types";

/** Ref and review mutations share the sequencer's serialized writer. Objects
 * are published before a ref moves; every update compares the observed head. */
export class ReviewStore {
  constructor(private sql: SqlStorage, private main: () => Head) {
    sql.exec("CREATE TABLE IF NOT EXISTS review_branches (name TEXT PRIMARY KEY, commit_sha TEXT NOT NULL, tree_sha TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS review_pulls (number INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS review_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, pull INTEGER NOT NULL, data TEXT NOT NULL)");
  }

  snapshot(): ReviewSnapshot {
    return {
      branches: this.branches(),
      pulls: this.sql.exec<{ number: number; data: string }>("SELECT * FROM review_pulls ORDER BY number DESC").toArray().map((r) => ({ ...JSON.parse(r.data), number: r.number })),
      reviews: this.sql.exec<{ id: number; data: string }>("SELECT * FROM review_reviews ORDER BY id").toArray().map((r) => ({ ...JSON.parse(r.data), id: r.id })),
    };
  }

  branches(): Branch[] {
    const main = this.main();
    const branches = this.sql.exec<{ name: string; commit_sha: string; tree_sha: string; updated_at: number }>("SELECT * FROM review_branches ORDER BY name").toArray()
      .map((r) => ({ name: r.name, commit: r.commit_sha, tree: r.tree_sha, updatedAt: r.updated_at }));
    return [{ name: "main", commit: main.commit, tree: main.tree, updatedAt: 0 }, ...branches];
  }

  run(command: ReviewCommand, land: (req: ChangeRequest) => Submitted): ReviewSnapshot {
    const s = this.snapshot();
    const branch = (name: string) => {
      const b = s.branches.find((b) => b.name === name);
      if (!b) throw new Error(`No branch ${name}`);
      return b;
    };
    const matches = (b: Branch) => {
      if (branch(b.name).commit !== b.commit) throw new Error(`${b.name} changed; refresh and try again`);
    };
    const write = (name: string, next: { commit: string; tree: string }) => this.sql.exec(
      "INSERT INTO review_branches VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET commit_sha=excluded.commit_sha, tree_sha=excluded.tree_sha, updated_at=excluded.updated_at",
      name, next.commit, next.tree, Date.now());
    if (command.op === "snapshot") return s;
    if (command.op === "branch") {
      const c = command;
      branchName(c.name);
      if (c.name === "main") throw new Error("Use the main landing path to update main");
      const old = s.branches.find((b) => b.name === c.name);
      if ((old?.commit ?? null) !== c.old) throw new Error("Branch changed; fetch and try again");
      if (c.source) matches(c.source);
      if (!old && (s.branches.length >= 200 || s.branches.some((b) => b.name.startsWith(c.name + "/") || c.name.startsWith(b.name + "/")))) throw new Error("Branch limit or conflicting branch name");
      if (!c.next) {
        if (s.pulls.some((p) => p.state === "open" && (p.head === c.name || p.base === c.name))) throw new Error("Close or merge the open PRs using this branch first");
        this.sql.exec("DELETE FROM review_branches WHERE name = ?", c.name);
      } else {
        for (const update of c.rebased ?? []) {
          const p = s.pulls.find((p) => p.number === update.number);
          if (!p || p.state !== "open" || p.head !== c.name || p.anchor !== update.anchor || p.base !== update.base.name) throw new Error("PR changed while pushing; refresh and retry");
          matches(update.base);
          p.anchor = update.base.commit; p.anchorTree = update.base.tree; this.save(p);
        }
        write(c.name, c.next);
      }
    } else if (command.op === "open") {
      const c = command;
      matches(c.head); matches(c.base);
      if (!c.title.trim() || c.title.length > 200 || c.body.length > 16000) throw new Error("Provide a title of up to 200 characters and body of up to 16000");
      if (c.head.name === "main" || c.head.name === c.base.name) throw new Error("Choose a feature branch and a different base");
      if (s.pulls.length >= 500) throw new Error("This workspace has reached its 500 PR limit");
      if (s.pulls.some((p) => p.head === c.head.name && p.state === "open")) throw new Error("An open PR already uses this head branch");
      const seen = new Set([c.head.name]);
      for (let name = c.base.name; name !== "main";) {
        if (seen.has(name)) throw new Error("A PR stack cannot contain a cycle");
        seen.add(name);
        const parent = s.pulls.find((p) => p.head === name && p.state === "open");
        if (!parent) break;
        name = parent.base;
      }
      const now = Date.now();
      const p: Omit<Pull, "number"> = { title: c.title.trim(), body: c.body, head: c.head.name, base: c.base.name, anchor: c.anchor, anchorTree: c.anchorTree,
        parent: s.pulls.find((q) => q.state === "open" && q.head === c.base.name)?.number ?? null,
        headCommit: c.head.commit, headTree: c.head.tree, author: c.author, state: "open", createdAt: now, updatedAt: now, mergedCommit: null, mergedVersion: null };
      this.sql.exec("INSERT INTO review_pulls (data) VALUES (?)", JSON.stringify(p));
    } else {
      const c = command;
      const p = s.pulls.find((p) => p.number === c.number);
      if (!p) throw new Error("No such pull request");
      // Merge retries are idempotent, including after the published head moves.
      if (c.op === "merge" && p.state === "merged") return s;
      if (p.state !== "open") throw new Error("This pull request is no longer open");
      if (c.op === "close") { p.headCommit = branch(p.head).commit; p.headTree = branch(p.head).tree; p.state = "closed"; }
      if (c.op === "review") {
        if (!["COMMENT", "APPROVE", "REQUEST_CHANGES"].includes(c.verdict) || c.body.length > 16000) throw new Error("Invalid review");
        if (branch(p.head).commit !== c.commit || p.anchor !== c.anchor) throw new Error("The PR changed; review its latest diff");
        if (s.reviews.length >= 2000) throw new Error("Workspace review limit reached");
        const r: Omit<Review, "id"> = { pull: p.number, author: c.author, body: c.body, verdict: c.verdict, commit: c.commit, anchor: c.anchor, at: Date.now() };
        this.sql.exec("INSERT INTO review_reviews (pull, data) VALUES (?, ?)", p.number, JSON.stringify(r));
      }
      if (c.op === "restack" || c.op === "merge") {
        if (c.head.name !== p.head || c.anchor !== p.anchor) throw new Error("PR changed; refresh and try again");
        matches(c.head);
        if (c.op === "restack") {
          if (c.base.name !== p.base) throw new Error("PR base changed; refresh and try again");
          matches(c.base);
          write(p.head, c.next);
          p.anchor = c.base.commit; p.anchorTree = c.base.tree;
        } else {
          if (p.base !== "main") throw new Error("Merge the parent PR first");
          if (this.main().commit !== c.base.commit) throw new Error("Main changed; refresh and try again");
          const latest = new Map<string, Review>();
          for (const r of s.reviews.filter((r) => r.pull === p.number && r.verdict !== "COMMENT")) latest.set(r.author.id, r);
          if ([...latest.values()].some((r) => r.verdict === "REQUEST_CHANGES" && r.commit === c.head.commit && r.anchor === p.anchor)) throw new Error("Resolve the requested changes before merging");
          const result = land(c.request);
          if (result.status !== "landed") throw new Error(`Merge ${result.status}: ${"error" in result ? result.error : "refresh and retry after resolving conflicts"}`);
          p.state = "merged"; p.mergedCommit = result.commit; p.mergedVersion = result.version;
          p.headCommit = c.head.commit; p.headTree = c.head.tree;
          // Keep each child's anchor: its diff remains incremental after the
          // parent's squash landing. Restacking replays only the child's work.
          for (const child of s.pulls.filter((q) => q.state === "open" && q.base === p.head)) {
            child.base = "main"; child.parent = p.number; this.save(child);
          }
        }
      }
      this.save(p);
    }
    return this.snapshot();
  }

  private save(p: Pull) {
    p.updatedAt = Date.now();
    this.sql.exec("UPDATE review_pulls SET data = ? WHERE number = ?", JSON.stringify(p), p.number);
  }
}
