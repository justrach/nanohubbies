import { AnimatedCounter } from "@/components/rare/animated-counter";
import { EvilAreaChart } from "./evilcharts/charts";
import { percent } from "@/lib/format";

/** Four measured signals in a single divided row. */
export function StatTiles(props: {
  perSecond: number;
  history: number[];
  landed: number;
  conflicts: number;
  lives: number;
  live: number;
  version: number;
}) {
  return (
    <section aria-label="Trunk metrics" className="border-y border-line">
      <div className="grid grid-cols-2 md:grid-cols-4">
        <div className="flex items-center justify-between gap-3 border-b border-line py-4 pr-4 md:border-b-0">
          <div>
            <p className="text-xs text-ink-2">Landed per second</p>
            <AnimatedCounter
              value={props.perSecond}
              decimals={1}
              className="mt-1 text-2xl font-semibold tracking-tight text-ink"
            />
            <p className="mt-1 text-[11px] text-muted">Last 5 seconds</p>
          </div>
          <Sparkline values={props.history} />
        </div>
        <Metric
          label="Changes landed"
          value={props.landed}
          note="One commit each"
        />
        <Metric
          label="Conflicts re-planned"
          value={props.conflicts}
          note={`${percent(props.conflicts, props.lives)} of lives`}
        />
        <Metric
          label="Agents live"
          value={props.live}
          note="Seen in the last 2 minutes"
        />
      </div>
      <p className="pb-2 text-[11px] text-muted">
        Trunk v{props.version.toLocaleString("en-US")} · Linear history
      </p>
    </section>
  );
}

function Metric(props: { label: string; value: number; note: string }) {
  return (
    <div className="border-l border-line px-4 py-4">
      <p className="text-xs text-ink-2">{props.label}</p>
      <AnimatedCounter
        value={props.value}
        className="mt-1 text-2xl font-semibold tracking-tight text-ink"
      />
      <p className="mt-1 text-[11px] text-muted">{props.note}</p>
    </div>
  );
}

/** History in the de-emphasis hue, the current second in the accent. */
function Sparkline({ values }: { values: number[] }) {
  return (
    <div className="hidden w-[80px] shrink-0 xl:block shrink-0">
      <EvilAreaChart
        compact
        height={44}
        title="Recent landing rate"
        data={values.map((value, i) => ({ label: String(i), value }))}
        series={[{ key: "value", label: "Landed", color: "var(--series-1)" }]}
      />
    </div>
  );
}
