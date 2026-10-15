"use client";

import { Check, ChevronRight, X } from "lucide-react";
import { useRef, useState } from "react";
import { LinkButton } from "@/components/ui";
import { useLiveRoom, useTrunk } from "@/trunk/context";
import { setupFacts } from "./model";
import styles from "./GettingStarted.module.css";

/** A persistent checklist beside the work. Native dialog provides focus
 * containment, Escape, and focus restoration without a dialog bundle. */
export function GettingStarted() {
  const { trunk, head, importJob, initialTokens } = useTrunk();
  const room = useLiveRoom();
  const facts = setupFacts(
    room.agents.values(),
    initialTokens.tokens.filter((token) => token.usedAt != null).length,
  );
  const ready = !!head || !!importJob?.ready;
  const completed =
    Number(ready) + Number(facts.connected) + Number(facts.landed);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => dialog.current?.close();
  const steps = [
    {
      title: "Bring your repository",
      done: ready,
      body: ready
        ? "Your source is ready to browse, clone, and work on."
        : "The copy runs in the background. You can start planning now.",
      href: ready ? `/t/${trunk}` : `/t/${trunk}/room`,
      action: ready ? "Browse source" : "Open the room",
    },
    {
      title: "Connect your coding agent",
      done: facts.connected,
      body: facts.connected
        ? "We’ve observed your agent using this workspace."
        : "Choose your agent, create its private connection, and paste the setup prompt into your coding tool.",
      href: `/t/${trunk}/setup`,
      action: facts.connected ? "Connection instructions" : "Connect an agent",
    },
    {
      title: "Make your first change",
      done: facts.landed,
      body: facts.landed
        ? "Your agent has landed a change. Review it before sending it to GitHub."
        : "Give your agent a small task. Ask it to run checks, commit, and push its change here.",
      href: `/t/${trunk}/${facts.landed ? "pulls" : "room"}`,
      action: facts.landed ? "Review changes" : "Plan a task",
    },
  ];
  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Getting started, ${completed} of 3 steps complete`}
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        <span>Getting started</span>
        <span className={styles.meter} aria-hidden>
          {[0, 1, 2].map((n) => (
            <i key={n} data-done={n < completed} />
          ))}
        </span>
      </button>
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby="getting-started-title"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className={styles.panel}>
          <header>
            <div>
              <h2 id="getting-started-title">Getting started</h2>
              <p>
                {completed} of 3 complete · {trunk}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close getting started"
            >
              <X size={18} />
            </button>
          </header>
          <ol>
            {steps.map((step, index) => (
              <li key={step.title}>
                <span className={styles.number}>
                  {step.done ? (
                    <Check size={13} aria-label="Complete" />
                  ) : (
                    index + 1
                  )}
                </span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <div onClick={close}>
                    <LinkButton
                      href={step.href}
                      size="sm"
                      variant={
                        index === 1 && !facts.connected
                          ? "primary"
                          : "secondary"
                      }
                    >
                      {step.action}
                      <ChevronRight size={12} />
                    </LinkButton>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <p className={styles.note}>
            Progress updates from actual agent activity. Copying instructions
            alone doesn’t complete a step.
          </p>
        </div>
      </dialog>
    </>
  );
}
