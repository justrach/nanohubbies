import type { Metadata } from "next";
import { origin } from "@/server/api";
import { SetupPage } from "@/onboarding/SetupPage";

type Props = { params: Promise<{ trunk: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Setup · ${(await params).trunk}` };
}
export default async function Page({ params }: Props) {
  const [{ trunk }, here] = await Promise.all([params, origin()]);
  return <SetupPage trunk={trunk} origin={here} />;
}
