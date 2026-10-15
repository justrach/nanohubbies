import type { ReactNode } from "react";
import { SegmentedToggleButton } from "@/components/opensourceui/segmented-toggle-button";
import { cn } from "@/lib/utils";

export function Panel(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col border border-line bg-surface",
        props.className,
      )}
    >
      <header className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{props.title}</h2>
          {props.subtitle && (
            <p className="mt-0.5 text-xs text-muted">{props.subtitle}</p>
          )}
        </div>
        {props.actions && (
          <div className="flex shrink-0 items-center gap-1.5">
            {props.actions}
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 px-4 pb-4">{props.children}</div>
    </section>
  );
}

/** Chart or table: every chart has a table twin, so no value is hover-only. */
export function ViewToggle({
  table,
  onChange,
}: {
  table: boolean;
  onChange: (table: boolean) => void;
}) {
  return (
    <SegmentedToggleButton
      aria-label="View"
      options={["Chart", "Table"]}
      valueIndex={table ? 1 : 0}
      onChange={(index) => onChange(index === 1)}
    />
  );
}
