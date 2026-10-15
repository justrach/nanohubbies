import { ExternalLink } from "lucide-react";
import { useSession, useSignInUrl } from "@/lib/session";
import type { Access } from "./types";

const LINK = "flex items-center gap-1 text-ink-2 underline underline-offset-2 hover:text-ink";

/** Whose GitHub the page was read with, or how to read it with your own:
 *  sign in with Codegraff, then connect GitHub there. Your own connection has
 *  its own rate limit instead of the 60 requests an hour everyone shares. */
export function AccessNote({ access }: { access: Access }) {
  const { user, providers } = useSession();
  const signIn = useSignInUrl();
  if (access.as === "you") {
    return <span title={access.login ? `Through Codegraff, as ${access.login}` : "Through Codegraff"}>Read with your GitHub</span>;
  }
  if (access.connect) {
    return (
      <a href={access.connect} target="_blank" rel="noreferrer" className={LINK}>
        Connect GitHub to read with yours <ExternalLink size={11} aria-hidden />
      </a>
    );
  }
  if (!user && providers.codegraff && access.as === "anonymous") {
    return (
      <a href={signIn} className={LINK}>
        Sign in to read with your GitHub
      </a>
    );
  }
  return null;
}
