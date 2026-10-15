import type { Metadata } from "next";
import { origin } from "@/server/api";
import { AgentRoom } from "@/trunk/room/AgentRoom";

type Props = { params: Promise<{ trunk: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Agent room · ${(await params).trunk}` };
}
export default async function Page({ params }: Props) {
  const [{ trunk }, here] = await Promise.all([params, origin()]);
  return <AgentRoom trunk={trunk} origin={here} />;
}
