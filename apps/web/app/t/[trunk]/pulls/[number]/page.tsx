import { get, orMissing } from "@/server/api";
import { PullDetail, type PullView } from "@/trunk/review/PullDetail";

export async function generateMetadata({ params }: { params: Promise<{ trunk: string; number: string }> }) {
  const { trunk, number } = await params;
  return { title: `PR #${number} · ${trunk}` };
}

export default async function Page({ params }: { params: Promise<{ trunk: string; number: string }> }) {
  const { trunk, number } = await params;
  const view = await orMissing(get<PullView>(`/api/trunks/${encodeURIComponent(trunk)}/pulls/${encodeURIComponent(number)}`));
  return <PullDetail trunk={trunk} view={view} />;
}
