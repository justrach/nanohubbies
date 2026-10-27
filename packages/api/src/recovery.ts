/** Operator configuration lives outside application backups. This is a new
 * request fence, not a transaction barrier for in-flight work or DO alarms. */
export function recoveryHoldResponse(request: Request, env: unknown): Response | null {
  const value = (env as { NANOHUB_RECOVERY_HOLD?: unknown }).NANOHUB_RECOVERY_HOLD;
  // Only omission and the explicit normal-operation value open traffic.
  // A typo, empty value or unexpected binding type must fail closed.
  if (value === undefined || value === "0") return null;
  return new Response(request.method === "HEAD" ? null : JSON.stringify({
    error: "Nanohub is temporarily unavailable during recovery. Please retry later.",
    code: "recovery_hold",
  }), {
    status: 503,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
      "Retry-After": "60",
      "X-Content-Type-Options": "nosniff",
      "X-Nanohub-Recovery": "hold",
    },
  });
}
