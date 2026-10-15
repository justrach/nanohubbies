import type { Metadata } from "next";
import type { ReleaseList } from "@swarm/api/releases";
import { get, orMissing } from "@/server/api";
import { Releases } from "@/trunk/releases/Releases";

type Props = { params: Promise<{ trunk: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Releases · ${(await params).trunk}` };
}

export default async function Page({ params }: Props) {
  const { trunk } = await params;
  const initial = await orMissing(get<ReleaseList>(`/api/trunks/${encodeURIComponent(trunk)}/releases`));
  return <Releases trunk={trunk} initial={initial} />;
}
