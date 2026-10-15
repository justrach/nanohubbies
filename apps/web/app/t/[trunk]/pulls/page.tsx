import type { Metadata } from "next";
import { Pulls } from "@/trunk/review/Pulls";
import { get, orMissing } from "@/server/api";
import type { ReviewSnapshot } from "@swarm/api/review";

type Props = { params: Promise<{ trunk: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Pull requests · ${(await params).trunk}` };
}

export default async function Page({ params }: Props) {
  const { trunk } = await params;
  const initial = await orMissing(get<ReviewSnapshot>(`/api/trunks/${encodeURIComponent(trunk)}/pulls`));
  return <Pulls trunk={trunk} initial={initial} />;
}
