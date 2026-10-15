"use client";

// Adapted from bidyut10/opensourceui (MIT). See ./LICENSE and SOURCES.md.

import { forwardRef, useState, type ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

export type SegmentedToggleButtonProps = Readonly<
  {
    options?: readonly string[];
    defaultIndex?: number;
    valueIndex?: number;
    onChange?: (index: number, value: string) => void;
  } & Omit<ComponentPropsWithoutRef<"div">, "onChange">
>;

const SEGMENT_MOTION =
  "transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";

const LABEL_MOTION =
  "transition-[color,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";

function segmentGridClass(count: number): string {
  if (count <= 2) return "grid-cols-2";
  if (count === 3) return "grid-cols-3";
  if (count === 4) return "grid-cols-4";
  return "grid-cols-5";
}

function indicatorWidthClass(count: number): string {
  // Subtract horizontal padding (0.5rem) plus inter-segment gaps (gap-1 each).
  if (count <= 2) return "w-[calc((100%-0.75rem)/2)]";
  if (count === 3) return "w-[calc((100%-1rem)/3)]";
  if (count === 4) return "w-[calc((100%-1.25rem)/4)]";
  return "w-[calc((100%-1.5rem)/5)]";
}

function indicatorOffsetClass(count: number, active: number): string {
  if (active <= 0) return "translate-x-0";

  const offsets: Record<number, Record<number, string>> = {
    2: { 1: "translate-x-[calc(100%+0.25rem)]" },
    3: {
      1: "translate-x-[calc(100%+0.25rem)]",
      2: "translate-x-[calc(200%+0.5rem)]",
    },
    4: {
      1: "translate-x-[calc(100%+0.25rem)]",
      2: "translate-x-[calc(200%+0.5rem)]",
      3: "translate-x-[calc(300%+0.75rem)]",
    },
    5: {
      1: "translate-x-[calc(100%+0.25rem)]",
      2: "translate-x-[calc(200%+0.5rem)]",
      3: "translate-x-[calc(300%+0.75rem)]",
      4: "translate-x-[calc(400%+1rem)]",
    },
  };

  const capped = Math.min(count, 5);
  return offsets[capped]?.[active] ?? "translate-x-0";
}

// Segmented toggle — iOS-style sliding pill with smooth eased motion.
export const SegmentedToggleButton = forwardRef<
  HTMLDivElement,
  SegmentedToggleButtonProps
>(
  (
    {
      className,
      options = ["Day", "Week", "Month"],
      defaultIndex = 0,
      valueIndex,
      onChange,
      ...props
    },
    ref,
  ) => {
    const [active, setActive] = useState(defaultIndex);
    const count = options.length;
    const safeActive = Math.min(Math.max(valueIndex ?? active, 0), Math.max(count - 1, 0));

    const select = (index: number) => {
      setActive(index);
      onChange?.(index, options[index] ?? "");
    };

    return (
      <div
        ref={ref}
        role="group"
        data-slot="segmented-toggle-button"
        className={cn(
          "relative inline-grid w-fit gap-1 rounded-md border border-line bg-wash p-1 font-sans text-sm font-medium select-none",
          segmentGridClass(count),
          className,
        )}
        {...props}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-1 bottom-1 left-1 rounded-md bg-surface",
            SEGMENT_MOTION,
            indicatorWidthClass(count),
            indicatorOffsetClass(count, safeActive),
          )}
        />

        {options.map((option, index) => (
          <button
            key={option}
            type="button"
            aria-pressed={safeActive === index}
            onClick={() => select(index)}
            className={cn(
              "relative z-10 min-w-14 cursor-pointer rounded-md px-3 py-1 text-center whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-series-1",
              LABEL_MOTION,
              safeActive === index
                ? "text-ink"
                : "text-muted hover:text-ink-2",
            )}
          >
            {option}
          </button>
        ))}
      </div>
    );
  },
);

SegmentedToggleButton.displayName = "SegmentedToggleButton";
