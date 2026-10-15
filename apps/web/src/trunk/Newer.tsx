"use client";

import { ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTrunk } from "./context";

/** A page shows the version that was newest when it loaded, so it holds still
 *  while agents land changes; this says how far the trunk has moved since,
 *  and loads the newest on a click. Pages pinned to a version leave it out. */
export function Newer({ version }: { version: number }) {
  const { head } = useTrunk();
  const router = useRouter();
  if (!head || head.version <= version) return null;
  const n = head.version - version;
  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--series-1)_40%,transparent)] bg-[color-mix(in_srgb,var(--series-1)_10%,transparent)] px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-[color-mix(in_srgb,var(--series-1)_18%,transparent)]"
    >
      <ArrowUp size={12} aria-hidden />
      {n.toLocaleString("en-US")} newer {n === 1 ? "version" : "versions"}, up to v{head.version.toLocaleString("en-US")}
    </button>
  );
}
