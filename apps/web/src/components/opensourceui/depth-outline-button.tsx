"use client";

// Adapted from bidyut10/opensourceui (MIT). See ./LICENSE and SOURCES.md.

import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

export type DepthOutlineButtonSize = "sm" | "md" | "lg";

export type DepthOutlineButtonProps = Readonly<
  {
    children?: ReactNode;
    size?: DepthOutlineButtonSize;
  } & ComponentPropsWithoutRef<"button">
>;

const SIZE: Record<DepthOutlineButtonSize, string> = {
  sm: "h-7 gap-1 rounded-md px-2 text-[11px]",
  md: "h-8 gap-1.5 rounded-md px-3 text-xs",
  lg: "h-10 gap-2 rounded-md px-4 text-sm",
};

export const DepthOutlineButton = forwardRef<
  HTMLButtonElement,
  DepthOutlineButtonProps
>(
  (
    { className, children, size = "md", type = "button", disabled, ...props },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        data-slot="depth-outline-button"
        data-size={size}
        className={cn(
          "inline-flex cursor-pointer items-center justify-center bg-surface font-sans font-semibold text-ink outline-none select-none",
          "transition-[background-color,box-shadow,color,transform] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
          "active:translate-y-px motion-reduce:active:translate-y-0",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-series-1",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40",
          "border border-line hover:bg-wash active:bg-wash",
          SIZE[size],
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

DepthOutlineButton.displayName = "DepthOutlineButton";
