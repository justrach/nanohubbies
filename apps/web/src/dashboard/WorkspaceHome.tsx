import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CircleDot,
  Code2,
  ExternalLink,
  GitPullRequest,
  History,
  MessageSquare,
  Terminal,
} from "lucide-react";
import { LinkButton } from "@/components/ui";
import type { TrunkListing } from "@/lib/types";
import styles from "./WorkspaceDashboard.module.css";

const destinations = [
  {
    label: "Issues",
    detail: "Find a task and read what needs to change.",
    path: "/issues",
    Icon: CircleDot,
  },
  {
    label: "Code",
    detail: "Browse the files in this workspace.",
    path: "",
    Icon: Code2,
  },
  {
    label: "Pull requests",
    detail: "See upstream PRs and review workspace changes.",
    path: "/pulls",
    Icon: GitPullRequest,
  },
  {
    label: "Commits",
    detail: "See the changes that landed here.",
    path: "/commits",
    Icon: History,
  },
];

export function WorkspaceHome({ workspace }: { workspace: TrunkListing }) {
  const base = `/t/${encodeURIComponent(workspace.name)}`;
  const native=workspace.source==="git:lossless";
  const github = workspace.source.startsWith("github:")
    ? workspace.source.slice(7).split("@")[0]
    : null;
  return (
    <div className={styles.workspaceHome}>
      <header className={styles.header}>
        <div>
          <h1>{workspace.name}</h1>
          <p className={styles.source}>
            {github ? (
              <a
                href={`https://github.com/${github}`}
                target="_blank"
                rel="noreferrer"
              >
                {github}
                <ExternalLink size={12} />
              </a>
            ) : (
              sourceLabel(workspace.source)
            )}
            <span>
              Created{" "}
              {new Date(workspace.created).toLocaleDateString("en", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })}
            </span>
          </p>
        </div>
        <LinkButton size="sm" href={native?base:`${base}/overview`} variant="ghost">
          {native?"Open repository":"Workspace overview"} <ArrowRight size={13} />
        </LinkButton>
      </header>
      <nav className={styles.destinations} aria-label="Explore workspace">
        {destinations.map(({ label, detail, path, Icon }) => (
          <Link key={label} href={base + path} className={styles.destination} title={native&&label==="Pull requests"?"Review changes in this repository.":detail}>
            <Icon size={15} aria-hidden /><span>{label}</span><ArrowRight size={12} className={styles.arrow} />
          </Link>
        ))}
      </nav>
      <div className={styles.actions}>
        <section className={styles.room} aria-labelledby="continue-work">
          <div className={styles.actionHeading}><MessageSquare size={18} /><h2 id="continue-work">{native?"Collaborators":"Agent room"}</h2></div>
          <p>{native?"Invite people and choose their repository roles.":"Follow progress and share the next step."}</p>
          <LinkButton href={`${base}/${native?"people":"room"}`} variant={native?"secondary":"primary"}>{native?"Manage collaborators":"Open room"} <ArrowRight size={13} /></LinkButton>
        </section>
        <section className={styles.connect} aria-labelledby="connect-agent">
          <div className={styles.actionHeading}><Terminal size={18} /><h2 id="connect-agent">{native?"Git access":"Connect an agent"}</h2></div>
          <p>{native?"Clone and push from any terminal or Git client.":"Get a credential and a prompt for your harness."}</p>
          <LinkButton href={`${base}/${native?"connect":"setup"}`} variant={native?"primary":"secondary"}>{native?"Set up Git access":"Set up agent"} <ArrowRight size={13} /></LinkButton>
        </section>
      </div>
      {native&&<p className="text-xs text-muted">Want agent collaboration? <Link className="text-series-1 underline underline-offset-2" href={`${base}/connect#agent-collaboration`}>Connect any coding agent</Link> when you need it.</p>}
      <details className={styles.explainer}>
        <summary>
          <BookOpen size={15} />
          How this workspace works
        </summary>
        {native?<><ol><li><strong>Work with Git.</strong> Clone, create a branch, commit and push from your usual tools.</li><li><strong>Review changes.</strong> Open a pull request and satisfy the repository’s review and check requirements.</li><li><strong>Collaborate your way.</strong> Invite people or optionally connect an agent from any coding tool.</li></ol><p>Git history, branches, tags and binary assets live in this repository.</p></>:<><ol>
          <li>
            <strong>Choose work in Issues.</strong> Open a task to read its
            description and context.
          </li>
          <li>
            <strong>Coordinate in the Room.</strong> Give the task to an agent
            running in your harness; it reports progress here.
          </li>
          <li>
            <strong>Review the result.</strong> Browse its commits and send
            changes to GitHub when ready.
          </li>
        </ol>
        <p>
          Imported repositories are source snapshots. Issues and PR lists
          reflect the import; full history, binary assets and issue discussions
          remain on GitHub.
        </p>
        </>}
      </details>
    </div>
  );
}

export function sourceLabel(source: string): string {
  if(source==="git:lossless")return "Git repository";
  if (source.startsWith("github:")) return source.slice(7).split("@")[0];
  if (source.startsWith("template:")) return `Demo · ${source.slice(9)}`;
  if (!source || source === "files") return "Local repository";
  return source;
}
