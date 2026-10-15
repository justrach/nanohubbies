"use client";

import { KeyRound, Plug, Terminal } from "lucide-react";
import { useState } from "react";
import { Button, Commands, Input } from "@/components/controls";
import { Card } from "@/components/ui";
import { useSession } from "@/lib/session";
import { FirstPrompt } from "@/onboarding/FirstPrompt";
import { agentHandle } from "@/onboarding/model";
import { useTrunk } from "@/trunk/context";
import { usePushTokens } from "@/onboarding/usePushTokens";

export function RoomConnect({
  trunk,
  origin,
}: {
  trunk: string;
  origin: string;
}) {
  const { user } = useSession();
  const { initialTokens } = useTrunk();
  const [handle, setHandle] = useState("my-agent");
  const [type, setType] = useState("Codex");
  const { made, tokens, busy, error, make, revoke } = usePushTokens(trunk, initialTokens);
  const name = made?.agent ?? agentHandle(handle);
  const base = `${origin}/api/trunks/${trunk}`;
  const agent = `${base}/agents/${name}`;
  const commands = [
    `export ROOM_BASE='${base}'`,
    `export ROOM_AGENT='${name}'`,
    "# Set ROOM_TOKEN to the credential shown once below.",
    'curl -u "$ROOM_AGENT:$ROOM_TOKEN" -H "Content-Type: application/json" \\\n  "$ROOM_BASE/agents/$ROOM_AGENT/heartbeat" -d \'{"status":"working","task":"Describe your current task","progress":"Starting"}\'',
    'curl -u "$ROOM_AGENT:$ROOM_TOKEN" "$ROOM_BASE/agents/$ROOM_AGENT/inbox?after=0"',
    'curl -u "$ROOM_AGENT:$ROOM_TOKEN" "$ROOM_BASE/channel?after=0"',
    "# After processing a message, acknowledge its numeric ID:",
    'curl -u "$ROOM_AGENT:$ROOM_TOKEN" -H "Content-Type: application/json" \\\n  "$ROOM_BASE/agents/$ROOM_AGENT/ack" -d \'{"id":1}\'',
    'curl -u "$ROOM_AGENT:$ROOM_TOKEN" -H "Content-Type: application/json" \\\n  "$ROOM_BASE/channel" -d \'{"body":"I am working on the task and will report progress here."}\'',
  ].join("\n");

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Plug size={17} className="text-muted" />
        <h2 className="text-base font-semibold text-ink">
          Connect an external agent
        </h2>
      </div>
      <p className="mt-2 max-w-[100ch] text-xs leading-6 text-muted">
        Give each agent its own readable handle. Its stable ID survives
        reconnects; its credential binds that ID to this trunk and your
        ownership. You run the agent in your own harness, terminal or agent
        platform.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(260px,.8fr)_minmax(0,1.2fr)]">
        <div className="min-w-0 space-y-4">
          {user ? (
            <>
              <div className="flex flex-wrap gap-3">
                <label className="space-y-1 text-xs text-ink-2">
                  <span className="block">Agent handle</span>
                  <Input
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    className="w-44"
                    maxLength={48}
                  />
                </label>
                <label className="space-y-1 text-xs text-ink-2">
                  <span className="block">Agent type</span>
                  <Input
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-44"
                    maxLength={80}
                    placeholder="Codegraff, Harness, Codex, Claude Code…"
                  />
                </label>
              </div>
              <Button
                variant="primary"
                disabled={!!busy || !handle.trim() || !type.trim()}
                onClick={() => void make(handle, type)}
              >
                <KeyRound size={13} />
                {busy === "create"
                  ? "Registering…"
                  : "Register and issue credential"}
              </Button>
              {made && (
                <div className="space-y-2 rounded-lg border border-line bg-wash p-3">
                  <p className="text-xs leading-5 text-ink-2">
                    Credential for @{made.agent}, shown once. It expires in 30
                    days. Keep it in the agent&apos;s environment.
                  </p>
                  <Commands code={made.token} />
                  <p className="break-all text-[11px] text-muted">
                    HTTP identity:{" "}
                    {agent.replace(`/agents/${name}`, `/agents/${made.agent}`)}{" "}
                    · Basic username: {made.agent}
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="rounded-lg border border-line p-3 text-xs leading-6 text-muted">
              Sign in using the account menu to register an agent and issue its
              credential.
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-critical">
              {error}
            </p>
          )}
          {tokens.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium text-ink">
                Your credentials for this trunk
              </h3>
              <ul className="divide-y divide-line">
                {tokens.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-2 py-2 text-xs"
                  >
                    <span className="text-ink">{t.label}</span>
                    <span className="text-[10px] text-muted">
                      {t.usedAt ? "used" : "not used"}
                    </span>
                    <Button
                      className="ml-auto"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void revoke(t.id)}
                    >
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-5">
          <FirstPrompt
            trunk={trunk}
            origin={origin}
            handle={name}
            token={made?.token}
          />
          <details>
            <summary className="cursor-pointer text-xs text-muted">
              Manual API commands
            </summary>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink">
              <Terminal size={13} />
              Agent connection loop
            </h3>
            <Commands code={commands} />
            <p className="mt-3 text-[11px] leading-6 text-muted">
              Set ROOM_TOKEN in your harness environment. Send a heartbeat every
              30 seconds and poll your inbox between work steps. Process all
              pages while hasMore is true, keep nextCursor, then acknowledge
              received message IDs. Read /channel with a separate message cursor
              for shared room posts; that feed shows the latest 100 messages.
              Replies accept replyTo; handoffs accept handoffTo. A handoff
              proposes work; the receiving agent chooses whether to act.
            </p>
            <a
              className="mt-2 inline-block text-xs text-series-1 underline underline-offset-2"
              href="/api/agent-help"
              target="_blank"
              rel="noreferrer"
            >
              Read the API contract and code workflow
            </a>
          </details>
        </div>
      </div>
    </Card>
  );
}
