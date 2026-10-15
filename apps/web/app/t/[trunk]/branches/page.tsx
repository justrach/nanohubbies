import type { ReviewSnapshot } from "@swarm/api/review";
import { get, orMissing } from "@/server/api";
import { Branches } from "@/trunk/review/Branches";

export const metadata = { title: "Branches" };

export default async function Page({ params, searchParams }: {
  params: Promise<{ trunk: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ trunk }, query] = await Promise.all([params, searchParams]);
  const initial = await orMissing(get<ReviewSnapshot>(`/api/trunks/${encodeURIComponent(trunk)}/branches`));
  return <Branches trunk={trunk} initial={initial} selected={typeof query.name === "string" ? query.name : ""} path={typeof query.path === "string" ? query.path : ""} />;
}
