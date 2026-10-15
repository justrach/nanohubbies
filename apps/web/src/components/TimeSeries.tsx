import { ticks } from "@/lib/format";
import { EvilAreaChart } from "./evilcharts/charts";

/** One series per second over a window ending now: a 2px line over a 10% wash,
 *  hairline grid, a crosshair that snaps to the nearest second, and a table
 *  twin. A single series needs no legend; the panel title names it. */
export function TimeSeries(props: {
  values: number[];
  color: string;
  name: string;
  height?: number;
  table: boolean;
}) {
  const height = props.height ?? 150;
  const n = props.values.length;

  if (props.table) {
    const rows = props.values
      .map((v, i) => ({ ago: n - 1 - i, v }))
      .slice(-30)
      .reverse();
    return (
      <div className="max-h-[220px] overflow-auto">
        <table className="tabular w-full text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 text-left font-normal">Second</th>
              <th className="py-1 text-right font-normal">{props.name}</th>
            </tr>
          </thead>
          <tbody className="text-ink-2">
            {rows.map((r) => (
              <tr key={r.ago} className="border-t border-line">
                <td className="py-1">{r.ago === 0 ? "now" : `−${r.ago}s`}</td>
                <td className="py-1 text-right text-ink">{r.v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const yTicks = ticks(Math.max(...props.values, 1));
  return (
    <EvilAreaChart
      title={`${props.name}, last ${n} seconds`}
      height={height}
      ticks={yTicks}
      data={props.values.map((value, i) => ({
        label: i === n - 1 ? "now" : `−${n - 1 - i}s`,
        value,
      }))}
      series={[{ key: "value", label: props.name, color: props.color }]}
    />
  );
}
