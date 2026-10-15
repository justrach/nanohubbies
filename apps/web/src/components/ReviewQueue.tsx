import { useEffect, useMemo, useState } from "react";
import { TaskList, type Task } from "@/components/rare/task-list";
import type { Sequenced } from "@/lib/types";

/** Review by exception: people look only at what the sequencer could not vouch
 *  for. A change that landed while something it skimmed changed asks for a
 *  re-check; a rejected change asks why. Checking an item marks it reviewed. */
export function ReviewQueue({ trunk, feed }: { trunk: string; feed: Sequenced[] }) {
  const storeKey = `reviewed:${trunk}`;
  const [reviewed, setReviewed] = useState<Set<string>>(() => load(storeKey));
  useEffect(() => setReviewed(load(storeKey)), [storeKey]);

  const tasks = useMemo<Task[]>(() => {
    const out: Task[] = [];
    for (const e of feed) {
      if (e.t === "landed" && e.revalidate.length) {
        out.push({ id: e.change, label: `Re-check v${e.version}, ${e.agent}: "${e.intent}". It skimmed ${short(e.revalidate)}, which changed while it worked.` });
      } else if (e.t === "rejected" && e.kind === "agent") {
        out.push({ id: e.change, label: `${e.agent}'s change was rejected: ${e.error}` });
      }
    }
    return out
      .slice(-40)
      .reverse()
      .map((t) => ({ ...t, done: reviewed.has(t.id) }));
  }, [feed, reviewed]);

  if (!tasks.length) return <p className="py-6 text-center text-xs text-muted">Nothing needs a person. Changes land on their own unless the sequencer has a doubt.</p>;
  return (
    <div className="max-h-[360px] overflow-auto">
      <TaskList
        size="sm"
        accent="#3987e5"
        tasks={tasks}
        className="w-full"
        onTasksChange={(next) => {
          const done = new Set(reviewed);
          for (const t of next) {
            if (t.done) done.add(t.id);
            else done.delete(t.id);
          }
          setReviewed(done);
          localStorage.setItem(storeKey, JSON.stringify([...done].slice(-500)));
        }}
      />
    </div>
  );
}

/** How many items still need a person, for the bell in the top bar. */
export function openReviews(trunk: string, feed: Sequenced[]): number {
  const reviewed = load(`reviewed:${trunk}`);
  return feed.filter((e) => ((e.t === "landed" && e.revalidate.length) || (e.t === "rejected" && e.kind === "agent")) && !reviewed.has(e.change)).length;
}

function short(keys: string[]) {
  const names = keys.map((k) => k.replace(/^d:/, ""));
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(" and ");
}

function load(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
