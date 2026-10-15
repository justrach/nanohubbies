"use client";

import {
  Activity,
  ChevronDown,
  CircleDot,
  Code2,
  FolderGit2,
  GitCommitHorizontal,
  GitPullRequest,
  GitBranch,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Plus,
  Settings2,
  Tag,
  Users,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BrandMark } from "@/components/Brand";
import { Link } from "@/lib/router";
import { useLiveRoom, useTrunk } from "./context";
import { trunkHref } from "./paths";
import "./workspace.css";

const destinations = [
  { path: "/overview", label: "Overview", icon: LayoutDashboard },
  { path: "/room", label: "Agent room", icon: MessageSquare },
  { path: "", label: "Code", icon: Code2 },
  { path: "/branches", label: "Branches", icon: GitBranch },
  { path: "/commits", label: "Commits", icon: GitCommitHorizontal },
  { path: "/issues", label: "Issues", icon: CircleDot },
  { path: "/pulls", label: "Pull requests", icon: GitPullRequest },
  { path: "/releases", label: "Releases", icon: Tag },
  { path: "/live", label: "Activity", icon: Activity },
  { path: "/people", label: "People", icon: Users },
  { path: "/setup", label: "Agent setup", icon: Settings2 },
];
export function workspaceSection(rest: string) {
  if (rest.startsWith("/pulls/")) return "Pull requests";
  if (/^\/(tree|blob)(\/|$)/.test(rest)) return "Code";
  if (rest.startsWith("/commit")) return "Commits";
  if (rest.startsWith("/connect")) return "Agent setup";
  return destinations.find((item) => item.path === rest)?.label ?? "Workspace";
}

export function WorkspaceNav({ trunk }: { trunk: string }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const mobile = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (mobile.current) mobile.current.open = false; }, [pathname]);
  const { head, tip, repo } = useTrunk();
  const room = useLiveRoom();
  const section = workspaceSection(pathname.slice(trunkHref(trunk).length));
  const counts: Record<string, number> = {
    "Agent room": room.roster.length,
    Commits: tip,
    Issues: [...room.issues.values()].filter(
      (issue) => issue.state !== "closed",
    ).length,
  };
  const renderDestination = (item: typeof destinations[number]) => (
    <Link
      key={item.path}
      to={trunkHref(trunk, item.path)}
      prefetch={false}
      onMouseEnter={() => router.prefetch(trunkHref(trunk, item.path))}
      onFocus={() => router.prefetch(trunkHref(trunk, item.path))}
      aria-current={section === item.label ? "page" : undefined}
    >
      <item.icon size={15} aria-hidden />
      <span>{item.label}</span>
      {counts[item.label] > 0 && item.label !== "Commits" && (
        <small>{counts[item.label].toLocaleString()}</small>
      )}
    </Link>
  );
  const links = (
    <>
      <div className="workspace-global-links">
        <Link to="/dashboard" prefetch={false}>
          <FolderGit2 size={15} />
          All workspaces
        </Link>
        <Link
          to="/start"
          prefetch={false}
          onMouseEnter={() => router.prefetch("/start")}
        >
          <Plus size={15} />
          New workspace
        </Link>
      </div>
      <details className="workspace-switcher">
        <summary>
          <FolderGit2 size={15} />
          <span>{trunk}</span>
          <ChevronDown size={13} />
        </summary>
        <div>
          <Link to="/dashboard" prefetch={false}>
            Switch workspace
          </Link>
          <Link to="/start" prefetch={false}>
            Create a workspace
          </Link>
        </div>
      </details>
      <nav aria-label="Workspace">
        {destinations.filter((item) => ["Overview", "Agent room", "Code", "Issues", "Pull requests", "Agent setup"].includes(item.label)).map(renderDestination)}
        <details className="workspace-more" key={section} open={["Branches", "Commits", "Releases", "Activity", "People"].includes(section)}>
          <summary>More <ChevronDown size={13} aria-hidden /></summary>
          {destinations.filter((item) => ["Branches", "Commits", "Releases", "Activity", "People"].includes(item.label)).map(renderDestination)}
        </details>
      </nav>
      <footer className="workspace-sidebar-footer">
        <span>
          {head ? `main · v${tip.toLocaleString()}` : "Preparing source"}
        </span>
        {repo && (
          <a
            href={repo.url}
            target="_blank"
            rel="noreferrer"
            title={repo.fullName}
          >
            {repo.fullName}
          </a>
        )}
      </footer>
    </>
  );
  return (
    <>
      <aside className="workspace-sidebar">
        <Link
          to="/dashboard"
          className="workspace-brand"
          aria-label="nanohub dashboard"
        >
          <BrandMark />
          nanohub
        </Link>
        {links}
      </aside>
      <details ref={mobile} className="workspace-mobile-nav">
        <summary>
          <Menu size={16} />
          {trunk}
          <span>{section}</span>
          <ChevronDown size={14} />
        </summary>
        <div>{links}</div>
      </details>
    </>
  );
}
