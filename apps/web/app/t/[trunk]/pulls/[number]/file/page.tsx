import Link from "next/link";
import { get, orMissing } from "@/server/api";
import { Card } from "@/components/ui";

export const metadata = { title: "PR source" };
export default async function Page({ params, searchParams }: {
  params: Promise<{ trunk: string; number: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ trunk, number }, query] = await Promise.all([params, searchParams]);
  const path = typeof query.path === "string" ? query.path : "";
  const side = query.side === "base" ? "base" : "head";
  const file = await orMissing(get<{ path: string; text: string; commit: string }>(`/api/trunks/${encodeURIComponent(trunk)}/pulls/${encodeURIComponent(number)}/file?${new URLSearchParams({ path, side })}`));
  return <main className="mx-auto max-w-[1280px] space-y-4 px-5 py-8">
    <Link className="text-xs text-muted hover:text-ink" href={`/t/${trunk}/pulls/${number}`}>← PR #{number}</Link>
    <Card><header className="flex flex-wrap justify-between gap-3 border-b border-line p-4 text-sm text-ink"><span className="break-all">{file.path}</span><code className="text-xs text-muted">{side} · {file.commit.slice(0, 7)}</code></header>
      <pre className="overflow-auto p-4 font-mono text-xs leading-6 text-ink-2">{file.text}</pre></Card>
  </main>;
}
