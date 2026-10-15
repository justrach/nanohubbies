import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { repositoryCache } from "./repository-cache";
import { api } from "./api";

export interface User {
  id: string;
  name: string;
  email: string | null;
  provider: "codegraff" | "dev";
}

/** GitHub as connected to the person's Codegraff account. */
export interface GitHubLink {
  connected: boolean;
  /** the GitHub account it reads as */
  login?: string;
  /** where to connect it, on Codegraff */
  connect?: string;
}

export interface Session {
  user: User | null;
  providers: { codegraff: boolean; dev: boolean };
  loaded: boolean;
  /** null until known, and for anyone not signed in with Codegraff */
  github: GitHubLink | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<Session>({ user: null, providers: { codegraff: false, dev: false }, loaded: false, github: null, refresh: async () => {} });

export function SessionProvider({ children, initial, inactive = false }: { children: ReactNode; initial?: Pick<Session, "user" | "providers">; inactive?: boolean }) {
  const [state, setState] = useState<Omit<Session, "refresh" | "github">>(initial ? { ...initial, loaded: true } : { user: null, providers: { codegraff: false, dev: false }, loaded: false });
  const [github, setGithub] = useState<GitHubLink | null>(null);
  const revision = useRef(0);
  const linkFor = useCallback(async (user: User | null) => {
    const at = ++revision.current;
    const link = user?.provider === "codegraff" ? await api<GitHubLink>("/api/github/connection").catch(() => null) : null;
    if (at === revision.current) setGithub(link);
  }, []);
  const refresh = useCallback(async () => {
    const me = await api<{ user: User | null; providers: Session["providers"] }>("/api/auth/me").catch(() => null);
    if (!me?.user) repositoryCache.clear();
    setState({ user: me?.user ?? null, providers: me?.providers ?? { codegraff: false, dev: false }, loaded: true });
    await linkFor(me?.user ?? null);
  }, [linkFor]);
  useEffect(() => {
    if (inactive) return;
    if (initial) {
      setState({ ...initial, loaded: true });
      void linkFor(initial.user);
    } else void refresh();
    return () => { revision.current++; };
  }, [inactive, initial, refresh, linkFor]);

  // GitHub gets connected on Codegraff, in another tab: look again on the way back.
  useEffect(() => {
    if (inactive || !github || github.connected) return;
    const again = () => void linkFor(state.user);
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [inactive, github, state.user, linkFor]);

  return <Ctx.Provider value={{ ...state, github, refresh }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

const SIGN_IN = "/dashboard";

/** Start sign-in; the API sends new and returning users to the dashboard. */
export const signInUrl = () => SIGN_IN;

/** Every sign-in enters through the dashboard, including server-rendered links. */
export function useSignInUrl() {
  return SIGN_IN;
}

export { signinError } from "./signin";
