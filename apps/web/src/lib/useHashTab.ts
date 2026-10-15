import { useEffect, useState } from "react";

/** The open tab, kept in the URL's hash so a view can be linked to. The first
 *  tab is the page's plain URL. */
export function useHashTab<T extends string>(tabs: readonly T[], first: T): [T, (t: T) => void] {
  const read = () => tabs.find((t) => location.hash === `#${t}`) ?? first;
  const [tab, setTab] = useState<T>(read);
  useEffect(() => {
    const on = () => setTab(read());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (t: T) => {
    history.replaceState(null, "", t === first ? location.pathname : `#${t}`);
    setTab(t);
  };
  return [tab, choose];
}
