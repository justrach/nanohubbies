import { settings } from "../auth";

export interface Membership {
  id: string;
  name: string;
  role: "owner" | "member";
}
export interface MembershipEvidence {
  issuer: string;
  subject: string;
  audience: string;
  checkedAt: number;
  rooms: Membership[];
  nextCursor: string | null;
}
export class TeamError extends Error {
  constructor(
    message: string,
    readonly status = 503,
    readonly code = "team_verification_unavailable",
  ) {
    super(message);
  }
}
export const ROOM_ID = /^room_[0-9a-f]{24}$/;

/** The provider's subject is NOT Better Auth's local user ID. Only the
 * verified OAuth account linkage can translate between them. */
export async function linkedSubject(
  env: Env,
  ownerId: string,
): Promise<string> {
  if (!ownerId.startsWith("codegraff:"))
    throw new TeamError(
      "Sign in with Codegraff to use a team workspace",
      403,
      "codegraff_required",
    );
  const row = await env.AUTH_DB.prepare(
    'SELECT "accountId" FROM "account" WHERE "userId" = ? AND "providerId" = ?',
  )
    .bind(ownerId.slice("codegraff:".length), "codegraff")
    .first<{ accountId: string }>();
  if (!row?.accountId)
    throw new TeamError(
      "Reconnect your Codegraff account to verify ownership",
      403,
      "codegraff_required",
    );
  return row.accountId;
}

export async function fetchMemberships(
  env: Env,
  origin: string,
  accessToken: string,
  subject: string,
  ids: string[] | null,
  after = "",
): Promise<MembershipEvidence> {
  const config = settings(env, new URL(origin));
  const endpoint = new URL(`${config.issuer}/api/oauth/rooms`);
  if (after) endpoint.searchParams.set("after", after);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: ids ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: ids ? JSON.stringify({ roomIds: ids }) : undefined,
      signal: AbortSignal.timeout(5000),
      redirect: "manual",
    });
  } catch {
    throw new TeamError(
      "Codegraff membership verification is unavailable; access was not granted",
    );
  }
  if (response.status === 401 || response.status === 403)
    throw new TeamError(
      "Reconnect Codegraff and allow shared-room membership access",
      403,
      "team_consent_required",
    );
  if (!response.ok)
    throw new TeamError(
      "Codegraff membership verification is unavailable; access was not granted",
    );
  const data = (await response.json()) as MembershipEvidence;
  if (
    data.issuer !== config.issuer ||
    data.subject !== subject ||
    data.audience !== config.clientId ||
    !Number.isFinite(data.checkedAt) ||
    Math.abs(Date.now() - data.checkedAt) > 30_000 ||
    !Array.isArray(data.rooms) ||
    data.rooms.length > 500 ||
    data.rooms.some(
      (r) =>
        !ROOM_ID.test(r.id) ||
        typeof r.name !== "string" ||
        !["owner", "member"].includes(r.role),
    ) ||
    !(
      data.nextCursor === null ||
      (typeof data.nextCursor === "string" && ROOM_ID.test(data.nextCursor))
    )
  )
    throw new TeamError(
      "Codegraff returned membership evidence for a different or invalid identity",
      403,
      "identity_mismatch",
    );
  // Authorize only the room IDs explicitly requested; pagination is discovery only.
  if (
    ids &&
    (data.nextCursor !== null || data.rooms.some((r) => !ids.includes(r.id)))
  )
    throw new TeamError("Codegraff returned unexpected membership evidence");
  return data;
}
