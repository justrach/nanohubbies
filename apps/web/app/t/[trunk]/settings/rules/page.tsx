import type { ReviewSnapshot } from "@swarm/api/review";
import { get, orMissing } from "@/server/api";
import { RepositoryRules } from "@/trunk/review/RepositoryRules";
export const metadata={title:"Repository rules"};
export default async function Page({params}:{params:Promise<{trunk:string}>}) {
  const {trunk}=await params;
  const initial=await orMissing(get<ReviewSnapshot>(`/api/trunks/${encodeURIComponent(trunk)}/branches`));
  return <RepositoryRules trunk={trunk} initial={initial}/>;
}
