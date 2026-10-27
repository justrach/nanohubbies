"use client";
import { useState } from "react";
import { GitBranch, ShieldCheck } from "lucide-react";
import type { ReviewSnapshot } from "@swarm/api/review";
import { api, trunkPath } from "@/lib/api";
import { Button } from "@/components/controls";
import { Card } from "@/components/ui";
import { field, Notice } from "./shared";
import {RequiredEnvironments} from "./DeploymentEnvironments";
import { CheckSources } from "./CheckSources";
type Policy = NonNullable<ReviewSnapshot["policies"]>[number];
const defaults: Policy = {
  branch: "main",
  pullRequest: true,
  approvals: 1,
  checks: [],
  beforeOpen: [],
  preventForce: true,
  preventDelete: true,
  dismissStaleReviews: true,
};
const options = [
  ["requireSignedCommits","Require signed commits","Require verified SSH or OpenPGP signatures on introduced commits. Manage public keys in your account settings."],
  [
    "pullRequest",
    "Require a pull request before merging",
    "All changes must come through a pull request before they reach a matching branch.",
  ],
  [
    "requireCodeOwnerReview",
    "Require review from code owners",
    "Require a current writer listed by Nanohub @handle in the base branch CODEOWNERS file. Git repositories only.",
  ],
  [
    "preventForce",
    "Restrict force pushes",
    "Block history rewrites, with optional exceptions for selected accounts below.",
  ],
  [
    "preventDelete",
    "Block branch deletion",
    "Prevent matching branches from being deleted.",
  ],
  [
    "requireLinearHistory",
    "Require linear history",
    "Reject introduced merge commits. Available for Git repositories.",
  ],
  [
    "dismissStaleReviews",
    "Dismiss stale approvals when the reviewed files change",
    "Automatically dismiss approvals after file or comparison-base changes. Metadata-only commits keep approvals.",
  ],
  [
    "requireLastPushApproval",
    "Require approval of the most recent push",
    "Someone other than the latest pusher must approve the most recent file changes, even when earlier approvals are retained.",
  ],
  [
    "requireConversationResolution",
    "Require conversation resolution before merging",
    "All review conversations, including outdated threads, must be resolved.",
  ],
  [
    "locked",
    "Lock branch",
    "Block all updates and merges, including those by owners and admins.",
  ],
] as const;
export function Protections({
  trunk,
  rules,
  canEdit,
  onChange,
  git,
  sources = [],
  environments = [],
  defaultBranch = "main",
}: {
  trunk: string;
  defaultBranch?: string;
  rules: Policy[];
  canEdit: boolean;
  onChange: (rules: Policy[]) => void;
  git: boolean;
  sources?: NonNullable<ReviewSnapshot["ciSources"]>;
  environments?: NonNullable<ReviewSnapshot["environments"]>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <Card className="repository-protections">
      <header>
        <div>
          <h2>
            <ShieldCheck size={16} aria-hidden />
            Branch protection rules
          </h2>
          <p>
            Protect important branches with review requirements and status
            checks. Matching rules combine, including for owners and admins.
          </p>
        </div>
        {canEdit && <Button onClick={() => setSelected("")}>Add rule</Button>}
      </header>
      <ul className="divide-y divide-line">
        {rules.map((rule) => (
          <li key={rule.branch} className="repository-rule">
            <GitBranch size={18} aria-hidden />
            <div className="min-w-0 flex-1">
              <code>{rule.branch}</code>
              <p>
                {rule.locked
                  ? "Locked"
                  : `${rule.approvals} ${rule.approvals === 1 ? "approval" : "approvals"} · ${rule.checks.length} checks${rule.requireCodeOwnerReview ? " · code owner review" : ""}`}
              </p>
            </div>
            {canEdit && (
              <Button onClick={() => setSelected(rule.branch)}>
                Edit rule
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!rules.length && (
        <p className="px-4 py-6 text-sm text-muted">
          No branch protection rules configured.
        </p>
      )}
      {canEdit && (
        <>
          {selected !== null && (
            <ProtectionForm
              key={selected}
              trunk={trunk}
              git={git}
              defaultBranch={defaultBranch}
              sources={sources}
              environments={environments}
              existing={rules.find((r) => r.branch === selected)}
              onCancel={() => setSelected(null)}
              onSave={(next) => {
                onChange(next);
                setSelected(null);
              }}
            />
          )}
        </>
      )}
    </Card>
  );
}
function ProtectionForm({
  trunk,
  defaultBranch,
  existing,
  onCancel,
  onSave,
  git,
  sources,
  environments,
}: {
  trunk: string;
  defaultBranch: string;
  existing?: Policy;
  onCancel: () => void;
  onSave: (rules: Policy[]) => void;
  git: boolean;
  sources: NonNullable<ReviewSnapshot["ciSources"]>;
  environments:NonNullable<ReviewSnapshot["environments"]>;
}) {
  const [draft, setDraft] = useState<Policy>(existing ? {...existing,dismissStaleReviews:existing.dismissStaleReviews??true} : {...defaults,branch:defaultBranch}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [checks,setChecks]=useState(draft.checks.join(", ")),[beforeOpen,setBeforeOpen]=useState(draft.beforeOpen.join(", "));
  const names=[...new Set([...checks.split(/[\s,]+/),...beforeOpen.split(/[\s,]+/)].filter(Boolean))];
  async function save(method: "PUT" | "DELETE", form?: HTMLFormElement) {
    setBusy(true);
    setError("");
    try {
      const values = form ? new FormData(form) : null;
      const list = (name: string) =>
        String(values?.get(name) ?? "")
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
      const body =
        method === "DELETE"
          ? { branch: draft.branch }
          : {
              ...draft,
              checks: list("checks"),
              beforeOpen: list("beforeOpen"),
              checkSources: draft.checkSources?.filter(pin=>names.includes(pin.name)),
              allowPush: values?.has("restrictPush")
                ? list("allowPush")
                : undefined,
              allowDismiss: values?.has("restrictDismiss") ? list("allowDismiss") : undefined,
              allowForcePush: draft.preventForce&&values?.has("restrictForce") ? list("allowForcePush") : undefined,
            };
      const result = await api<{ policies: Policy[] }>(
        `${trunkPath(trunk)}/protection`,
        { method, body },
      );
      onSave(result.policies);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="repository-protection-form space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save("PUT", e.currentTarget);
      }}
    >
      <Notice error={error} />
      <label className="block space-y-1 text-xs text-muted">
        Branch name or pattern
        <input
          className={field}
          value={draft.branch}
          readOnly={!!existing}
          required
          maxLength={255}
          onChange={(e) => setDraft({ ...draft, branch: e.target.value })}
        />
        <span className="block">
          Examples: main, release/*, team/**. * and ? stay within one path
          segment; ** crosses folders.
        </span>
      </label>
      <fieldset className="repository-rule-options">
        <legend className="sr-only">Protection requirements</legend>
        {options.map(([key, label, description]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={!!draft[key]}
              disabled={!git && (key === "requireCodeOwnerReview" || key === "requireLinearHistory" || key === "requireSignedCommits")}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })}
            />
            <span>
              <strong>{label}</strong>
              <small>{key==="preventForce"&&!git?"Prevent history from being rewritten on matching branches.":description}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {git&&draft.preventForce&&<fieldset className="space-y-3 border-t border-line pt-4">
        <legend className="sr-only">Force-push exceptions</legend>
        <label className="flex items-start gap-2 text-xs text-ink"><input type="checkbox" name="restrictForce" checked={draft.allowForcePush!==undefined} disabled={busy} onChange={event=>setDraft({...draft,allowForcePush:event.target.checked?(draft.allowForcePush??[]):undefined})}/>Allow selected accounts to force push</label>
        <label className="block space-y-1 text-xs text-muted">Allowed force pushers (account IDs, comma separated)<input className={field} name="allowForcePush" defaultValue={draft.allowForcePush?.join(", ")??""} disabled={busy||draft.allowForcePush===undefined} placeholder="codegraff:account-id" aria-describedby="force-permissions-help"/></label>
        <p id="force-permissions-help" className="max-w-[70ch] text-xs leading-5 text-muted">These accounts still need repository write access. Locks, pull requests, checks, signatures, deployment requirements and matching rules still apply. An empty selection allows nobody. Matching force-push restrictions combine.</p>
      </fieldset>}
      {draft.dismissStaleReviews===false&&<p className="text-xs leading-5 text-muted">Earlier approvals carry forward after files change. Require approval of the most recent push if someone must review the latest changes before merging.</p>}
      {draft.requireCodeOwnerReview && <p className="text-xs leading-5 text-muted">Owners need repository write access. Team and email owners are not mapped yet. Files without assigned owners add no code owner approval requirement.</p>}
      <label className="block max-w-xs space-y-1 text-xs text-muted">
        Required independent approvals
        <input
          type="number"
          className={field}
          min={0}
          max={20}
          value={draft.approvals}
          required
          onChange={(e) =>
            setDraft({ ...draft, approvals: e.target.valueAsNumber })
          }
        />
      </label>
      <label className="block space-y-1 text-xs text-muted">
        Required checks (comma separated)
        <input
          className={field}
          name="checks"
          value={checks}
          onChange={event=>setChecks(event.target.value)}
          disabled={busy}
          placeholder="test, typecheck"
        />
      </label>
      <label className="block space-y-1 text-xs text-muted">
        Checks required before opening a PR
        <input
          className={field}
          name="beforeOpen"
          value={beforeOpen}
          onChange={event=>setBeforeOpen(event.target.value)}
          disabled={busy}
        />
      </label>
      <CheckSources names={names} sources={sources} pins={draft.checkSources??[]} disabled={busy} onChange={checkSources=>setDraft({...draft,checkSources})}/>
      <label className="flex items-center gap-2 text-xs text-ink">
        <input
          type="checkbox"
          name="restrictPush"
          defaultChecked={draft.allowPush !== undefined}
        />
        Restrict updates to selected accounts (empty selection blocks everyone)
      </label>
      <label className="block space-y-1 text-xs text-muted">
        Allowed pushers (account IDs, comma separated)
        <input
          className={field}
          name="allowPush"
          defaultValue={draft.allowPush?.join(", ") ?? ""}
          placeholder="codegraff:account-id"
        />
      </label>
      <fieldset className="space-y-3 border-t border-line pt-4">
        <legend className="sr-only">Review dismissal permissions</legend>
        <label className="flex items-start gap-2 text-xs text-ink">
          <input type="checkbox" name="restrictDismiss" defaultChecked={draft.allowDismiss !== undefined} />
          Restrict who can dismiss pull request reviews
        </label>
        <label className="block space-y-1 text-xs text-muted">Allowed review dismissers (account IDs, comma separated)
          <input className={field} name="allowDismiss" defaultValue={draft.allowDismiss?.join(", ") ?? ""} placeholder="codegraff:account-id" aria-describedby="dismiss-permissions-help" />
        </label>
        <p id="dismiss-permissions-help" className="text-xs leading-5 text-muted">Dismissal requires a signed-in human with repository write access and a reason. When restricted, an empty list blocks everyone, including admins. Matching restrictions combine.</p>
      </fieldset>
      {git&&<RequiredEnvironments environments={environments} selected={draft.environments??[]} onChange={environments=>setDraft({...draft,environments})} disabled={busy}/>}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" disabled={busy}>
          Save protection
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        {existing && (
          <Button
            className="repository-danger-button"
            disabled={busy}
            onClick={() => void save("DELETE")}
          >
            Delete rule
          </Button>
        )}
      </div>
    </form>
  );
}
