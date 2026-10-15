"use client";

import { BrandMark } from "@/components/Brand";
import { Bell, Moon, Sun } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/controls";
import { Account } from "@/components/Account";
import { useSession } from "@/lib/session";
import { Watchers } from "@/components/Avatar";
import { Link } from "@/lib/router";
import type { Owner } from "@/lib/types";
import { cn } from "@/lib/utils";
import "@/trunk/inner.css";

/** Wordmark, where you are, whether the feed is live, who else is here, and what needs you. */
export function TopBar(props: {
  trunk?: string;
  workspace?: boolean;
  section?: string;
  actions?: React.ReactNode;
  /** Where you are, on pages that are not a trunk. */
  crumbs?: React.ReactNode;
  status?: "connecting" | "live" | "offline";
  reviews?: number;
  onBell?: () => void;
  watchers?: Owner[];
  /** No line under it: a trunk's tabs sit right below. */
  flush?: boolean;
  /** Entry pages have their own primary sign-in action. */
  entry?: boolean;
}) {
  // The page script set the theme before paint; the button learns it once mounted.
  const pathname = usePathname();
  const { user } = useSession();
  const otherWatchers = props.watchers?.filter((watcher) => watcher.id !== user?.id) ?? [];
  const [theme, setTheme] = useState<string | null>(null);
  useEffect(() => setTheme(document.documentElement.dataset.theme ?? "light"), []);
  useEffect(() => {
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  return (
    <header className={cn("repo-topbar flex min-h-14 flex-wrap items-center gap-3 px-5 py-2", !props.flush && "border-b border-line")}>
      <Link to={props.trunk || props.crumbs ? "/dashboard" : "/"} aria-label={props.trunk || props.crumbs ? "nanohub dashboard" : "nanohub home"} className={cn("flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight whitespace-nowrap text-ink", props.workspace && "hidden")}>
        <BrandMark />
        <span className={`brand-wordmark ${props.trunk || props.crumbs ? "hidden sm:inline" : ""}`}>nanohub</span>
      </Link>
      {props.crumbs && (
        <>
          <span className="text-muted">/</span>
          {props.crumbs}
        </>
      )}
      {props.trunk && (
        <>
          <span className={cn("text-muted", props.workspace && "hidden")}>/</span>
          <Link to={`/t/${props.trunk}`} className={cn("min-w-0 truncate text-sm font-semibold text-ink hover:underline", props.workspace && "hidden lg:block")}>
            {props.trunk}
          </Link>
        </>
      )}
      {props.section && <><span className={cn("text-muted", props.workspace && "hidden lg:block")}>/</span><span className={cn("text-xs text-ink-2", props.workspace && "hidden lg:block")}>{props.section}</span></>}
      {props.status && (
        <span className="ml-1 flex items-center gap-1.5 text-xs text-ink-2" title="The trunk's live feed">
          <span className={cn("size-1.5 rounded-full", props.status === "live" ? "bg-good" : "bg-muted")} aria-hidden />
          <span className="hidden sm:inline">{props.status === "live" ? "Live" : props.status === "connecting" ? "Connecting" : "Reconnecting"}</span>
        </span>
      )}
      {!props.workspace && !props.entry && <nav aria-label="Primary" className="repo-primary-nav ml-auto flex items-center gap-4 text-xs">
        <Link to="/dashboard" aria-current={pathname === "/dashboard" ? "page" : undefined}>Dashboard</Link>
      </nav>}
      <div className={cn("flex items-center gap-2", (props.workspace || props.entry) && "ml-auto")}>
        {props.actions}
        {otherWatchers.length > 0 && (
          <div className="mr-2 hidden md:block">
            <Watchers watchers={otherWatchers} />
          </div>
        )}
        {(!props.entry || user) && <Account />}
        {props.reviews !== undefined && (props.reviews > 0 || !props.workspace) && (
          <Button variant="ghost" size="sm" onClick={props.onBell} aria-label={`Changes to review: ${props.reviews}`}>
            <Bell size={15} aria-hidden />
            {props.reviews > 0 && <span className="tabular text-xs">{props.reviews}</span>}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-label={theme === "light" ? "Switch to dark" : "Switch to light"}
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          className="size-8 px-0"
        >
          {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
        </Button>
      </div>
    </header>
  );
}
