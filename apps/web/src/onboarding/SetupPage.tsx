"use client";

import { useState } from "react";
import { Check, ArrowRight } from "lucide-react";
import { Button, Commands, Input } from "@/components/controls";
import { LinkButton } from "@/components/ui";
import { SegmentedToggleButton } from "@/components/opensourceui/segmented-toggle-button";
import { useSession, useSignInUrl } from "@/lib/session";
import { useLiveRoom, useTrunk } from "@/trunk/context";
import { ImportSummary } from "./ImportSummary";
import { FirstPrompt } from "./FirstPrompt";
import { TokenList } from "./TokenList";
import { setupFacts } from "./model";
import { usePushTokens } from "./usePushTokens";
import { cloneCommand } from "@swarm/api/connect";
import styles from "./Onboarding.module.css";

const AGENTS = ["Codex", "Claude Code", "Codegraff", "Other agent"];

export function SetupPage({
  trunk,
  origin,
}: {
  trunk: string;
  origin: string;
}) {
  const { repo, head, importJob, initialTokens } = useTrunk();
  const sourceReady = !!head || !!importJob?.ready;
  const room = useLiveRoom();
  const { user, loaded, providers } = useSession();
  const signIn = useSignInUrl();
  const credentials = usePushTokens(trunk, initialTokens);
  const [name, setName] = useState("my-agent");
  const [agentIndex, setAgentIndex] = useState(0);
  const agent = AGENTS[agentIndex];
  const promptTarget = agent === "Codegraff"
    ? "Codegraff or Harness"
    : agent === "Other agent" ? "your agent" : agent;
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const facts = setupFacts(
    room.agents.values(),
    credentials.tokens.filter((t) => t.usedAt != null).length,
  );
  const step = selectedStep ?? (facts.connected ? 2 : 1);
  const clone = credentials.made
    ? `export ROOM_TOKEN='${credentials.made.token}'\n${cloneCommand(origin, trunk, credentials.made.agent)}`
    : null;
  const hasCredential = !!credentials.made || credentials.tokens.length > 0;
  return (
    <main className={styles.main}>
      <div className={styles.backdrop} aria-hidden="true" />
      <h1 className={styles.heading}>
        {step === 0
          ? "Your repository, ready for work"
          : step === 1
            ? "Connect your agent"
            : facts.landed
              ? "Your first change is in"
              : "Make your first change"}
      </h1>
      <p className={styles.lead}>
        {step === 1
          ? "Bring your coding agent. Give it a task. Follow the work together."
          : "Work happens in this workspace. Review changes before sending them to GitHub."}
      </p>
      <nav aria-label="Setup steps">
        <ol className={styles.steps}>
          {["Repository", "Connect agent", "First change"].map(
            (label, index) => {
              const done =
                index === 0
                  ? sourceReady
                  : index === 1
                    ? facts.connected
                    : facts.landed;
              return (
                <li key={label}>
                  <button
                    type="button"
                    onClick={() => setSelectedStep(index)}
                    aria-current={step === index ? "step" : undefined}
                  >
                    <span>{done ? <Check size={12} /> : index + 1}</span>
                    {label}
                    <span className="sr-only">
                      {done ? "complete" : "pending"}
                    </span>
                  </button>
                </li>
              );
            },
          )}
        </ol>
      </nav>

      {step === 0 && (
        <section className={styles.card} aria-labelledby="repository-title">
          <h2 id="repository-title" className={styles.cardTitle}>
            {sourceReady ? "Your source is ready" : "We’re copying your source"}
          </h2>
          <p className={styles.lead}>
            {sourceReady
              ? `${repo?.fullName ?? trunk} is ready to browse and work on.`
              : "You can connect your agent and plan in the room while the copy runs. Clone instructions will appear when the source is ready."}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setSelectedStep(1)}>
              Connect an agent <ArrowRight size={14} />
            </Button>
            <LinkButton href={`/t/${trunk}${sourceReady ? "" : "/room"}`}>
              {sourceReady ? "Browse code" : "Open room"}
            </LinkButton>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className={styles.card} aria-labelledby="connect-title">
          <h2 id="connect-title" className="sr-only">Connect your agent</h2>
          <p className={styles.instruction}>Choose your coding agent</p>
          <SegmentedToggleButton
            options={AGENTS}
            valueIndex={agentIndex}
            onChange={setAgentIndex}
            aria-label="Coding agent"
            className={styles.agentChoices}
          />
          {agent === "Codegraff" && (
            <p className="mt-3 text-xs leading-6 text-muted">
              Use your agent chat in Codegraff or Harness. We’ll prepare a
              prompt with everything it needs to join this workspace.
            </p>
          )}
          <div className={styles.connection}>
            <p className={styles.instruction}>
              {credentials.made
                ? `${credentials.made.agent} is registered`
                : "Name your agent"}
            </p>
            {user ? (
              credentials.made ? (
                <p className="text-xs leading-6 text-ink-2">
                  Your private connection is ready. The instructions below
                  include its credential.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="min-w-0 flex-1 text-xs text-ink-2">
                      <span className="sr-only">Agent name</span>
                      <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={!!credentials.busy}
                        className="mt-2 w-full"
                      />
                    </label>
                    <Button
                      variant="primary"
                      onClick={() =>
                        void credentials.make(name, agent)
                      }
                      disabled={!!credentials.busy || !name.trim()}
                    >
                      {credentials.busy === "create"
                        ? "Preparing connection…"
                        : "Create agent connection"}
                      <ArrowRight size={14} />
                    </Button>
                  </div>
                  <p className="mt-3 text-xs leading-6 text-muted">
                    Private access to {trunk} for 30 days. You can revoke it anytime.
                  </p>
                  {credentials.tokens.length > 0 && (
                    <p className="mt-2 text-xs leading-6 text-ink-2">
                      Already connected? Use your saved token, or create an
                      additional connection above.
                    </p>
                  )}
                </>
              )
            ) : (
              <>
                <p className="text-sm text-ink-2">
                  Sign in to securely connect your agent.
                </p>
                {loaded && providers.codegraff && (
                  <LinkButton
                    className="mt-3"
                    href={signIn}
                    variant="primary"
                  >
                    Sign in with Codegraff
                  </LinkButton>
                )}
              </>
            )}
            {credentials.error && (
              <p role="alert" className="mt-3 text-xs text-critical">
                {credentials.error}
              </p>
            )}
          </div>
          {hasCredential && <div className={styles.connection}>
            <p className={styles.instruction}>
              Paste the instructions into{" "}
              {promptTarget}
            </p>
            {!sourceReady ? (
              <p className="text-xs leading-6 text-muted">
                Your source is still copying. Instructions will appear here when
                it’s ready. You can{" "}
                <a className="text-ink-2 underline" href={`/t/${trunk}/room`}>
                  plan your first task in the room
                </a>{" "}
                now.
              </p>
            ) : hasCredential ? (
              <FirstPrompt
                trunk={trunk}
                origin={origin}
                handle={credentials.made?.agent ?? name}
                token={credentials.made?.token}
                target={promptTarget}
              />
            ) : (
              <p className="text-xs leading-6 text-muted">
                Create the connection above to get a ready-to-paste prompt with
                repository context and access instructions.
              </p>
            )}
            {sourceReady && clone && (
              <details className="mt-5 text-xs text-muted">
                <summary className="cursor-pointer text-ink-2">
                  Or clone from your terminal
                </summary>
                <Commands className="mt-3" code={clone} />
                <p className="mt-2 leading-6">
                  The first line contains your credential. Share it only with
                  your trusted agent. The clone&apos;s URL carries only the
                  handle; git reads the token from ROOM_TOKEN and never stores it.
                </p>
              </details>
            )}
          </div>}
          <div className={styles.waiting} role="status">
            <span />
            <p>
              {facts.connected
                ? room.status === "live"
                  ? "Agent connected. You’re ready for your first change."
                  : "Agent previously connected. Reconnecting live updates…"
                : "Your agent will appear here when it connects."}
            </p>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className={styles.card} aria-labelledby="first-title">
          <h2 id="first-title" className={styles.cardTitle}>
            {facts.landed
              ? "A change has landed"
              : "Start with something small"}
          </h2>
          <p className={styles.lead}>
            {facts.landed
              ? "Open the workspace to inspect the result and review it for a GitHub pull request."
              : "Ask your agent to fix a bug or improve a small part of the project. Have it run checks, commit, and push to this workspace."}
          </p>
          <div className={styles.waiting} role="status">
            <span />
            <p>
              {facts.landed
                ? "Verified from this workspace’s agent history."
                : room.status === "live"
                  ? "Waiting for your agent’s first change…"
                  : "Reconnecting live updates…"}
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <LinkButton
              href={`/t/${trunk}/${facts.landed ? "pulls" : "room"}`}
              variant="primary"
            >
              {facts.landed ? "Review changes" : "Open agent room"}
            </LinkButton>
            <Button variant="ghost" onClick={() => setSelectedStep(1)}>
              Connection instructions
            </Button>
          </div>
        </section>
      )}
      <div className={styles.footer}>
        <LinkButton variant="ghost" size="sm" href={`/t/${trunk}/room`}>
          Go to workspace
        </LinkButton>
        {step === 1 && facts.connected && (
          <Button variant="ghost" size="sm" onClick={() => setSelectedStep(2)}>
            First change <ArrowRight size={13} />
          </Button>
        )}
      </div>
      {repo && sourceReady && (
        <details className={styles.secondary}>
          <summary>Repository details</summary>
          <ImportSummary trunk={trunk} repo={repo} />
        </details>
      )}
      {user && credentials.tokens.length > 0 && (
        <details className="mt-5 text-xs text-muted">
          <summary className="cursor-pointer">Manage agent connections</summary>
          <TokenList
            trunk={trunk}
            credentials={credentials}
            showError={step !== 1}
          />
        </details>
      )}
    </main>
  );
}
