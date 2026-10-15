"use client";

import { Button } from "@/components/controls";
import { LinkButton } from "@/components/ui";
import { usePushTokens } from "./usePushTokens";

export function TokenList({
  trunk,
  credentials,
  showError,
}: {
  trunk: string;
  credentials: ReturnType<typeof usePushTokens>;
  showError: boolean;
}) {
  const { tokens, busy, revoke, error } = credentials;
  return (
    <section className="mt-8 border-t border-line pt-5">
      <h2 className="text-sm font-semibold">Push tokens for this trunk</h2>
      <ul className="mt-2 divide-y divide-line">
        {tokens.map((token) => (
          <li
            key={token.id}
            className="flex flex-wrap items-center gap-3 py-3 text-xs"
          >
            <span className="font-medium">{token.label}</span>
            <span className="text-muted">
              {token.usedAt ? "Authentication observed" : "Not used yet"}
            </span>
            <Button
              size="sm"
              className="ml-auto"
              disabled={!!busy}
              onClick={() => void revoke(token.id)}
            >
              {busy === token.id ? "Revoking…" : "Revoke"}
            </Button>
          </li>
        ))}
      </ul>
      <LinkButton size="sm" variant="ghost" href={`/t/${trunk}/connect`}>
        Advanced connection options
      </LinkButton>
      <LinkButton size="sm" variant="ghost" href={`/t/${trunk}/room`}>
        Open agent room
      </LinkButton>
      {showError && error && (
        <p role="alert" className="mt-2 text-xs text-critical">
          {error}
        </p>
      )}
    </section>
  );
}
