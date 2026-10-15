"use client";

import { ArrowRight, CornerDownRight, MessageSquare, Send, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/controls";
import { SelectFieldInput } from "@/components/opensourceui/select-field-input";
import { TextareaFieldInput } from "@/components/opensourceui/textarea-field-input";
import { SegmentedToggleButton } from "@/components/opensourceui/segmented-toggle-button";
import styles from "./Room.module.css";
import { api, trunkPath } from "@/lib/api";
import { clock } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLiveRoom } from "../context";

export function RoomConversation({
  trunk,
  recipient,
  onRecipient,
}: {
  trunk: string;
  recipient: string;
  onRecipient: (handle: string) => void;
}) {
  const room = useLiveRoom();
  const { user } = useSession();
  const composer = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [handoff, setHandoff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || busy || (handoff && !recipient)) return;
    setBusy(true);
    setError("");
    try {
      await api(`${trunkPath(trunk)}/channel`, {
        body: {
          from: "guest",
          body: `${recipient ? `@${recipient} ` : ""}${body.trim()}`,
          ...(replyTo ? { replyTo } : {}),
          ...(handoff && recipient ? { handoffTo: recipient } : {}),
        },
      });
      setBody("");
      setReplyTo(null);
      setHandoff(false);
      onRecipient("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.conversation} aria-label="Room conversation">
      <header className={styles.conversationHeader}>
        <div><MessageSquare size={16} /><h2>Conversation</h2><span className={styles.count}>{room.messages.length}</span></div>
        <span className={styles.connection} data-live={room.status === "live"}><i />{room.status === "live" ? "Live" : room.status === "connecting" ? "Connecting" : "Reconnecting"}</span>
      </header>
      <div aria-live="polite" className={styles.messages}>
        {room.messages.length === 0 && (
          <div className={styles.emptyConversation}>
            <div className={styles.conversationIcon}><MessageSquare size={24} /></div>
            <h3>Start with the next step</h3>
            <p>A goal, a question, a little context.<br />Give everyone a place to pick up the work.</p>
            <div className={styles.starters}>
              {["Share a goal", "Ask for an update"].map((label, index) => <button key={label} type="button" onClick={() => {
                setBody(index === 0 ? "Our next goal is " : "What are you working on, and is anything blocked?");
                composer.current?.focus();
              }}>{label}<ArrowRight size={12} /></button>)}
            </div>
          </div>
        )}
        {room.messages.map((m) => (
          <article key={m.id} className={styles.message}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <strong className="text-ink">
                {m.from.startsWith("person:") ? m.from.slice(7) : m.from}
              </strong>
              <span className="text-[10px] text-muted">
                {m.from.startsWith("person:")
                  ? "person"
                  : m.from === "sequencer"
                    ? "system"
                    : "agent / guest"}
              </span>
              <time className="ml-auto text-[11px] text-muted">
                {clock(m.at)}
              </time>
              <span className="font-mono text-[10px] text-muted">#{m.id}</span>
            </div>
            {m.replyTo && (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-muted">
                <CornerDownRight size={12} />
                Reply to #{m.replyTo}
              </p>
            )}
            {m.handoffTo && (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-series-1">
                <ArrowRight size={12} />
                Handoff to @{m.handoffTo}
              </p>
            )}
            <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-6 text-ink-2">
              {m.body.split(/(@[\w.-]+)/g).map((part, i) => (
                <span
                  key={i}
                  className={
                    part.startsWith("@")
                      ? "font-medium text-series-1"
                      : undefined
                  }
                >
                  {part}
                </span>
              ))}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-muted">
              <button
                className="hover:text-ink"
                onClick={() => {
                  setReplyTo(m.id);
                  if (room.roster.some((a) => a.handle === m.from))
                    onRecipient(m.from);
                }}
              >
                Reply
              </button>
              {!m.delivered ? (
                <span>Inbox routing paused: reply chain limit</span>
              ) : m.to.length > 0 ? (
                <span>
                  {m.to
                    .map((handle) =>
                      m.acknowledgements?.some((a) => a.agent === handle)
                        ? `@${handle} acknowledged`
                        : `@${handle} awaiting receipt`,
                    )
                    .join(" · ")}
                </span>
              ) : (
                <span>Room message</span>
              )}
            </div>
          </article>
        ))}
      </div>
      <form
        onSubmit={(e) => void send(e)}
        className={styles.composer}
      >
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <SelectFieldInput
            label="Send to"
            aria-label="Message recipient"
            value={recipient}
            onValueChange={onRecipient}
            options={[{ value: "", label: "Everyone in the room" }, ...room.roster.map((a) => ({ value: a.handle, label: `@${a.handle}` }))]}
            containerClassName={styles.recipient}
            className="h-9 text-xs"
          />
          <SegmentedToggleButton
            aria-label="Message type"
            options={["Message", "Handoff"]}
            valueIndex={handoff ? 1 : 0}
            onChange={(index) => setHandoff(index === 1)}
            className="text-xs"
          />
          {replyTo && (
            <span className="flex items-center gap-1 text-muted">
              Reply to #{replyTo}
              <button
                type="button"
                aria-label="Cancel reply"
                onClick={() => setReplyTo(null)}
              >
                <X size={12} />
              </button>
            </span>
          )}
        </div>
        <TextareaFieldInput
          ref={composer}
          label={handoff ? "What needs to happen next?" : "Message"}
          aria-label="Room message"
          maxLength={3900}
          rows={3}
          value={body}
          onChange={setBody}
          placeholder="Share an update or leave the next step…"
          containerClassName="max-w-none"
          className="resize-none text-[13px]"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {handoff && !recipient && <p className={styles.composerHint}>Choose an agent above to hand off work.</p>}
        {error && (
          <p role="alert" className="text-xs text-critical">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted">
            {user?.name ?? "Guest"}<span className="mx-2">·</span>⌘ / Ctrl + Enter to send
          </p>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !body.trim() || (handoff && !recipient)}
          >
            <Send size={13} />
            {busy ? "Sending…" : handoff ? "Send handoff" : "Send message"}
          </Button>
        </div>
      </form>
    </section>
  );
}
