// Small marks shared by the pull request and trunk pages, with no state, so
// they render on the server too.

const STATUS: Record<string, { letter: string; label: string; color: string }> = {
  added: { letter: "A", label: "Added", color: "var(--good)" },
  removed: { letter: "D", label: "Deleted", color: "var(--critical)" },
  renamed: { letter: "R", label: "Renamed", color: "var(--series-1)" },
  copied: { letter: "C", label: "Copied", color: "var(--series-1)" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { letter: "M", label: "Modified", color: "var(--warning)" };
  return (
    <span
      title={s.label}
      className="grid size-[18px] shrink-0 place-items-center rounded font-mono text-[10px] font-bold"
      style={{ color: s.color, background: `color-mix(in srgb, ${s.color} 16%, transparent)` }}
    >
      {s.letter}
    </span>
  );
}

/** "+369 −12" and five blocks split between the two, as people know from GitHub. */
export function DiffCount({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  const green = total ? Math.round((5 * additions) / total) : 0;
  return (
    <span className="tabular flex items-center gap-1.5 font-mono text-[11.5px]">
      <span className="text-good-text">+{additions.toLocaleString("en-US")}</span>
      <span className="text-critical">−{deletions.toLocaleString("en-US")}</span>
      <span className="flex gap-px" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className="size-[7px] rounded-[1.5px]" style={{ background: i < green ? "var(--good)" : total && i < 5 ? "var(--critical)" : "var(--grid)" }} />
        ))}
      </span>
    </span>
  );
}
