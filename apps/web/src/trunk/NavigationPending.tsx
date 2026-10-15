"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/** A thin bar across the top while a followed link's page is on its way. A
 *  trunk page renders whole before it is sent, so its status can say when the
 *  thing asked for is not there; this is what shows it is coming meanwhile. */
export function NavigationPending() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString();
  const [pending, setPending] = useState(false);

  useEffect(() => setPending(false), [pathname, search]);
  useEffect(() => {
    // Captured: a client-side link cancels the browser's own navigation, so by
    // the time the click bubbles here it always reads as prevented.
    const follow = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || a.target || a.hasAttribute("download")) return;
      const to = new URL(a.href, location.href);
      if (to.origin !== location.origin || (to.pathname === location.pathname && to.search === location.search)) return;
      setPending(true);
    };
    const back = () => setPending(false);
    document.addEventListener("click", follow, true);
    window.addEventListener("popstate", back);
    return () => {
      document.removeEventListener("click", follow, true);
      window.removeEventListener("popstate", back);
    };
  }, []);
  // A navigation that never lands (an error, a full-page load) must not leave it on.
  useEffect(() => {
    if (!pending) return;
    const t = window.setTimeout(() => setPending(false), 15000);
    return () => window.clearTimeout(t);
  }, [pending]);

  return <div className="navigation-pending" data-on={pending || undefined} aria-hidden />;
}
