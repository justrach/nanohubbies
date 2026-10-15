import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { StartForm } from "@/views/StartForm";
import styles from "./StartPage.module.css";

export function StartPage({ initial = "" }: { initial?: string }) {
  return <div className={styles.page}>
    <TopBar crumbs={<span className="text-sm text-ink-2">New workspace</span>} />
    <main className={styles.main}>
      <Link href="/dashboard" className={styles.back}><ArrowLeft size={13} />Workspaces</Link>
      <ol className={styles.progress} aria-label="Workspace setup">
        <li aria-current="step"><span>1</span>Repository</li>
        <li><span>2</span>Connect agent</li>
        <li><span>3</span>First change</li>
      </ol>
      <h1>Start with your repository</h1>
      <p className={styles.lead}>Bring your code. Connect your agent. Make something better.</p>
      <section className={styles.import} aria-label="Choose a repository">
        <StartForm initial={initial} autoFocus destination="setup" focused />
      </section>
      <div className={styles.reassurance}><ShieldCheck size={15} /><p>Your GitHub repository stays as it is. Review your agent’s work here before sending changes back.</p></div>
      <details className={styles.explanation}>
        <summary>How does a workspace work?</summary>
        <p>We create a working copy of your source with issue and pull-request context. Connect an agent from your own coding tool, give it a task, and follow its changes in the room.</p>
        <p>Binary assets, generated files, full Git history, and issue discussions stay on GitHub. You can inspect what was copied once the workspace opens.</p>
      </details>
    </main>
  </div>;
}
