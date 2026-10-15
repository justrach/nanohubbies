import { CircleCheck, CirclePause, CircleX, RotateCcw, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { compact, percent } from "@/lib/format";
import type { Totals } from "@/lib/types";
import { useSize } from "@/lib/useSize";

interface Segment {
  key: string;
  label: string;
  hint: string;
  value: number;
  color: string;
  Icon: LucideIcon;
}

/** How lives end, as one part-to-whole bar. Outcomes mean good or bad, so they
 *  wear the status colors, each with an icon and a label. */
export function LivesBar({ totals, table }: { totals: Totals; table: boolean }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const segments: Segment[] = [
    { key: "settled", label: "Settled", hint: "landed on the trunk", value: totals.landed, color: "var(--good)", Icon: CircleCheck },
    { key: "reborn", label: "Reborn", hint: "conflicted, re-planned", value: totals.conflicts, color: "var(--warning)", Icon: RotateCcw },
    { key: "unpaid", label: "Unpaid", hint: "abandoned before submitting", value: totals.unpaid, color: "var(--serious)", Icon: CirclePause },
    { key: "stillborn", label: "Stillborn", hint: "rejected as written", value: totals.rejected, color: "var(--critical)", Icon: CircleX },
  ];
  const total = segments.reduce((s, x) => s + x.value, 0);

  if (table) {
    return (
      <table className="tabular w-full text-xs">
        <thead className="text-muted">
          <tr>
            <th className="py-1 text-left font-normal">Outcome</th>
            <th className="py-1 text-right font-normal">Lives</th>
            <th className="py-1 text-right font-normal">Share</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((s) => (
            <tr key={s.key} className="border-t border-line text-ink-2">
              <td className="py-1">
                {s.label} <span className="text-muted">({s.hint})</span>
              </td>
              <td className="py-1 text-right text-ink">{s.value.toLocaleString("en-US")}</td>
              <td className="py-1 text-right">{percent(s.value, total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // Widths in px, with a 2px surface gap between neighbours; only the outer
  // ends are rounded.
  const shown = segments.filter((s) => s.value > 0);
  const gaps = Math.max(0, shown.length - 1) * 2;
  let at = 0;
  const placed = shown.map((s, i) => {
    const w = total ? Math.max(2, ((width - gaps) * s.value) / total) : 0;
    const box = { ...s, x: at, w, first: i === 0, last: i === shown.length - 1 };
    at += w + 2;
    return box;
  });

  return (
    <div>
      <div ref={ref} className="relative h-6">
        {total === 0 && <div className="h-6 rounded bg-wash" />}
        {placed.map((s) => (
          <div
            key={s.key}
            className="absolute top-0 h-6 transition-[left,width] duration-300"
            style={{
              left: s.x,
              width: s.w,
              background: s.color,
              opacity: hover && hover !== s.key ? 0.45 : 1,
              borderTopLeftRadius: s.first ? 4 : 0,
              borderBottomLeftRadius: s.first ? 4 : 0,
              borderTopRightRadius: s.last ? 4 : 0,
              borderBottomRightRadius: s.last ? 4 : 0,
            }}
            onPointerEnter={() => setHover(s.key)}
            onPointerLeave={() => setHover(null)}
            title={`${s.label}: ${s.value.toLocaleString("en-US")} (${percent(s.value, total)})`}
          />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        {segments.map(({ key, label, hint, value, color, Icon }) => (
          <li key={key} className="flex items-start gap-2" onPointerEnter={() => setHover(key)} onPointerLeave={() => setHover(null)}>
            <Icon size={16} strokeWidth={2.25} style={{ color }} className="mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="text-xs text-ink">
                {label} <span className="font-semibold">{compact(value)}</span> <span className="text-muted">{percent(value, total)}</span>
              </p>
              <p className="truncate text-[11px] text-muted">{hint}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
