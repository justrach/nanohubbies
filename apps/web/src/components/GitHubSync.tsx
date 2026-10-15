"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./controls";
import { api, trunkPath } from "@/lib/api";
import { useSession } from "@/lib/session";

export function GitHubSync({ trunk }: { trunk: string }) {
  const { user } = useSession();
  const router = useRouter();
  const scope = `${trunk}:${user?.id ?? ""}`;
  const active = useRef(scope);
  active.current = scope;
  const [permission, setPermission] = useState<{
    scope: string;
    allowed: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const path = `${trunkPath(trunk)}/github-context`;
  useEffect(() => {
    let alive = true;
    setPermission(null);
    setBusy(false);
    setMessage("");
    if (user?.provider === "codegraff")
      void api<{ canRefresh: boolean }>(path).then(
        (result) => {
          if (alive) setPermission({ scope, allowed: result.canRefresh });
        },
        () => {},
      );
    return () => {
      alive = false;
    };
  }, [scope, path, user?.provider]);
  async function refresh() {
    setBusy(true);
    setMessage("");
    try {
      const result = await api<{ issues: number; pulls: number }>(path, {
        body: {},
      });
      if (active.current !== scope) return;
      setMessage(
        `Updated ${result.issues} issues and ${result.pulls} pull requests.`,
      );
      router.refresh();
    } catch (e) {
      if (active.current === scope) setMessage((e as Error).message);
    } finally {
      if (active.current === scope) setBusy(false);
    }
  }
  if (permission?.scope !== scope || !permission.allowed) return null;
  return (
    <div className="my-3 flex flex-wrap items-center gap-3">
      <Button
        size="sm"
        type="button"
        disabled={busy}
        onClick={() => void refresh()}
      >
        <RefreshCw
          size={13}
          className={busy ? "animate-spin" : ""}
          aria-hidden
        />
        {busy ? "Updating from GitHub…" : "Refresh issues & PRs"}
      </Button>
      {message && (
        <p role="status" className="text-xs text-ink-2">
          {message}
        </p>
      )}
    </div>
  );
}
