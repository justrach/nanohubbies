"use client";

import { useEffect } from "react";

/** A page that failed to render: what went wrong, and a way to try again. */
export default function TrunkError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <main className="mx-auto max-w-xl px-5 py-24 text-center">
      <h1 className="text-xl font-semibold tracking-tight text-ink">This page could not load</h1>
      <p className="mt-2 text-sm break-words text-ink-2">{error.message || "Something went wrong reading the trunk."}</p>
      <button type="button" onClick={reset} className="mt-6 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-wash">
        Try again
      </button>
    </main>
  );
}
