# Private CLI batch reviews — 2026-10-28 JST

CLI candidate **0.4.13** supports collecting private hunk feedback, inspecting
the pending review, editing/removing comments, discarding it and submitting all
comments with a Comment/Approve/Request changes verdict. The
[CLI contract](../hosting-cli.md#private-pending-reviews) documents the commands.
The [receipt](cli-pending-receipt.json) records the candidate module checksum and
runtime source digest. This is local acceptance using real Workers, SQLite DOs,
D1 and Git, not production acceptance or a public release.

## Verified behavior

The source CLI and the actual standalone distribution built by
`packages/cli/scripts/build.mjs` run as separate Bun processes against the real
application fixture. The packaged manifest's byte length and SHA-256 are checked
before execution. Both flows seed ordinary Git history, open a protected PR and
collect comments across two changed files. Diff excerpts come from server
validation; nonexistent lines and spoofed identity/provenance fields are denied.

Each CLI credential owns a private review workspace under its account. Another
credential issued to that same account, the browser account, another account,
read-only credentials and ordinary PR/list output cannot read or edit it.
Browser drafts remain separate and preserved. The credential needs explicit
`reviews:write` and current writer access even for a draft read.

All mutations use the observed draft revision. Stale edits fail before writing;
server-side stale revisions fail independently. Editing, removal and multi-file
collection preserve original anchors. Drafts survive Worker restart. A push
while feedback is pending makes publication fail; replacing submitted IDs with
the latest head cannot make the old draft pass. Failed publication leaves all
feedback private and intact. Discard does not touch the browser draft.

Submission atomically publishes the verdict, all anchored threads and a receipt.
Published data identifies the owning account and the issuing CLI credential.
An exact retry returns the original review without duplicate threads; another
credential or changed payload cannot reuse its receipt. Store tests also force
a later-comment failure and verify rollback of the verdict, earlier comments
and draft removal together.

Current writer demotion denies draft reads/writes. Archive retains readable
drafts for current writers but denies every mutation. Expired/revoked credentials
are denied. Author self-approval never counts; a published Request changes
blocks the protected merge, and unresolved published threads still block it
after a later independent approval. After the expected resolution, the real
protected merge succeeds and an independent clone passes `git fsck --strict`
with the exact expected commit.

CLI draft access uses separate RPC entrypoints. A browser-only older receiver
cannot silently ignore the credential scope and read or mutate a browser draft.
The compatibility test exercises read/edit/discard/submit against a receiver
with only the old browser handlers: all return retryable 503 and invoke none of
those handlers. The existing browser read still works. There is no storage
migration: browser draft keys and receipts keep their original account keys.

## Checks and limits

- Pinned tsrs passes for the API.
- All **50 CLI tests** pass, including unsafe/mixed options, required revisions
  and no automatic retry after a lost publication response.
- All **316 API unit tests** pass, including eight pending-review cases.
- The full repository regression passes **247 unit cases** and its real
  Worker/Git/protection/recovery acceptance chain, including source and packaged
  pending-review checks.
- Frozen offline Bun installation validates the updated package version and
  lockfile without dependency changes.

Public API/CLI calls, production credentials and production data are not used
by these acceptance fixtures. Test credentials are revoked and temporary local
resources are disposed. A separate public read observes HTTP 200 and the
expected existing main Worker version at `2026-10-28T03:50:40Z`.

The candidate is **not deployed or pushed to GitHub**. The published CLI remains
0.4.12. Fresh hosted release acceptance remains required. The broader recovery,
Actions, staging and capacity gates in [production readiness](../production-readiness.md)
remain open; these tests do not establish production traffic readiness.
