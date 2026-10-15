import { ChevronDown, ExternalLink, LogOut } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useSession, useSignInUrl } from "@/lib/session";
import { GhAvatar } from "@/pr/people";

/** Who you are, or how to sign in. */
export function Account({ developmentOnly = false }: { developmentOnly?: boolean } = {}) {
  const { user, providers, loaded, refresh } = useSession();
  const signIn = useSignInUrl();
  const router = useRouter();
  const [devName, setDevName] = useState("");
  const [asking, setAsking] = useState(false);
  if (!loaded) return null;

  if (user) {
    return (
      <details className="relative text-xs">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1 hover:bg-wash" aria-label="Account menu">
          <span className="grid size-7 place-items-center rounded-full bg-wash font-semibold" aria-hidden>{user.name.slice(0, 1).toUpperCase()}</span>
          <span className="max-w-32 truncate">{user.name}</span><ChevronDown size={12} />
        </summary>
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-line bg-surface p-4 shadow-lg">
          <p className="mb-1 text-muted">Signed in with {user.provider === "codegraff" ? "Codegraff" : user.provider}</p>
          <p className="mb-4 font-medium">{user.name}</p>
          {user.provider === "codegraff" && <div className="mb-4"><p className="mb-2 text-muted">GitHub connection</p><GitHub /></div>}
          <button type="button" onClick={() => api("/api/auth/signout", { method: "POST" }).then(refresh)} className="flex w-full items-center gap-2 border-t border-line pt-3 text-ink-2 hover:text-ink"><LogOut size={14} />Sign out</button>
        </div>
      </details>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {providers.dev &&
        (asking ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void api("/api/auth/dev", { body: { name: devName } }).then(async () => {
                await refresh();
                router.refresh();
              });
            }}
            className="flex items-center gap-1.5"
          >
            <input
              autoFocus
              value={devName}
              onChange={(e) => setDevName(e.target.value)}
              placeholder="Your name"
              className="w-28 rounded-md border border-line bg-page px-2 py-1 text-xs text-ink outline-none placeholder:text-muted focus:border-axis"
            />
            <button type="submit" className="rounded-md border border-line px-2 py-1 text-xs text-ink hover:bg-wash">
              Enter
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setAsking(true)} className="rounded-md px-2 py-1 text-xs whitespace-nowrap text-ink-2 hover:bg-wash hover:text-ink">
            Dev login
          </button>
        ))}
      {providers.codegraff && !developmentOnly && (
        <a href={signIn} className="rounded-md bg-ink px-3 py-1.5 text-xs font-medium whitespace-nowrap text-page hover:opacity-90">
          Sign in
        </a>
      )}
    </div>
  );
}

/** The GitHub account connected to your Codegraff account, or a way to connect
 *  one. Connecting happens on Codegraff, so it counts there and here alike. */
function GitHub() {
  const { github } = useSession();
  if (!github) return null;
  if (github.connected) {
    const login = github.login ?? "";
    return (
      <span title="GitHub, connected through Codegraff" className="mr-1 flex items-center gap-1.5 text-ink-2">
        <GhAvatar person={{ login, avatar: login ? `https://avatars.githubusercontent.com/${login}` : "", bot: false }} size={18} />
        {login || "GitHub"}
      </span>
    );
  }
  if (!github.connect) return null;
  return (
    <a
      href={github.connect}
      target="_blank"
      rel="noreferrer"
      title="Connects GitHub to your Codegraff account. Come back here when it is done."
      className="mr-1 flex items-center gap-1 rounded-md border border-line px-2 py-1 text-ink hover:bg-wash"
    >
      Connect GitHub <ExternalLink size={11} aria-hidden />
    </a>
  );
}
