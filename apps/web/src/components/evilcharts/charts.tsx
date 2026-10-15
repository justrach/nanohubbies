"use client";

// Adapted from EvilCharts' Recharts area/bar registry, MIT © 2026 Gurbinder.
// https://github.com/legions-developer/evilcharts/tree/main/src/registry/charts
// The gradient mask/pattern, scoped series IDs, grid and axes are retained.
// This focused adapter omits registry selection/loading/brush features.
// Full permission notice is in ./LICENSE.
import { useId } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type Series = { key: string; label: string; color: string };
type ChartProps = {
  data: Record<string, string | number | undefined>[];
  series: Series[];
  title: string;
  height?: number;
  ticks?: number[];
  format?: (value: number) => string;
};

/** EvilCharts' vertical fade mask and color pattern, scoped per instance. */
function GradientPattern({ id, color }: { id: string; color: string }) {
  return (
    <>
      <linearGradient id={`${id}-colors`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor={color} />
        <stop offset="100%" stopColor={color} />
      </linearGradient>
      <linearGradient id={`${id}-vertical-fade`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="white" stopOpacity={0.16} />
        <stop offset="100%" stopColor="white" stopOpacity={0} />
      </linearGradient>
      <mask id={`${id}-gradient-mask`}>
        <rect width="100%" height="100%" fill={`url(#${id}-vertical-fade)`} />
      </mask>
      <pattern
        id={`${id}-gradient`}
        patternUnits="userSpaceOnUse"
        width="100%"
        height="100%"
      >
        <rect
          width="100%"
          height="100%"
          fill={`url(#${id}-colors)`}
          mask={`url(#${id}-gradient-mask)`}
        />
      </pattern>
    </>
  );
}

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 4,
  color: "var(--ink)",
  fontSize: 12,
};

export function EvilAreaChart(props: ChartProps & { compact?: boolean }) {
  const id = useId().replace(/:/g, "");
  const height = props.height ?? 150;
  if (props.data.length === 0)
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-xs text-muted"
      >
        No samples yet
      </div>
    );
  return (
    <div style={{ height, minWidth: 0 }} role="img" aria-label={props.title}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart
          data={props.data}
          margin={
            props.compact
              ? { top: 4, bottom: 4, left: 3, right: 3 }
              : { top: 12, bottom: 0, left: -20, right: 8 }
          }
          accessibilityLayer
        >
          <defs>
            {props.series.map((s) => (
              <GradientPattern
                key={s.key}
                id={`${id}-${s.key}`}
                color={s.color}
              />
            ))}
          </defs>
          {!props.compact && (
            <CartesianGrid
              vertical={false}
              strokeDasharray="3 3"
              stroke="var(--grid)"
            />
          )}
          {!props.compact && (
            <XAxis
              dataKey="label"
              interval="preserveStartEnd"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tick={{ fill: "var(--muted)", fontSize: 10 }}
            />
          )}
          {!props.compact && (
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              ticks={props.ticks}
              domain={[0, props.ticks?.at(-1) ?? "auto"]}
              tick={{ fill: "var(--muted)", fontSize: 10 }}
            />
          )}
          {!props.compact && (
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ strokeDasharray: "3 3", stroke: "var(--axis)" }}
            />
          )}
          {props.series.map((s) => (
            <Area
              key={s.key}
              dataKey={s.key}
              name={s.label}
              type="linear"
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#${id}-${s.key}-gradient)`}
              dot={false}
              activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** EvilCharts' themed compound bar primitives, composed for measured data. */
export function EvilBarChart(props: ChartProps) {
  const height = props.height ?? 200;
  if (props.data.length === 0)
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-xs text-muted"
      >
        No measurements yet
      </div>
    );
  return (
    <div style={{ height, minWidth: 0 }} role="img" aria-label={props.title}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart
          data={props.data}
          margin={{ top: 20, left: -20, right: 8, bottom: 0 }}
          barGap={3}
          accessibilityLayer
        >
          <CartesianGrid
            vertical={false}
            strokeDasharray="3 3"
            stroke="var(--grid)"
          />
          <XAxis
            dataKey="label"
            interval="preserveStartEnd"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={{ fill: "var(--muted)", fontSize: 10 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            ticks={props.ticks}
            domain={[0, props.ticks?.at(-1) ?? "auto"]}
            tick={{ fill: "var(--muted)", fontSize: 10 }}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(label, payload) =>
              payload?.[0]?.payload?.name ?? label
            }
            cursor={{ fill: "var(--wash)", opacity: 0.5 }}
          />
          {props.series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color}
              radius={[2, 2, 0, 0]}
              maxBarSize={40}
              isAnimationActive={false}
            >
              <LabelList
                dataKey={s.key}
                position="top"
                formatter={(v: unknown) =>
                  typeof v === "number" ? (props.format?.(v) ?? String(v)) : ""
                }
                fill="var(--ink-2)"
                fontSize={10}
              />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
