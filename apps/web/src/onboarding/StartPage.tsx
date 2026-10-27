import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { StartForm } from "@/views/StartForm";
import styles from "./StartPage.module.css";
import { NewGitRepository } from "./NewGitRepository";

export function StartPage({ initial = "" }: { initial?: string }) {
  return <div className={styles.page}>
    <TopBar crumbs={<span className="text-sm text-ink-2">New repository</span>} />
    <main className={styles.main}>
      <Link href="/dashboard" className={styles.back}><ArrowLeft size={13} />Workspaces</Link>
      <h1>Create a repository</h1>
      <p className={styles.lead}>Host your code, review changes and collaborate. Use any Git client or coding agent.</p>
      <section className={styles.import} aria-label="Create a repository"><NewGitRepository primary/></section>
      <details className={styles.explanation} open={!!initial}><summary>Import a GitHub source snapshot</summary><StartForm initial={initial} destination="code" focused /></details>
      <div className={styles.reassurance}><ShieldCheck size={15} /><p>New repositories are private. You choose who can read and contribute.</p></div>
      <details className={styles.explanation}>
        <summary>Bring existing code</summary>
        <p>Push from an existing clone, or use the migration tool to copy Git history and assets. Issues, pull requests and branch protections are available without connecting an agent.</p>
        <p>With a GitHub source snapshot, binary assets, generated files, full Git history, and issue discussions stay on GitHub. Choose an independent Git repository above to migrate complete Git history and assets. You can inspect what was copied once the workspace opens.</p>
      </details>
    </main>
  </div>;
}
