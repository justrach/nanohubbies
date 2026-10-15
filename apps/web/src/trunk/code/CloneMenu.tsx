"use client";

import { Bot, ChevronDown, Code2, Download, KeyRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, CopyButton } from "@/components/controls";
import { LinkButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { trunkHref } from "../paths";

/** The "Code" button: how to get the trunk with git, or what to tell an agent. */
export function CloneMenu({ trunk, origin, imported }: { trunk: string; origin: string; imported: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"git" | "agent">("git");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("pointerdown", away);
    addEventListener("keydown", esc);
    return () => {
      removeEventListener("pointerdown", away);
      removeEventListener("keydown", esc);
    };
  }, [open]);

  const url = `${origin}/git/${trunk}.git`;
  const brief = `${origin}/api/trunks/${trunk}/brief`;
  const prompt = `Work on the git repository ${url}. Read ${brief} first and follow it.`;
  return (
    <div ref={box} className="relative">
      <Button variant="primary" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog">
        <Code2 size={14} aria-hidden /> Code <ChevronDown size={13} aria-hidden />
      </Button>
      {open && (
        <div role="dialog" aria-label="Get the code" className="absolute right-0 z-30 mt-2 w-[min(400px,calc(100vw-2.5rem))] rounded-xl border border-line bg-surface p-3 shadow-2xl">
          <div role="tablist" className="mb-3 flex gap-1 rounded-md border border-line p-0.5 text-[11px]">
            {(
              [
                ["git", "Clone with git"],
                ["agent", "Hand to an agent"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("flex-1 rounded px-2 py-1", tab === id ? "bg-wash text-ink" : "text-muted hover:text-ink-2")}>
                {label}
              </button>
            ))}
          </div>
          {tab === "git" ? (
            <div className="space-y-2.5 text-xs">
              <div className="flex gap-1.5">
                <input readOnly value={`git clone ${url}`} onFocus={(e) => e.target.select()} className="h-7 min-w-0 flex-1 rounded-md border border-line bg-page px-2 font-mono text-[11.5px] text-ink outline-none" />
                <CopyButton text={`git clone ${url}`} />
              </div>
              <p className="leading-5 text-muted">Cloning needs no token. A push lands on main by itself unless someone changed the same code first; pushing needs a token.</p>
              <div className="flex flex-wrap gap-2">
                <LinkButton href={trunkHref(trunk, "/connect")} size="sm">
                  <KeyRound size={12} aria-hidden /> Make a push token
                </LinkButton>
                {imported && (
                  <LinkButton href={trunkHref(trunk, "/pulls")} size="sm">
                    <Download size={12} aria-hidden /> Send back to GitHub
                  </LinkButton>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2.5 text-xs">
              <p className="leading-5 text-ink-2">Paste this into any coding agent. The brief tells it how to clone, land a change, and pick an issue.</p>
              <div className="rounded-md border border-line bg-page p-2 font-mono text-[11.5px] leading-5 text-ink">{prompt}</div>
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton text={prompt} label="Copy prompt" variant="primary" />
                <a href={brief} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-ink-2 underline underline-offset-2 hover:text-ink">
                  <Bot size={12} aria-hidden /> Read the brief
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
