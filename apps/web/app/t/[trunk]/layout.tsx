import { bootstrap, orMissing } from "@/server/api";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { TrunkShell } from "@/trunk/Shell";
import { TRUNK_NAME } from "@/trunk/paths";

/** Every page of a trunk shares its bar, its tabs and its live feed. */
export default async function TrunkLayout({ children, params }: { children: ReactNode; params: Promise<{ trunk: string }> }) {
  const { trunk } = await params;
  if (!TRUNK_NAME.test(trunk)) notFound();
  return <TrunkShell trunk={trunk} initial={await orMissing(bootstrap(trunk))}>{children}</TrunkShell>;
}
