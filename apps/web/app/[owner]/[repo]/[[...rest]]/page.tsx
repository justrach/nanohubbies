import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { GitHubPath } from "@/views/GitHubPath";
import { lookup } from "@/server/api";

type Props = { params: Promise<{ owner: string; repo: string; rest?: string[] }> };

const OWNER = /^[A-Za-z0-9-]{1,39}$/;
const REPO = /^[\w.-]{1,100}$/;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `${owner}/${repo}` };
}

/** Any GitHub address with this host instead of github.com: a pull request
 *  opens on the reading page; a repository opens its trunk here, at the same
 *  path, or offers to make one. */
export default async function Page({ params }: Props) {
  const { owner, repo, rest = [] } = await params;
  if (!OWNER.test(owner) || !REPO.test(repo)) notFound();
  const name = repo.replace(/\.git$/, "");
  if ((rest[0] === "pull" || rest[0] === "pulls") && /^\d+$/.test(rest[1] ?? "")) redirect(`/pr/${owner}/${name}/${rest[1]}`);
  const found = await lookup(`${owner}/${name}`).catch(() => []);
  if (found.length) {
    const trunk = found[0].name;
    // /tree/<branch>/<path> and /blob/<branch>/<path>: the trunk has one branch.
    if ((rest[0] === "tree" || rest[0] === "blob") && rest.length > 2) redirect(`/t/${trunk}/${rest[0]}/${rest.slice(2).join("/")}`);
    if (rest[0] === "commits") redirect(`/t/${trunk}/commits`);
    if (rest[0] === "issues") redirect(`/t/${trunk}/issues${/^\d+$/.test(rest[1] ?? "") ? `#${rest[1]}` : ""}`);
    if (rest[0] === "pulls") redirect(`/t/${trunk}/pulls`);
    redirect(`/t/${trunk}`);
  }
  return <GitHubPath repo={`${owner}/${name}`} />;
}
