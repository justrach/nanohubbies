"use client";

import { useLayoutEffect } from "react";

// Light first; a stored choice wins before paint.
const THEME = `try{const t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch{}`;

/** Sets the stored theme before paint. Served, the script does it. A page the
 *  browser renders itself (a not-found page is) never runs a script, so there
 *  it is inert data and the layout effect does it, still before paint. */
export function ThemeScript() {
  useLayoutEffect(() => {
    try {
      const t = localStorage.getItem("theme");
      if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
    } catch { /* storage unavailable: stay light */ }
  }, []);
  return <script suppressHydrationWarning type={typeof window === "undefined" ? undefined : "text/plain"} dangerouslySetInnerHTML={{ __html: THEME }} />;
}
