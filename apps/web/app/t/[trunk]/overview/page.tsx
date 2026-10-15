import { bootstrap, orMissing } from "@/server/api";
import { TrunkOverview } from "@/trunk/overview/TrunkOverview";
export const metadata = { title: "Overview" };
export default async function Page({
  params,
}: {
  params: Promise<{ trunk: string }>;
}) {
  await orMissing(bootstrap((await params).trunk));
  return <TrunkOverview />;
}
