import NextLink from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// The few pieces every page shares, so a button looks and behaves the same
// everywhere: one primary action per view, the rest quiet. These render on
// the server too; the ones with state are in ./controls.

export type Variant = "primary" | "secondary" | "ghost";
export type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "nh-button-primary border",
  secondary: "border border-line bg-surface text-ink hover:bg-wash",
  ghost: "border-transparent bg-transparent text-ink-2 hover:bg-wash hover:text-ink",
};
const SIZE: Record<Size, string> = {
  sm: "h-7 gap-1 px-2 text-[11px]",
  md: "h-8 gap-1.5 px-3 text-xs",
  lg: "h-10 gap-2 px-4 text-sm",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", className?: string) {
  return cn(
    "nh-button inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-series-1/60 disabled:pointer-events-none disabled:opacity-50",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

/** A link that looks like a button; outside links open in a new tab. */
export function LinkButton(props: { href: string; variant?: Variant; size?: Size; className?: string; children: ReactNode; title?: string }) {
  const cls = buttonClass(props.variant, props.size, props.className);
  if (/^https?:/.test(props.href)) {
    return (
      <a href={props.href} target="_blank" rel="noreferrer" className={cls} title={props.title}>
        {props.children}
      </a>
    );
  }
  return (
    <NextLink href={props.href} className={cls} title={props.title}>
      {props.children}
    </NextLink>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-surface px-1 font-mono text-[10px] text-ink-2">{children}</kbd>;
}

/** A bordered box, the unit every page is built from. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("nh-card border border-line bg-surface", className)}>{children}</section>;
}

/** What to show where there is nothing yet, with the way to change that. */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="max-w-md text-xs leading-5 text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Grey bars where content will be. */
export function Skeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("animate-pulse space-y-2.5", className)} aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-3.5 rounded bg-wash" style={{ width: `${90 - ((i * 23) % 40)}%` }} />
      ))}
    </div>
  );
}

export function Pill({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2", className)}>
      {children}
    </span>
  );
}

/** GitHub's mark (Octicons "mark-github", MIT), for links to GitHub. */
export function GitHubMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}
