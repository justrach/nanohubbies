/** Lifecycle states never count as terminal check conclusions. */
export const checkConclusions = ["success", "neutral", "skipped", "failure", "cancelled", "timed_out", "action_required", "stale"] as const;
export type CheckState = typeof checkConclusions[number];
export function validConclusion(value: unknown): value is CheckState {
  return typeof value === "string" && (checkConclusions as readonly string[]).includes(value);
}
export function passingConclusion(state: unknown) {
  return state === "success" || state === "neutral" || state === "skipped";
}
/** Legacy staging is a verified deployment gate, not an ordinary check name.
 * Neutral/skipped must never replace its deployment/version/acceptance receipt. */
export function passingCheck(result: { name: string; state: unknown }) {
  return result.name === "staging" ? result.state === "success" : passingConclusion(result.state);
}
/** Report blocking conclusions first, otherwise retain neutral/skipped labels
 * instead of presenting unexecuted work as success. */
export function runConclusion(results: readonly { state: unknown }[]): CheckState | "unknown" | null {
  if (!results.length) return null;
  if (results.some(result => !validConclusion(result.state))) return "unknown";
  for (const state of ["action_required", "timed_out", "failure", "cancelled", "stale", "neutral", "skipped", "success"] as const)
    if (results.some(result => result.state === state)) return state;
  return "unknown";
}
export function conclusionLabel(state: CheckState | "unknown") {
  return ({ success: "Succeeded", neutral: "Neutral", skipped: "Skipped", failure: "Failed", cancelled: "Cancelled", timed_out: "Timed out", action_required: "Action required", stale: "Stale", unknown: "Unknown conclusion" })[state];
}
