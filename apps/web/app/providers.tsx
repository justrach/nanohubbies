"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { RouterBridge } from "@/lib/router";
import { SessionProvider } from "@/lib/session";

export function Providers({ children }: { children: ReactNode }) {
  const workspace = /^\/t\/[^/]+/.test(usePathname() ?? "");
  return (
    <SessionProvider inactive={workspace}>
      <RouterBridge />
      {children}
    </SessionProvider>
  );
}
