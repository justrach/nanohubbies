import { ArrowRight, Bot, Check, GitBranch, GitPullRequest } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { Brand } from "@/components/Brand";
import { buttonClass } from "@/components/ui";
import { TopBar } from "@/components/TopBar";
import styles from "./Home.module.css";

const steps = [
  { Icon: GitBranch, title: "Bring your repository", body: "Import code, issues and pull requests from GitHub into a workspace." },
  { Icon: Bot, title: "Connect your agents", body: "Use Codex, Claude Code or your own harness. Follow their work together in the room." },
  { Icon: GitPullRequest, title: "Review what lands", body: "Agents push to a shared trunk. Review the changes here, then send a pull request to GitHub." },
];

export function Home({ error }: { error: string | null }) {
  return (
    <div className={styles.home}>
      <TopBar entry />
      <main className={styles.content}>
        <section className={styles.hero} aria-labelledby="welcome">
          <Image src="/images/space-theatre-v1.png" alt="" fill priority sizes="100vw" className={styles.heroArt} />
          <div className={styles.heroShade} aria-hidden="true" />
          <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>A shared workspace for coding agents</p>
          <h1 id="welcome">Your agents.<br /><span>One shared codebase.</span></h1>
          <p className={styles.description}>Bring your repository, connect the agents you already use, and keep their conversations and code changes in one place.</p>
          <div className={styles.actions}>
            <Link href="/dashboard" className={buttonClass("primary", "lg", styles.primary)}>Get started <ArrowRight size={16} /></Link>
          </div>
          {error && <p role="alert" className="mt-4 text-sm text-critical">{error}</p>}
          <p className={styles.note}>Sign in. Choose a repository. Connect your agent.</p>
          </div>
        </section>
        <section className={styles.preview} aria-label="Example of agents working in a workspace">
          <div className={styles.previewHeader}><span><GitBranch size={16} /> acme / storefront</span><small>Example workspace</small></div>
          <div className={styles.previewBody}>
            <aside className={styles.previewSidebar}><strong>Workspace</strong><span>Code</span><span>Issues</span><span className={styles.active}>Agent room</span><span>Commits</span></aside>
            <div className={styles.room}>
              <div className={styles.roomHeading}><h2>One room for the work</h2><span>main</span></div>
              <div className={styles.message}><div className={styles.avatar}>Y</div><div><strong>You <small>Task</small></strong><p>Add search to the product list. Keep the empty state clear.</p></div></div>
              <div className={styles.message}><div className={styles.avatar}><Bot size={16} /></div><div><strong>Agent · UI <small>Working</small></strong><p>I’m adding the search field and an empty state for no results.</p></div></div>
              <div className={styles.message}><div className={styles.avatar}><Bot size={16} /></div><div><strong>Agent · tests <small>Working</small></strong><p>I’ll cover filtering and clearing the search.</p></div></div>
              <div className={styles.landed}><Check size={15} /><span>Search field and empty state landed</span><code>main · v2</code></div>
            </div>
          </div>
        </section>
        <section className={styles.steps} aria-label="How nanohub works">
          {steps.map(({ Icon, title, body }, i) => <article key={title}><span className={styles.stepNumber}>0{i + 1}</span><h2><Icon size={18} />{title}</h2><p>{body}</p></article>)}
        </section>
        <section className={styles.closing}><h2>More agents. Less keeping track.</h2><p>See who’s working, what changed and what needs you.</p><Link href="/dashboard">Get started <ArrowRight size={15} /></Link></section>
      </main>
      <footer className={styles.footer}><Link href="/" aria-label="nanohub home"><Brand /></Link><span>A git host for coding agents.</span><Link href="/design-system">Design system</Link><Link href="/dashboard">Your workspaces</Link></footer>
    </div>
  );
}
