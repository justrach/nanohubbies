import { ago } from "@/lib/format";
import { GhAvatar, Who } from "./people";
import type { Activity, PullView } from "./types";

/** The pull request's commits, oldest first, as GitHub lists them. */
export function Commits({ pull }: { pull: PullView }) {
  const commits = pull.activity.filter((a): a is Extract<Activity, { kind: "commit" }> => a.kind === "commit");
  return (
    <ol className="divide-y divide-line rounded-xl border border-line bg-surface">
      {commits.map((c) => {
        const [subject, ...rest] = c.message.split("\n");
        const body = rest.join("\n").trim();
        return (
          <li key={c.sha} className="flex items-start gap-3 px-4 py-3">
            {c.author ? <GhAvatar person={c.author} size={22} /> : <span className="size-[22px]" />}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">{subject}</p>
              {body && <p className="mt-0.5 line-clamp-2 text-xs whitespace-pre-line text-muted">{body}</p>}
              <p className="mt-1 text-xs text-ink-2">
                {c.author ? <Who person={c.author} /> : "Someone"} <span className="text-muted">committed {ago(Date.now() - c.at)}</span>
              </p>
            </div>
            <a href={c.url} target="_blank" rel="noreferrer" className="shrink-0 rounded-md border border-line px-2 py-0.5 font-mono text-[11px] text-ink-2 hover:bg-wash hover:text-ink">
              {c.sha.slice(0, 7)}
            </a>
          </li>
        );
      })}
    </ol>
  );
}
