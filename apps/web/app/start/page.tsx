import type { Metadata } from "next";
import { StartPage } from "@/onboarding/StartPage";
import { get } from "@/server/api";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Create a workspace" };

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await get<{ user: unknown }>("/api/auth/me");
  if (!user) redirect("/dashboard");
  const query = await searchParams;
  return <StartPage initial={typeof query.repo === "string" ? query.repo : ""} />;
}
