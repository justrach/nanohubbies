"use client";

import { ArrowRight, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/controls";
import { api, trunkPath } from "@/lib/api";
import { navigate } from "@/lib/router";
import { pullPath } from "@/pr/paths";

// The front page's few interactive parts; the rest of it renders on the server.

/** Deletes a trunk after asking, then reloads the list. */
export function DeleteTrunk({ trunk }: { trunk: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Delete ${trunk}`}
      title={`Delete ${trunk}`}
      disabled={busy}
      onClick={async (e) => {
        e.preventDefault();
        if (!confirm(`Delete ${trunk}, its history, and its Artifacts repo if it has one?`)) return;
        setBusy(true);
        await api(trunkPath(trunk), { method: "DELETE" }).catch((err: Error) => alert(err.message));
        router.refresh();
      }}
      className="grid size-7 shrink-0 place-items-center rounded-full text-muted opacity-0 group-hover:opacity-100 hover:bg-wash hover:text-critical focus-visible:opacity-100 disabled:opacity-50"
    >
      <Trash2 size={14} />
    </button>
  );
}

/** Opens any GitHub pull request on the reading page. */
export function PullReader() {
  const [pull, setPull] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const to = pullPath(pull);
        if (to) navigate(to);
        else setError("That is not a GitHub pull request: paste its address, or owner/repo#123");
      }}
    >
      <div className="flex gap-2">
        <input
          value={pull}
          onChange={(e) => setPull(e.target.value)}
          placeholder="https://github.com/owner/repo/pull/123"
          aria-label="Pull request"
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-page px-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-axis"
        />
        <Button type="submit">
          Read <ArrowRight size={13} aria-hidden />
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-critical">{error}</p>}
    </form>
  );
}
