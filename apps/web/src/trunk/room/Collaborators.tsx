"use client";
import { useEffect, useState } from "react";
import { api, trunkPath } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/controls";
import { Card, LinkButton } from "@/components/ui";
import { field } from "../review/shared";
import {RepositoryArchive} from "./RepositoryArchive";
import {useTrunk} from "../context";
import { RepositoryIdentity } from "./RepositoryIdentity";
import {RepositoryDefaultBranch} from "./RepositoryDefaultBranch";
import {RepositoryMergeSettings} from './RepositoryMergeSettings';
import { RepositorySecrets } from "./RepositorySecrets";
type Role = "reader" | "writer" | "admin" | "owner";
type Members = {
  members: { userId: string; role: Role }[];
  invitations: { id: string; userId: string; role: Role; expires: number }[];
  canManage: boolean;
  currentRole?: Role;
  managedExternally?: boolean;
};
export function Collaborators({ trunk }: { trunk: string }) {
  const { user } = useSession();
  const {readOnly}=useTrunk();
  const [data, setData] = useState<Members | null>(null),
    [error, setError] = useState(""),
    [link, setLink] = useState(""),
    [busy, setBusy] = useState(false);
  const path = trunkPath(trunk) + "/collaborators";
  const load = () => api<Members>(path).then(setData);
  useEffect(() => {
    void api<Members>(path)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [path]);
  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mb-6 space-y-4">
      <fieldset disabled={readOnly} className="min-w-0"><Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-xl font-semibold text-ink">Repository access</h1><LinkButton size="sm" href={`/t/${trunk}/settings/rules`}>Rules and protection</LinkButton></div>
        {user && (
          <p className="text-xs text-muted">
            Your account ID:{" "}
            <code className="select-all break-all text-ink">{user.id}</code>. Share this
            ID with the repository owner to receive an invitation.
          </p>
        )}
        {data?.managedExternally ? (
          <p className="text-sm text-muted">
            This workspace uses externally managed team access. Manage
            membership in its Codegraff room.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">
              Readers can browse and clone. Writers can push and review changes.
              Admins can manage collaborators, branch protection and secrets. The owner controls
              repository deletion and staging approval.
            </p>
            <ul className="divide-y divide-line">
              {data?.members.map((m) => (
                <li
                  className="flex flex-wrap items-center gap-3 py-3 text-sm"
                  key={m.userId}
                >
                  <code className="flex-1 break-all">{m.userId}</code>
                  {data.canManage &&
                  m.role !== "owner" &&
                  (data.currentRole === "owner" || m.role !== "admin") ? (
                    <>
                      <select
                        aria-label={`Role for ${m.userId}`}
                        className={field}
                        style={{ width: "auto" }}
                        disabled={busy}
                        value={m.role}
                        onChange={(e) =>
                          void act(() =>
                            api(path, {
                              method: "PATCH",
                              body: { userId: m.userId, role: e.target.value },
                            }),
                          )
                        }
                      >
                        <option value="reader">Reader</option>
                        <option value="writer">Writer</option>
                        {data.currentRole === "owner" && (
                          <option value="admin">Admin</option>
                        )}
                      </select>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void act(() =>
                            api(path, {
                              method: "PATCH",
                              body: { userId: m.userId, role: null },
                            }),
                          )
                        }
                      >
                        Remove
                      </Button>
                    </>
                  ) : (
                    <span className="text-muted">{m.role}</span>
                  )}
                </li>
              ))}
            </ul>
            {data?.canManage && (
              <>
                <form
                  className="flex flex-wrap items-end gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget,
                      values = new FormData(form);
                    setLink("");
                    void act(async () => {
                      const invite = await api<{ token: string }>(path, {
                        body: {
                          userId: values.get("userId"),
                          role: values.get("role"),
                        },
                      });
                      setLink(
                        `${location.origin}/invite#${new URLSearchParams({ trunk, token: invite.token })}`,
                      );
                      form.reset();
                    });
                  }}
                >
                  <label className="min-w-60 flex-1 text-xs text-muted">
                    Recipient account ID
                    <input
                      className={field}
                      name="userId"
                      required
                      placeholder="codegraff:…"
                    />
                  </label>
                  <label className="text-xs text-muted">
                    Role
                    <select className={field} name="role" defaultValue="writer">
                      <option value="reader">Reader</option>
                      <option value="writer">Writer</option>
                      {data.currentRole === "owner" && (
                        <option value="admin">Admin</option>
                      )}
                    </select>
                  </label>
                  <Button type="submit" disabled={busy}>
                    Create invitation
                  </Button>
                </form>
                {link && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted">
                      Send this link to the recipient. It expires in seven days
                      and works only for their account. It is shown once.
                    </p>
                    <input
                      aria-label="Invitation link"
                      className={field}
                      readOnly
                      value={link}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <Button
                      onClick={() => void navigator.clipboard.writeText(link)}
                    >
                      Copy invitation
                    </Button>
                    <Button onClick={() => setLink("")}>Hide</Button>
                  </div>
                )}
                {data.invitations.map((i) => (
                  <p
                    className="flex flex-wrap items-center gap-3 text-xs"
                    key={i.id}
                  >
                    <code className="break-all">{i.userId}</code>
                    <span>
                      {i.role} · expires{" "}
                      {new Date(i.expires).toLocaleDateString()}
                    </span>
                    <Button
                      disabled={
                        busy ||
                        (data.currentRole !== "owner" && i.role === "admin")
                      }
                      onClick={() =>
                        void act(() =>
                          api(path + "/" + i.id, { method: "DELETE" }),
                        )
                      }
                    >
                      Cancel invitation
                    </Button>
                  </p>
                ))}
              </>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error}
          </p>
        )}
      </Card></fieldset>
      {data?.currentRole === "owner" && <RepositoryIdentity trunk={trunk} />}
      {data&&<RepositoryDefaultBranch trunk={trunk} canEdit={["owner","admin"].includes(data.currentRole??"")}/>}
      {data&&<RepositoryMergeSettings trunk={trunk} canEdit={["owner","admin"].includes(data.currentRole??"")}/>}
      {data?.canManage && <RepositorySecrets trunk={trunk} />}
      <RepositoryArchive trunk={trunk}/>
    </div>
  );
}
