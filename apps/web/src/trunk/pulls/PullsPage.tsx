import { ArrowUpRight, Download, GitPullRequest } from "lucide-react";
import Link from "next/link";
import { GitHubSync } from "@/components/GitHubSync";
import { ImportContextNotice } from "@/components/ImportContextNotice";
import { Commands } from "@/components/controls";
import { Card, Empty, GitHubMark, LinkButton } from "@/components/ui";
import { ago } from "@/lib/format";
import type { RepoInfo } from "@/lib/types";
import { DiffCount } from "@/pr/badges";
import { at, compare, orMissing, origin, repo as repoOf } from "@/server/api";
import { ChangeFiles } from "../history/ChangeFiles";
import { trunkHref } from "../paths";

/** Where a trunk's work goes. GitHub keeps the original: everything that
 *  landed here goes back to it as one pull request, made from a patch any
 *  clone can apply. A trunk made here goes to GitHub with its history. */
export async function PullsPage({ trunk }: { trunk: string }) {
  const [head, repo, here] = await Promise.all([orMissing(at(trunk)), repoOf(trunk).catch(() => null), origin()]);
  const changes = repo && head.version > 1 ? await compare(trunk, await at(trunk, 1), head) : null;
  // Practice agents write scratch files there, and mark the functions they touch.
  const practice = !!changes?.files.some((f) => f.path.startsWith("src/swarm/"));
  const additions = changes?.files.reduce((n, f) => n + f.additions, 0) ?? 0;
  const deletions = changes?.files.reduce((n, f) => n + f.deletions, 0) ?? 0;

  return (
    <main className="mx-auto max-w-[1280px] space-y-6 px-5 py-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-ink">Pull requests</h1>
        <p className="mt-1 max-w-[80ch] text-[13px] leading-6 text-ink-2">
          {repo
            ? `Agents land here in milliseconds, with no merges. The original stays on GitHub: send what landed back to ${repo.fullName} as one pull request, and people review it there.`
            : "This trunk was made here. Put it on GitHub with its whole history: every landed change is a commit."}
        </p>
      </div>

      {repo && <GitHubSync trunk={trunk} />}
      {repo ? (
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            <GitPullRequest size={18} className="text-good" aria-hidden />
            <h2 className="text-[15px] font-semibold text-ink">Send this trunk&apos;s work to {repo.fullName}</h2>
            {changes && (
              <span className="flex items-center gap-3 text-xs text-ink-2">
                <span className="tabular">
                  v1 → v{head.version.toLocaleString("en-US")}, {changes.files.length.toLocaleString("en-US")} files
                </span>
                <DiffCount additions={additions} deletions={deletions} />
              </span>
            )}
          </div>
          {changes ? (
            <>
              <p className="mt-3 max-w-[85ch] text-xs leading-5 text-muted">
                In a clone of the repository, these lines make a branch at the commit the trunk was imported from, apply everything that landed since
                as one commit (it lists the newest changes and links back here), push it, and open the pull request. A person or an agent with GitHub
                access can run them as they are.
              </p>
              {practice && (
                <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] px-3 py-2 text-xs leading-5 text-ink-2">
                  Practice agents ran on this trunk. Their scratch files under <code className="font-mono">src/swarm/</code> and the &ldquo;touched by&rdquo;
                  comments they leave on shared functions landed like any other change, so they are in this patch too. Send real work from a trunk
                  only your own agents worked on.
                </p>
              )}
              <Commands className="mt-3" code={shipCommands(trunk, here, repo, head.version)} />
              <p className="mt-2 text-[11px] text-muted">
                Starting from the newest {repo.defaultBranch} instead? Switch to <code className="font-mono">origin/{repo.defaultBranch}</code> and use{" "}
                <code className="font-mono">git am -3</code>: the patch names the original blobs, so git can merge around what changed since.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <LinkButton href={`/api/trunks/${trunk}/patch?to=${head.version}`} size="sm">
                  <Download size={12} aria-hidden /> Download the patch
                </LinkButton>
                <LinkButton href={`https://github.com/${repo.fullName}/pulls`} size="sm" variant="ghost">
                  Pull requests on GitHub <ArrowUpRight size={12} aria-hidden />
                </LinkButton>
              </div>
            </>
          ) : (
            <Empty title="Nothing has landed since the import yet.">
              <Link href={trunkHref(trunk, "/connect")} className="text-series-1 hover:underline">
                Connect an agent
              </Link>{" "}
              or{" "}
              <Link href={trunkHref(trunk, "/live")} className="text-series-1 hover:underline">
                launch a swarm
              </Link>
              ; what lands shows up here, ready to send.
            </Empty>
          )}
        </Card>
      ) : (
        <Card className="p-5">
          <div className="flex items-center gap-2.5">
            <GitHubMark size={18} />
            <h2 className="text-[15px] font-semibold text-ink">Put it on GitHub</h2>
          </div>
          <Commands className="mt-3" code={[`git clone ${here}/git/${trunk}.git`, `cd ${trunk}`, `gh repo create ${trunk} --private --source . --push`].join("\n")} />
        </Card>
      )}

      {repo && <Upstream repo={repo} />}

      {changes && changes.files.length > 0 && (
        <section>
          <h2 className="mb-3 text-[13px] font-semibold text-ink">
            What the pull request will contain <span className="font-normal text-muted">everything that changed since the import</span>
          </h2>
          <ChangeFiles trunk={trunk} files={changes.files} v={head.version} viewedKey={`${trunk}@since-import`} />
        </section>
      )}
    </main>
  );
}

