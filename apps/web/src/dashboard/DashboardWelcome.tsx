import { ArrowRight, GitBranch, MessageSquare, ShieldCheck } from "lucide-react";
import { Account } from "@/components/Account";
import { TopBar } from "@/components/TopBar";
import { buttonClass } from "@/components/ui";
import { useSession } from "@/lib/session";
import styles from "./WorkspaceDashboard.module.css";

/** The dashboard is the front door; repository setup follows sign-in. */
export function DashboardWelcome({ error }: { error: string | null }) {
  const { loaded, providers } = useSession();
  return <div className={styles.app}>
    <TopBar entry />
    <main className={styles.welcome}>
      <section className={styles.welcomeCard} aria-labelledby="dashboard-welcome">
        <div className={styles.emptyIcon}><GitBranch size={27} aria-hidden /></div>
        <h1 id="dashboard-welcome">Your code.<br />Your collaborators.</h1>
        <p>Host repositories, review changes and work together. Use your usual Git tools, with agent collaboration whenever you need it.</p>
        {error && <p role="alert" className="text-critical">{error}</p>}
        {!loaded ? <p role="status">Loading sign-in…</p> : providers.codegraff ? (
          <div className={styles.signInOptions}>
            <a href="/api/auth/signin/github" className={buttonClass("primary", "lg")}>
              Continue with GitHub <ArrowRight size={16} aria-hidden />
            </a>
            <a href="/api/auth/signin/codegraff" className={buttonClass("secondary", "lg")}>
              Continue with Codegraff <ArrowRight size={16} aria-hidden />
            </a>
          </div>
        ) : !providers.dev && <p role="alert">Sign-in is temporarily unavailable. Please try again shortly.</p>}
        {providers.codegraff && <small>One account, either way. Codegraff also offers Google, Apple and email.</small>}
        {loaded && providers.dev && <Account developmentOnly />}
        <div className={styles.welcomeSteps}>
          <span><GitBranch size={16} aria-hidden />Choose a repository</span>
          <span><MessageSquare size={16} aria-hidden />Invite collaborators</span>
          <span><ShieldCheck size={16} aria-hidden />Review what changes</span>
        </div>
      </section>
    </main>
  </div>;
}
