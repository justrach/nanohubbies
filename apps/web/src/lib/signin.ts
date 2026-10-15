// Kept apart from ./session, which holds state, so server pages can use it too.

/** A sign-in that failed comes back with a code; this says it in words. */
export function signinError(code: string | null): string | null {
  if (!code) return null;
  if (code === "signup_disabled" || code === "unable_to_create_user")
    return "Codegraff has no account for that email yet. Sign up on codegraff.com, then sign in here.";
  if (code === "email_not_verified") return "Codegraff has not verified that email. Verify it there, then try again.";
  if (code === "account_not_linked") return "That email's Codegraff account could not be linked here. Sign in on codegraff.com once, then try again.";
  return `Sign in with Codegraff did not finish (${code.replace(/_/g, " ")}). Try again.`;
}
