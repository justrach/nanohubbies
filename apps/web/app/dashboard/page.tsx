import { get, origin, trunks } from "@/server/api";
import { WorkspaceDashboard } from "@/dashboard/WorkspaceDashboard";
import { signinError } from "@/lib/signin";
import type { User } from "@/lib/session";

export const metadata = { title: "Workspaces" };
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const query = await searchParams;
  const error = signinError(typeof query.error === "string" ? query.error : null);
  const apiOrigin = process.env.NODE_ENV === "development"
    ? process.env.SWARM_API ?? "http://localhost:8787"
    : await origin();
  const localApi = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(apiOrigin).hostname);
  try {
    const { user } = await get<{ user: User | null }>("/api/auth/me");
    return <WorkspaceDashboard error={error} localApi={localApi} repositories={user ? await trunks() : []} />;
  } catch {
    return <WorkspaceDashboard error={error} localApi={localApi} repositories={[]} unavailable />;
  }
}
