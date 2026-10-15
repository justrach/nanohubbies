import { notFound } from "next/navigation";
import { PullPage } from "../../../../client";

const NAME = /^[\w.-]{1,100}$/;

export default async function Page({ params }: { params: Promise<{ owner: string; repo: string; number: string }> }) {
  const { owner, repo, number } = await params;
  if (!NAME.test(owner) || !NAME.test(repo) || !/^\d{1,9}$/.test(number)) notFound();
  return <PullPage key={`${owner}/${repo}/${number}`} owner={owner} repo={repo} number={Number(number)} />;
}
