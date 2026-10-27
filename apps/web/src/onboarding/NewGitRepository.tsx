"use client";
import { useState, useEffect } from "react";
import { Button, Input } from "@/components/controls";
import { api, trunkPath } from "@/lib/api";
import { useSession, useSignInUrl } from "@/lib/session";
import { LinkButton } from "@/components/ui";
import { OneTimeToken } from "@/components/OneTimeToken";
import {firstPushCommand} from "@swarm/api/connect";

/** Empty repositories can be configured before their first Git push. */
export function NewGitRepository({ existing, primary=false,initialDefaultBranch }: { existing?: string; primary?: boolean;initialDefaultBranch?:string }) {
  const {user,providers}=useSession(),signIn=useSignInUrl();
  const [owner, setOwner] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [defaultBranch,setDefaultBranch]=useState(initialDefaultBranch??"main"),[defaultKnown,setDefaultKnown]=useState(!existing||!!initialDefaultBranch);
  useEffect(() => {
    if (existing)
      void api<{ namespace: string; name: string }>(
        `/api/repository-addresses/${existing}`,
      )
        .then((a) =>
          setCloneUrl(
            `${window.location.origin}/git/${a.namespace}/${a.name}.git`,
          ),
        )
        .catch(() => {});
  }, [existing]);
  useEffect(() => {
    void api<{ namespace: { name: string } | null }>("/api/namespaces")
      .then((r) => setOwner(r.namespace?.name ?? ""))
      .catch(() => {});
  }, []);
  const [name, setName] = useState(existing ?? "");
  const [created, setCreated] = useState<string | null>(existing ?? null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(()=>{let current=true;if(existing)void api<{defaultBranch:string}>(`${trunkPath(existing)}/default-branch`).then(value=>{if(current){setDefaultBranch(value.defaultBranch);setDefaultKnown(true);}}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[existing]);
  async function create() {
    setBusy(true);
    setError(null);
    try {
      let trunk = created ?? name;
      if (!created) {
        await api("/api/namespaces", { body: { name: owner } });
        const repo = await api<{ id: string; cloneUrl: string }>(
          `/api/repos/${owner}/${name}`,
          { body: {defaultBranch} },
        );
        trunk = repo.id;
        setCreated(trunk);
        setCloneUrl(repo.cloneUrl);
        return;
      }
      const credential = await api<{ token: string }>(
        `${trunkPath(trunk)}/git-tokens`,
        { body: {label:"Initial Git access"} },
      );
      setToken(credential.token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if(!user)return <div className="space-y-3 text-sm"><p>Sign in to create a private repository.</p><LinkButton href={providers.codegraff?signIn:"/dashboard"}>Sign in</LinkButton></div>;
  return (
    <details
      open={!!existing||primary}
      className={primary?"text-sm text-ink-2":"mt-6 border-t border-line pt-4 text-sm text-ink-2"}
    >
      <summary className="cursor-pointer">
        {existing
          ? "Set up Git access"
          : "New private repository"}
      </summary>
      <p className="my-3 text-xs leading-5 text-muted">
        Keep your complete history, branches, tags and binary assets. The
        repository starts private. Import committed code with the migration
        tool, or push the initial branch from an existing repository.
      </p>
      {!token && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          {!existing && !created && (
            <label className="min-w-40 flex-1 text-xs text-muted">Owner handle<Input className="mt-1 w-full"
              aria-label="Owner handle"
              value={owner}
              disabled={busy}
              onChange={(e) => setOwner(e.target.value)}
              pattern="[a-z0-9][a-z0-9-]{0,38}"
              placeholder="your-handle"
              required
            /></label>
          )}
          <label className="min-w-44 flex-1 text-xs text-muted">Repository name<Input className="mt-1 w-full"
            aria-label="Repository name"
            value={name}
            disabled={busy || !!created}
            onChange={(e) => setName(e.target.value)}
            pattern="[a-z0-9][a-z0-9._-]{0,99}"
            placeholder="my-repository"
            required
          /></label>
          {!existing&&!created&&<label className="min-w-44 flex-1 text-xs text-muted">Initial default branch<Input className="mt-1 w-full" value={defaultBranch} onChange={event=>setDefaultBranch(event.target.value)} maxLength={244} disabled={busy} required/></label>}
          <Button type="submit" variant="primary" disabled={busy||!defaultKnown}>
            {busy
              ? "Creating…"
              : created
                ? "Create Git token"
                : "Create private repository"}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-critical">
          {error}
        </p>
      )}
      {created&&!token&&<p className="mt-4 text-xs leading-6 text-muted">Your repository is ready. <a className="text-series-1 underline" href={`/t/${created}`}>Open the repository</a> or create a Git token above when you’re ready to push.</p>}
      {token && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-muted">
            Save this credential now; it is shown only here. Set it as{" "}
            <code>NANOHUB_TOKEN</code> in your shell. Revoke it from your
            account when you no longer need it.
          </p>
          <OneTimeToken value={token}/>
          <pre className="overflow-x-auto rounded border border-line p-3 text-xs">{`git remote add origin ${cloneUrl || `${window.location.origin}/git/${created}.git`}\n${firstPushCommand(defaultBranch)}`}</pre>
          <p className="text-xs leading-6 text-muted">Use your username and the token as Git’s password. Any Git client works; no agent connection is required.</p>
          <details className="text-xs"><summary className="cursor-pointer">Migrate full history from another Git host</summary><pre className="mt-2 overflow-x-auto rounded border border-line p-3">{`bun tools/migrate-repository.mjs /path/to/source ${cloneUrl || `${window.location.origin}/git/${created}.git`} git`}</pre></details>
          <p className="text-xs text-muted">
            The migration tool verifies a fresh clone, object IDs, refs and file
            modes with git fsck. Uncommitted work stays in your source checkout.
            After your first push,{" "}
            <a className="underline" href={`/t/${created}`}>
              open your repository
            </a>
            .
          </p>
        </div>
      )}
    </details>
  );
}
