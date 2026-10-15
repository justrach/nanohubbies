"use client";

import { Bot, ChevronDown, MessageSquare, Plus, Radio, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { LinkButton } from "@/components/ui";
import { AnimatedCounter } from "@/components/rareui/animated-counter";
import { ago } from "@/lib/format";
import { useLiveRoom } from "../context";
import { RoomConversation } from "./RoomConversation";
import { TeamAccess } from "./TeamAccess";
import { RoomConnect } from "./RoomConnect";
import styles from "./Room.module.css";

export function AgentRoom({ trunk, origin }: { trunk: string; origin: string }) {
  const room = useLiveRoom();
  const [recipient, setRecipient] = useState("");
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);
  const recent = (at: number | null) => !!at && now > 0 && now + room.skew - at < 90_000;
  const connected = room.roster.filter((a) => a.status !== "offline" && recent(a.heartbeatAt)).length;
  const setup = `/t/${encodeURIComponent(trunk)}/setup`;

  return (
    <main className={styles.page}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}><MessageSquare size={13} /> WORKSPACE / ROOM</p>
          <h1>Work together, in one room.</h1>
          <p className={styles.description}>Share the next step. Follow your agents. Keep the context together.</p>
        </div>
        <LinkButton href={setup} variant="primary"><Plus size={14} />Connect an agent</LinkButton>
      </header>
      <div className={styles.layout}>
        <RoomConversation trunk={trunk} recipient={recipient} onRecipient={setRecipient} />
        <aside className={styles.sidebar} aria-label="Agents in this room">
          <div className={styles.rosterHeading}><h2><Users size={15} />Agents</h2><span className={styles.count}>{room.roster.length}</span></div>
          <div className={styles.presence}>
            <span className={styles.presenceDot} data-live={connected > 0} />
            <AnimatedCounter value={connected} duration={0.35} />
            <span>online</span><span className={styles.watchers}>{room.watchers.length} watching</span>
          </div>
          {room.roster.length === 0 ? (
            <div className={styles.rosterEmpty}>
              <div className={styles.agentIcon}><Bot size={22} /></div>
              <h3>Your team starts here</h3>
              <p>Connect Codegraff, Harness, Codex, Claude Code or your own agent.</p>
              <LinkButton href={setup} size="sm"><Plus size={13} />Add your first agent</LinkButton>
            </div>
          ) : (
            <ul className={styles.agents}>
              {room.roster.map((a) => {
                const live = recent(a.heartbeatAt) && a.status !== "offline";
                return (
                  <li key={a.id}>
                    <button className={styles.agent} data-selected={recipient === a.handle} onClick={() => setRecipient(a.handle)} title={`Message @${a.handle}`}>
                      <span className={styles.agentAvatar}><Bot size={17} /><i data-live={live} /></span>
                      <span className={styles.agentName}><strong>@{a.handle}</strong><small>{a.type}</small></span>
                      <span className={styles.agentState}>{live ? a.status : !a.heartbeatAt ? "Not connected" : "Offline"}</span>
                    </button>
                    <div className={styles.agentDetail}>
                      <p>{a.task || "No task reported yet"}</p>
                      {a.progress && <p className={styles.progress}>{a.progress}</p>}
                      <span title={`Agent ID: ${a.id} · Owner: ${a.owner.name}`}><Radio size={10} />{a.heartbeatAt ? `Last seen ${ago(Math.max(0, now + room.skew - a.heartbeatAt))}` : "Waiting for first connection"}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className={styles.roomTip}><h3>A shared conversation</h3><p>Messages stay in this room. Choose an agent to deliver a message to its inbox.</p><p>Agents run in your harness; sending a message doesn’t start them.</p></div>
        </aside>
      </div>
      <details className={styles.settings}>
        <summary><span>Agent credentials & workspace access</span><ChevronDown size={15} /></summary>
        <div className={styles.settingsBody}><RoomConnect trunk={trunk} origin={origin} /><TeamAccess trunk={trunk} /></div>
      </details>
    </main>
  );
}
