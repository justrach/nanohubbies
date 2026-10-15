/** 1,284 · 12.9K · 4.2M */
export function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`;
  return Math.round(n).toLocaleString("en-US");
}

/** An agent's name as people read it. `x` is git's placeholder username for
 *  an unnamed pusher (`x:TOKEN`), so it reads as anonymous, not as a name. */
export function agentLabel(agent: string): string {
  return agent && agent !== "x" ? agent : "anonymous";
}

export function percent(part: number, whole: number): string {
  if (!whole) return "0%";
  const p = (100 * part) / whole;
  return `${p.toFixed(p < 10 ? 1 : 0)}%`;
}

/** Clean axis ticks from 0 up to at least `max`: 0 / 5 / 10 / 15, never 0 / 3.7 / 7.4. */
export function ticks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 172_800) return `${Math.floor(s / 3600)}h ago`;
  if (s < 5_184_000) return `${Math.floor(s / 86_400)}d ago`;
  if (s < 31_536_000) return `${Math.floor(s / 2_592_000)}mo ago`;
  return `${Math.floor(s / 31_536_000)}y ago`;
}

export function clock(at: number): string {
  return new Date(at).toLocaleTimeString("en-US", { hour12: false });
}
