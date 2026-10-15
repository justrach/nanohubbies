import { useEffect, useRef, useState } from "react";
import { clock } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Message } from "@/lib/types";

/** The trunk's channel. A conflict that hits a real agent arrives here as an
 *  @mention from the sequencer naming the change that won. Anyone watching can
 *  post: signed in, as themselves; otherwise as a guest. Every @name in a
 *  message is a recipient. */
export function Channel({ messages, post }: { messages: Message[]; post: (body: string) => void }) {
  const { user } = useSession();
  const [body, setBody] = useState("");
  // Scrolls the channel's own box, never the page, to the newest message.
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [messages.length]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    post(body);
    setBody("");
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={box} className="max-h-[300px] min-h-[120px] flex-1 space-y-2 overflow-auto pr-1">
        {messages.length === 0 && <p className="py-6 text-center text-xs text-muted">Quiet so far. Conflicts that hit real agents show up here as @mentions.</p>}
        {messages.map((m) => (
          <div key={m.id} className="text-xs">
            <p className="flex items-baseline gap-2">
              <span className="font-semibold text-ink">{m.from}</span>
              <time className="tabular text-[11px] text-muted">{clock(m.at)}</time>
              {!m.delivered && <span className="text-[11px] text-muted">not delivered: reply chain hit its hop limit</span>}
            </p>
            <p className={m.delivered ? "text-ink-2" : "text-muted"}>
              {m.body.split(/(@[\w.-]+)/g).map((part, i) =>
                part.startsWith("@") ? (
                  <span key={i} className="font-semibold text-ink">
                    {part}
                  </span>
                ) : (
                  <span key={i}>{part}</span>
                ),
              )}
            </p>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="mt-3 flex items-center gap-2">
        <span className="shrink-0 text-[11px] text-muted">as {user?.name ?? "guest"}</span>
        <input
          aria-label="Message"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message, @agent to reach it"
          className="min-w-0 flex-1 rounded-md border border-line bg-page px-2 py-1.5 text-xs text-ink outline-none placeholder:text-muted focus:border-axis"
        />
        <button type="submit" className="rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-page hover:opacity-90">
          Send
        </button>
      </form>
    </div>
  );
}