/** The lines that turn the trunk's work into a pull request on GitHub. */
function shipCommands(trunk: string, here: string, repo: RepoInfo, to: number): string {
  const name = repo.fullName.split("/")[1];
  const branch = `swarm/${trunk}`;
  return [
    `gh repo clone ${repo.fullName} && cd ${name}   # or use your clone`,
    repo.commit ? `git fetch origin && git switch -c ${branch} ${repo.commit}` : `git fetch origin && git switch -c ${branch} origin/${repo.defaultBranch}`,
    `curl -fsSL "${here}/api/trunks/${trunk}/patch?to=${to}" | git am --keep-cr`,
    `git push -u origin ${branch}`,
    `gh pr create --fill --base ${repo.defaultBranch}`,
  ].join("\n");
}

/** People's open pull requests on the original, read here in reading order. */
function Upstream({ repo }: { repo: RepoInfo }) {
  return (
    <Card>
      <h2 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] font-semibold text-ink">
        Open on {repo.fullName} <span className="tabular font-normal text-muted">{repo.pulls.length}</span>
        <span className="ml-auto text-xs font-normal text-muted">at the last GitHub sync</span>
      </h2>
      <div className="px-4 pt-3"><ImportContextNotice repo={repo} kind="pulls" /></div>
      {repo.pulls.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted">No upstream pull requests were included in this snapshot.</p>
      ) : (
        <ul className="divide-y divide-line">
          {repo.pulls.map((p) => (
            <li key={p.number} className="flex items-start gap-2.5 px-4 py-2.5 text-[13px]">
              <GitPullRequest size={15} className="mt-0.5 shrink-0" style={{ color: p.draft ? "var(--muted)" : "var(--good)" }} aria-hidden />
              <div className="min-w-0 flex-1">
                <Link href={`/pr/${repo.fullName}/${p.number}`} className="font-medium text-ink hover:text-series-1 hover:underline">
                  {p.title}
                </Link>
                <p className="text-xs text-muted">
                  #{p.number} {p.draft ? "draft " : ""}opened {ago(Date.now() - p.created)} by {p.author}
                </p>
              </div>
              <a href={p.url} target="_blank" rel="noreferrer" aria-label="Open on GitHub" className="shrink-0 text-muted hover:text-ink">
                <ArrowUpRight size={14} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
