"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button, Input } from "@/components/controls";
import { GitHubMark } from "@/components/ui";
import { api, ApiError, trunkPath } from "@/lib/api";
import { navigate } from "@/lib/router";
import { useSession, useSignInUrl } from "@/lib/session";
import type { TrunkListing } from "@/lib/types";
import { nameFor, repoOf, trunkDestination } from "./start-model";

import { RepositoryPicker } from "@/onboarding/RepositoryPicker";

/** The one thing to do on the front page: name a GitHub repository and get a
 *  trunk of it, with its issues and pull requests. A repository that already
 *  has a trunk opens it instead. Signed in with Codegraff and GitHub
 *  connected there, your own repositories, private ones too, are one click. */
export function StartForm({ initial = "", autoFocus = false, destination = "setup", focused = false }: {
  focused?: boolean;
  initial?: string;
  autoFocus?: boolean;
  destination?: "setup" | "code";
}) {
  const { user, providers, github } = useSession();
  const signIn = useSignInUrl();
  const formId = useId();
  const pending = useRef(false);
  const target = (name: string) => trunkDestination(name, destination);
  const [input, setInput] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ repo: string; raw: string; trunks: TrunkListing[] } | null>(null);
  /** Imports `repo` (at `ref`, when given) as a new trunk, picking a free name. */
  const importRepo = async (repo: string, ref: string | null) => {
    const base = nameFor(repo);
    for (let i = 1; i <= 20; i++) {
      const name = i === 1 ? base : `${base}-${i}`;
      try {
        setBusy(user ? `Starting a background copy of ${repo}…` : `Copying ${repo}…`);
        await api(`${trunkPath(name)}/import`, { body: { repo: ref ? `${repo}#${ref}` : repo, background: !!user } });
        setBusy("Opening it…");
        navigate(target(name));
        return;
      } catch (e) {
        if (!(e instanceof ApiError) || !/already exists/.test(e.message)) throw e;
      }
    }
    throw new Error("could not find a free trunk name; delete some trunks first");
  };

  const start = async (raw: string, fresh = false) => {
    if (pending.current) return;
    setError(null);
    const repo = repoOf(raw);
    if (!repo) {
      setError("Give a GitHub repository: owner/name, or its github.com address.");
      return;
    }
    pending.current = true;
    setBusy("Finding your workspace…");
    try {
      if (!fresh) {
        const trunks = await api<TrunkListing[]>(`/api/github/trunks?repo=${encodeURIComponent(repo)}`);
        if (trunks.length) {
          setExisting({ repo, raw, trunks });
          setBusy(null);
          pending.current = false;
          return;
        }
      }
      setExisting(null);
      await importRepo(repo, raw.includes("#") ? raw.slice(raw.indexOf("#") + 1).trim() || null : null);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
      pending.current = false;
    }
  };

  const demo = async () => {
    if (pending.current) return;
    pending.current = true;
    setError(null);
    const name = `shop-${Math.random().toString(36).slice(2, 6)}`;
    try {
      setBusy("Making a demo trunk: a small JavaScript shop with issues to work on…");
      await api(trunkPath(name), { body: { template: "shop" } });
      navigate(target(name));
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
      pending.current = false;
    }
  };

  return (
    <div className="w-full">
      {focused && <label htmlFor={`${formId}-repo`} className="mb-3 block text-xs font-medium">GitHub repository</label>}
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          void start(input);
        }}
        className="field-shell flex w-full items-center gap-2 rounded-md border border-line bg-surface p-1.5 pl-3.5 focus-within:border-axis"
      >
        <GitHubMark size={18} className="shrink-0 text-ink-2" />
        <Input
          id={`${formId}-repo`}
          disabled={!!busy}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus={autoFocus}
          placeholder="github.com/owner/repository"
          aria-label="GitHub repository"
          className="h-10 min-w-0 flex-1 border-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
        />
        {!focused && <Button type="submit" variant="primary" size="lg" disabled={!!busy || !input.trim()}>
          Continue <ArrowRight size={15} aria-hidden />
        </Button>}
      </form>

      {focused && repoOf(input) && <p className="mt-3 break-all text-xs text-muted">Workspace · /t/{nameFor(repoOf(input)!)}</p>}
      {busy && <p role="status" className="mt-3 flex items-center gap-2 text-xs text-ink-2"><Loader2 size={12} className="animate-spin motion-reduce:animate-none" />{busy}</p>}
      {error && <p role="alert" className="mt-3 text-xs text-critical">{error}</p>}
      {existing && (
        <div className="mt-3 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-xs text-ink-2">
          <p>
            {existing.repo} is already here as{" "}
            {existing.trunks.slice(0, 3).map((t, i) => (
              <span key={t.name}>
                {i > 0 && ", "}
                <a href={target(t.name)} className="font-medium text-series-1 hover:underline">
                  {t.name}
                </a>
              </span>
            ))}
            .{" "}
            <Button variant="ghost" size="sm" type="button" onClick={() => void start(existing.raw, true)} disabled={!!busy} className="text-ink underline underline-offset-2 hover:text-series-1">
              Import a fresh trunk instead
            </Button>
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
        <Button variant="ghost" size="sm" type="button" onClick={() => void demo()} disabled={!!busy} className="flex items-center gap-1.5 font-medium text-ink-2 hover:text-ink disabled:opacity-50">
          Try a demo repository
        </Button>
        {!user && providers.codegraff && (
          <span>
            Private repositories:{" "}
            <a href={signIn} className="text-ink-2 underline underline-offset-2 hover:text-ink">
              sign in with Codegraff
            </a>
          </span>
        )}
        {user?.provider === "codegraff" && github?.connect && (
          <span>
            Private repositories:{" "}
            <a href={github.connect} target="_blank" rel="noreferrer" className="text-ink-2 underline underline-offset-2 hover:text-ink">
              connect GitHub on Codegraff
            </a>
          </span>
        )}
      </div>

      {focused ? user?.provider === "codegraff" && github?.connected && <details className="mt-5 border-t border-line pt-4 text-xs text-ink-2">
        <summary className="cursor-pointer py-1">Choose from your GitHub repositories</summary>
      <RepositoryPicker compact={focused} selected={input} disabled={!!busy} onSelect={(repo) => {
        setInput(repo);
        setExisting(null);
        setError(null);
      }} />
      </details> : <RepositoryPicker compact={focused} selected={input} disabled={!!busy} onSelect={(repo) => {
        setInput(repo);
        setExisting(null);
        setError(null);
      }} />}

      {focused && <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5"><p className="max-w-xs text-xs leading-5 text-muted">{user ? "Your workspace opens immediately. Source copies in the background." : "Start with a public repository. Sign in for private repositories and background copying."}</p><Button form={formId} type="submit" variant="primary" disabled={!!busy || !input.trim()}>{busy ? "Opening workspace…" : "Continue"}<ArrowRight size={14} /></Button></div>}
    </div>
  );
}
