"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Button } from "@/components/controls";
export default function InvitePage() {
  const { user } = useSession(),
    router = useRouter();
  const [invite, setInvite] = useState<{ trunk: string; token: string } | null>(
      null,
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(location.hash.slice(1));
    setInvite({ trunk: q.get("trunk") ?? "", token: q.get("token") ?? "" });
  }, []);
  return (
    <main className="mx-auto max-w-xl space-y-5 px-5 py-12">
      <h1 className="text-2xl font-semibold">Repository invitation</h1>
      <p>
        Accept access to <strong>{invite?.trunk || "this repository"}</strong>.
      </p>
      {user ? (
        <>
          <p className="text-sm text-muted">
            Signed in as <code>{user.id}</code>. This must match the invited
            account.
          </p>
          <Button
            disabled={busy || !invite?.token}
            onClick={() => {
              setBusy(true);
              setError("");
              void api("/api/invitations/accept", { body: invite })
                .then(() => {
                  history.replaceState(null, "", "/invite");
                  router.push(`/t/${encodeURIComponent(invite!.trunk)}`);
                })
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Accept invitation
          </Button>
        </>
      ) : (
        <p>Sign in, then reopen your invitation link to accept it.</p>
      )}
      {error && (
        <p role="alert" className="text-critical">
          {error}
        </p>
      )}
    </main>
  );
}
