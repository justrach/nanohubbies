"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode, type ComponentProps } from "react";

let push: ((to: string) => void) | null = null;

/** Lets `navigate` reach the Next.js router from outside a component. */
export function RouterBridge() {
  const router = useRouter();
  useEffect(() => {
    push = (to) => router.push(to);
    return () => {
      push = null;
    };
  }, [router]);
  return null;
}

export function navigate(to: string) {
  if (push) push(to);
  else location.assign(to);
}

export function Link({ to, children, ...props }: Omit<ComponentProps<typeof NextLink>, "href"> & { to: string; children: ReactNode }) {
  return (
    <NextLink href={to} {...props}>
      {children}
    </NextLink>
  );
}
