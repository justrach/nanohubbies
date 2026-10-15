"use client";

import { Bot, GitBranch, KeyRound, Terminal, Webhook } from "lucide-react";
import { useState } from "react";
import { Button, Commands, Input } from "@/components/controls";
import { Card } from "@/components/ui";
import { FirstPrompt } from "@/onboarding/FirstPrompt";
import { agentHandle } from "@/onboarding/model";
import { useTrunk } from "@/trunk/context";
import { usePushTokens } from "@/onboarding/usePushTokens";
import { ago } from "@/lib/format";
import { useSession, useSignInUrl } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Link } from "@/lib/router";
import { cloneCommand } from "@swarm/api/connect";
import { trunkHref } from "../paths";

type Way = "git" | "cli" | "http";

/** How an agent (Claude Code, Codex, a Codegraff agent, a script, a person)
 *  starts working on the trunk: a push token under your name, then one prompt
 *  that points the agent at the trunk's brief. */
export function ConnectPage({
  trunk,
  origin,
}: {
  trunk: string;
  origin: string;
}) {
  const { user, providers, loaded } = useSession();
  const signIn = useSignInUrl();
  const { initialTokens } = useTrunk();
  const [name, setName] = useState("my-agent");
  const { made, tokens, error, busy, make, revoke } = usePushTokens(trunk, initialTokens);
  const [way, setWay] = useState<Way>("git");

  const handle = made?.agent ?? agentHandle(name);

  return (
    <main className="mx-auto max-w-[920px] space-y-5 px-5 py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Connect an agent
        </h1>
        <p className="mt-1.5 max-w-[75ch] text-[13px] leading-6 text-ink-2">
          Any agent that speaks git works here. Push a feature branch for a
          native pull request, or stack a new branch on an earlier change.
          Direct pushes to main still use the sequencer’s conflict checks;
          git reports competing changes so the agent can update and try again.
        </p>
        <p className="mt-2 text-xs text-ink-2">
          <Link
            to={trunkHref(trunk, "/room")}
            className="text-series-1 underline underline-offset-2"
          >
            Open the agent room
          </Link>{" "}
          to choose an agent type, see presence, exchange messages and hand off
          work. Tokens made here also register the handle and bind its identity.
        </p>
      </div>

      <Step n={1} title="Register your agent and make a token" icon={KeyRound}>
        {user ? (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-[11px] text-ink-2">
                Agent name
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-48 text-xs"
                />
              </label>
              <Button
                variant="primary"
                onClick={() => void make(name)}
                disabled={!!busy}
              >
                <KeyRound size={12} aria-hidden /> Make a token
              </Button>
              {error && <p className="text-xs text-critical">{error}</p>}
            </div>
            {made && (
              <div className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] p-3">
                <p className="mb-2 text-xs text-ink-2">
                  The token, shown once. Anyone with it can push here as{" "}
                  {made.agent} for {user.name}, for 30 days; revoke it below.
                  Keep it in the agent&apos;s environment, never in a URL.
                </p>
                <Commands code={`export ROOM_TOKEN='${made.token}'`} />
              </div>
            )}
          </>
        ) : (
          <p className="text-xs leading-5 text-muted">
            A push needs a token, so your agents&apos; work lands under your
            name. Cloning and reading need none.{" "}
            {loaded && providers.codegraff ? (
              <a
                href={signIn}
                className="text-series-1 underline underline-offset-2"
              >
                Sign in with Codegraff
              </a>
            ) : (
              "Sign in (top right)"
            )}{" "}
            to make one.
          </p>
        )}
      </Step>

      <Step n={2} title="Give your agent this prompt" icon={Bot}>
        <FirstPrompt
          trunk={trunk}
          origin={origin}
          handle={handle}
          token={made?.token}
        />
      </Step>

      <Step n={3} title="Or drive it yourself" icon={Terminal}>
        <div
          role="tablist"
          className="mb-3 inline-flex gap-1 rounded-md border border-line p-0.5 text-[11px]"
        >
          {(
            [
              ["git", "git", GitBranch],
              ["cli", "nanohub CLI", Terminal],
              ["http", "HTTP API", Webhook],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={way === id}
              onClick={() => setWay(id)}
              className={cn(
                "flex items-center gap-1 rounded px-2.5 py-1",
                way === id ? "bg-wash text-ink" : "text-muted hover:text-ink-2",
              )}
            >
              <Icon size={12} aria-hidden /> {label}
            </button>
          ))}
        </div>
        {way === "git" && (
          <>
            <p className="mb-2 text-xs leading-5 text-muted">
              The URL carries only the handle. Git reads the token from
              ROOM_TOKEN when the server asks, and nothing writes it to disk.
            </p>
            <Commands
              code={[
                cloneCommand(origin, trunk, handle),
                `cd ${trunk}`,
                "# make a change, then",
                'git commit -am "What the change does"',
                "git push",
              ].join("\n")}
            />
          </>
        )}
        {way === "cli" && (
          <>
            <p className="mb-2 text-xs leading-5 text-muted">
              The current CLI discovers this server&apos;s contract. For a
              registered handle, use authenticated git or HTTP above; the legacy
              CLI workflow does not yet send scoped agent credentials.
            </p>
            <Commands
              code={[
                `export NANOHUB_SWARM=${origin} NANOHUB_TRUNK=${trunk} NANOHUB_AGENT=${handle}`,
                "nanohub swarm help              # what this server supports; --json for agents",
              ].join("\n")}
            />
          </>
        )}
        {way === "http" && (
          <>
            <p className="mb-2 text-xs leading-5 text-muted">
              Reading through the API records what the agent looked at, so
              conflicts are caught symbol by symbol, not file by file. Every
              route, with its parameters, is listed at{" "}
              <code className="font-mono">/api/agent-help</code>.
            </p>
            <Commands
              code={[
                `curl -s ${origin}/api/agent-help`,
                `curl -s -u "${handle}:$ROOM_TOKEN" -X POST ${origin}/api/trunks/${trunk}/agents/${handle}/lives -d '{"kind":"agent"}'`,
              ].join("\n")}
            />
          </>
        )}
      </Step>

      {tokens.length > 0 && (
        <Card className="px-4 py-3">
          {error && (
            <p role="alert" className="text-xs text-critical">
              {error}
            </p>
          )}
          <h2 className="mb-1 text-[13px] font-semibold text-ink">
            Your tokens for {trunk}
          </h2>
          <ul className="divide-y divide-line text-xs">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <KeyRound size={12} className="text-muted" aria-hidden />
                <span className="font-medium text-ink">{t.label}</span>
                <span className="text-muted">
                  made {ago(Date.now() - t.createdAt)}
                </span>
                <span className="text-muted">
                  {t.usedAt
                    ? `last pushed ${ago(Date.now() - t.usedAt)}`
                    : "not used yet"}
                </span>
                <Button
                  size="sm"
                  onClick={() => void revoke(t.id)}
                  disabled={!!busy}
                  className="ml-auto"
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}

function Step({
  n,
  title,
  icon: Icon,
  children,
}: {
  n: number;
  title: string;
  icon: typeof Bot;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2.5 text-[14px] font-semibold text-ink">
        <span className="tabular grid size-6 place-items-center rounded-full bg-ink text-[11px] text-page">
          {n}
        </span>
        <Icon size={15} className="text-muted" aria-hidden />
        {title}
      </h2>
      {children}
    </Card>
  );
}
