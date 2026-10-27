import { get, orMissing } from "@/server/api";
import { Actions } from "@/trunk/review/Actions";
import type { ActionRun as Run, DeploymentEnvironment } from "@swarm/api/review";
export const metadata = { title: "Actions" };
export default async function Page({
  params,
}: {
  params: Promise<{ trunk: string }>;
}) {
  const { trunk } = await params;
  const initial = await orMissing(
    get<{ runs: Run[]; canConfigure: boolean; canRequestDeployment?:boolean; environments?:DeploymentEnvironment[] }>(
      `/api/trunks/${trunk}/repository`,
    ),
  );
  return <Actions trunk={trunk} initial={initial} />;
}
