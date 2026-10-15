import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import type { Person } from "./types";

/** A GitHub account's picture, or its initial when there is none. */
export function GhAvatar({ person, size = 20 }: { person: Person; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!person.avatar || failed) return <Avatar name={person.login} size={size} />;
  const src = `${person.avatar}${person.avatar.includes("?") ? "&" : "?"}s=${size * 2}`;
  return <img src={src} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} className="shrink-0 rounded-full bg-wash" />;
}

export function Who({ person }: { person: Person }) {
  return (
    <span className="font-medium text-ink">
      {person.login}
      {person.bot && <span className="ml-1 rounded border border-line px-1 text-[10px] font-normal text-muted">bot</span>}
    </span>
  );
}
