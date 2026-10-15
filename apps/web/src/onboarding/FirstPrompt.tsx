"use client";

import { useState } from "react";
import { CopyButton } from "@/components/controls";
import { useLiveRoom, useTrunk } from "@/trunk/context";
import { agentPrompt } from "./agent-prompt";

export function FirstPrompt({
  trunk,
  origin,
  handle,
  token,
  target = "your coding agent",
}: {
  trunk: string;
  origin: string;
  handle: string;
  token?: string;
  target?: string;
}) {
  const room = useLiveRoom();
  const { repo } = useTrunk();
  const [task, setTask] = useState("");
  const prompt = agentPrompt({
    trunk,
    origin,
    handle,
    token,
    task,
    source: repo?.fullName,
    roster: room.roster,
    now: Date.now() + room.skew,
    live: room.status === "live",
  });
  return (
    <section className="min-w-0 space-y-3" aria-label="Agent first prompt">
      <div>
        <h3 className="text-sm font-semibold text-ink">
          Your first task
        </h3>
        <p className="mt-1 text-xs leading-6 text-muted">
          Add a task, copy the prompt, and paste it into {target}.
          It includes the repository and connection instructions.
        </p>
      </div>
      <label className="block text-xs text-ink-2">
        What should this agent do?{" "}
        <span className="text-muted">(optional)</span>
        <textarea
          className="mt-2 block w-full rounded-lg border border-line bg-page p-3 text-sm text-ink"
          rows={2}
          maxLength={2000}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="For example: find and fix a small bug, run the tests, and explain the change."
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <CopyButton text={prompt} label="Copy first prompt" variant="primary" />
        <span className="text-xs text-muted">
          {room.roster.length} registered agents in context
        </span>
      </div>
      <p className="text-xs leading-5 text-muted">
        {token
          ? "Includes the credential you just created. Paste only into your trusted agent session."
          : "Uses ROOM_TOKEN from your agent’s environment. Create a credential above for a prompt with credentials included, or use an existing registered identity and token."}
      </p>
      <details className="rounded-lg border border-line">
        <summary className="cursor-pointer px-3 py-2 text-xs text-ink-2">
          Preview first prompt
        </summary>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words border-t border-line p-3 text-xs leading-6 text-ink-2">
          {prompt}
        </pre>
      </details>
    </section>
  );
}
