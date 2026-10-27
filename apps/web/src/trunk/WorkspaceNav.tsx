"use client";

import {
  Activity,
  Play,
  ChevronDown,
  CircleDot,
  Code2,
  GitCommitHorizontal,
  GitPullRequest,
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  Settings2,
  Tag,
  Users,
  LockKeyhole,
  BookMarked,
  Ellipsis,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Link } from "@/lib/router";
import { useLiveRoom, useTrunk } from "./context";
import { trunkHref } from "./paths";
import "./workspace.css";

const destinations = [
  { path: "", label: "Code", icon: Code2 },
  { path: "/issues", label: "Issues", icon: CircleDot },
  { path: "/pulls", label: "Pull requests", icon: GitPullRequest },
  { path: "/actions", label: "Actions", icon: Play },
  { path: "/room", label: "Agents", icon: MessageSquare },
  { path: "/releases", label: "Releases", icon: Tag },
  { path: "/live", label: "Activity", icon: Activity },
  { path: "/people", label: "Settings", icon: Settings2 },
];
const secondary = [
  { path: "/overview", label: "Overview", icon: LayoutDashboard },
  { path: "/branches", label: "Branches", icon: GitBranch },
  { path: "/commits", label: "Commits", icon: GitCommitHorizontal },
  { path: "/setup", label: "Agent setup", icon: Settings2 },
  { path: "/connect", label: "Git access", icon: BookMarked },
  { path: "/settings/rules", label: "Rules", icon: Settings2 },
];
export function workspaceSection(rest: string) {
  if(rest.startsWith("/settings/"))return "Settings";
  if (rest.startsWith("/pulls/")) return "Pull requests";
  if (/^\/(tree|blob)(\/|$)/.test(rest)) return "Code";
  if (rest.startsWith("/commit")) return "Commits";
  if (rest.startsWith("/connect")) return "Git access";
  return (
    [...destinations, ...secondary].find((item) => item.path === rest)?.label ??
    "Repository"
  );
}
export function WorkspaceNav({ trunk }: { trunk: string }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const more = useRef<HTMLDetailsElement>(null);
  const tabs = useRef<HTMLElement>(null);
  const { address, isPrivate } = useTrunk();
  const room = useLiveRoom();
  const section = workspaceSection(pathname.slice(trunkHref(trunk).length));
  useEffect(() => {
    if (more.current) more.current.open = false;
  }, [pathname]);
  useEffect(() => {
    const dismiss = (e: PointerEvent) => {
      if (more.current && !more.current.contains(e.target as Node))
        more.current.open = false;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && more.current) {
        more.current.open = false;
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  useEffect(() => {
    tabs.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);
  const counts: Record<string, number> = {
    Issues: [...room.issues.values()].filter(
      (issue) => issue.state !== "closed",
    ).length,
    Agents: room.roster.length,
  };
  const isCurrent = (label: string) =>
    section === label ||
    (label === "Code" && ["Branches", "Commits"].includes(section)) ||
    (label === "Agents" && section === "Agent setup");
  const link = (item: (typeof destinations)[number]) => (
    <Link
      key={item.path}
      to={trunkHref(trunk, item.path)}
      prefetch={false}
      onMouseEnter={() => router.prefetch(trunkHref(trunk, item.path))}
      onFocus={() => router.prefetch(trunkHref(trunk, item.path))}
      aria-current={isCurrent(item.label) ? "page" : undefined}
    >
      <item.icon size={16} aria-hidden />
      <span>{item.label}</span>
      {counts[item.label] > 0 && <small>{counts[item.label]}</small>}
    </Link>
  );
  return (
    <div className="repository-navigation">
      <div className="repository-identity">
        <div className="repository-name">
          <BookMarked size={20} aria-hidden />
          {address && (
            <>
              <Link to="/dashboard" className="repository-owner">
                {address.namespace}
              </Link>
              <span className="repository-slash">/</span>
            </>
          )}
          <Link to={trunkHref(trunk)} className="repository-title">
            {address?.name ?? trunk}
          </Link>
          {isPrivate !== undefined && (
            <span className="repository-visibility">
              {isPrivate && <LockKeyhole size={11} aria-hidden />}
              {isPrivate ? "Private" : "Public"}
            </span>
          )}
        </div>
        <div className="repository-quick-actions">
          <Link to={trunkHref(trunk, "/branches")}>
            <GitBranch size={14} aria-hidden />
            Branches
          </Link>
          <Link to={trunkHref(trunk, "/people")}>
            <Users size={14} aria-hidden />
            Collaborators
          </Link>
        </div>
      </div>
      <div className="repository-tabs-row">
        <nav ref={tabs} aria-label="Repository" className="repository-tabs">
          {destinations.map(link)}
        </nav>
        <details ref={more} className="repository-more">
          <summary aria-label="More repository pages">
            <Ellipsis size={18} />
            <ChevronDown size={11} />
          </summary>
          <nav aria-label="More repository pages">{secondary.map(link)}</nav>
        </details>
      </div>
    </div>
  );
}
