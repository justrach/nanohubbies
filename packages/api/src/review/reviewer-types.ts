export type ReviewerStatus = "writer" | "no_write" | "unavailable";
/** Trusted membership read, never accepted from HTTP JSON. */
export interface ReviewerMembership {
  accounts: Record<string,ReviewerStatus>;
  checkedAt: number;
  expiresAt: number;
}
