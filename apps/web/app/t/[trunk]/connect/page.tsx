import type { Metadata } from "next";
import { origin } from "@/server/api";
import { ConnectPage } from "@/trunk/connect/ConnectPage";

type Props = { params: Promise<{ trunk: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Connect an agent · ${(await params).trunk}` };
}

export default async function Page({ params }: Props) {
  const [{ trunk }, here] = await Promise.all([params, origin()]);
  return <ConnectPage trunk={trunk} origin={here} />;
}
