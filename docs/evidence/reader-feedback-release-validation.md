# Reader feedback release acceptance — 2026-10-31

CLI **0.4.21** and the reader-aware review server are published. Readers can
leave non-counting review opinions, bounded inline comments and isolated private
drafts on open PRs; writers can request reader feedback. Required approval and
change-request authority remain with eligible writers. Authors can submit
Comment only. See the [behavior contract](../reader-feedback.md),
[local implementation evidence](reader-feedback-validation.md),
[design validation](reader-feedback-design-validation.md) and
[release receipt](reader-feedback-release-receipt.json).

## Frozen source and full gates

Implementation commit is `c759bf8b11dcd74d48f51cef34b81c0ce8496d21`.
Frozen source `b04e1eb178e7fb6ffa40e818068b3443901b6d04` includes the additional
exact-distribution acceptance gate and was pushed before promotion. The private
clean build verifies all 1166 tracked source files and 1480 built files. It is
independent of later documentation, catalog and capture changes in the working
checkout.

A fresh Codegraff VM passes all nine gates: frozen offline Bun install, API unit,
complete repository/real Git/recovery, CLI, access, hosting, fixtures, production
build and pinned tsrs checks. Results include 451 API unit cases, 103 CLI cases
and three fresh typed tasks with zero cached tasks. The exact built 0.4.21 CLI
also passes the multi-actor reader workflow over a real local Worker/Git fixture:
feedback immutability, promotion/demotion, retained writer decisions, shared-head
isolation, requests/answers, private browser/CLI ownership, own-thread resolution,
protected writes, rollback, current grants/expiry/archive, restart and merge.
Its manifest/version/bytes/hash are verified before issuing fixture credentials.
An outdated 0.4.20 artifact was rejected at that preflight.

Candidate execution has no external network, control credentials, Docker socket
or deployment secrets. The separate existing CI credential controls this isolated
test; it does not activate the Nanohub Actions account. The provider independently
confirms VM destruction. Exact searches for the two configured Codegraff key
values found neither in 2646 source/built files; this is not a general secret
audit.

## Delivery and promotion

The macOS and Linux CLI distributions match exactly:

```text
version: 0.4.21
bytes:   101486
sha256:  b7b663508a22af420f74ec4caaf16690c9fefb5ba49b2405459bd5452df5885e
```

A disposable asset-only Worker passes 50 exact normal checks and 56 held GET
checks, plus bodyless held HEAD. Held responses are private/no-store 503 with
Retry-After. That Worker has no production resource bindings or custom domain;
its deletion is independently confirmed before production staging.

The staged normal version preserves all 27 bindings. The held version adds only
the recovery-hold binding. Both retain Worker-first routing and the 50000
subrequest limit. The provider confirms a single promotion to main Worker
`b3298aee-d026-4a79-8407-ee8071b5c776` at 100%. Held version is
`f4fd1a8b-e24f-4757-8e13-af04275409a4`. Previous main version is
`16f0ccba-1ecc-421c-a970-b8a62009393e`. Vault was not redeployed and remains
`0dbd5e74-5c41-428f-bc6a-2e8d3ecaef48`. Mutation requests were not automatically
retried after uncertain replies.

[Public delivery](reader-feedback-public-assets.json) passes 58 exact comparisons,
including every built stylesheet, selected scripts/fonts, the installer,
manifest, new module/checksum and all 20 earlier modules/checksums. The installer
SHA remains `838ce409d0ece1c1bef6244ca707401abb7b15c711a44bdf644172963254576c`.
A fresh temporary prefix containing spaces and an apostrophe installs both
`nh` and `nanohub`; both execute 0.4.21 outside the checkout and expose the
expected commands/help. The temporary installation is removed; the user's global
installation is unchanged. Only after public acceptance is the exact 0.4.21 hash
added to the catalog, retaining its 20 older entries. The root distribution
rebuild matches those public bytes. Seventeen focused publication/build tests
pass after the catalog update.

### Retained failed release-path guard

Before promotion, a status-only probe expected the unpublished module URL to
return 404. It returned HTTP 200. Inert version staging began before that failure
was fully classified; production traffic stayed unchanged during staging. The
original failed result is retained, rather than reported as a passing 404 check.

Body verification found Nanohub's HTML “Not here” page, 19099 bytes, SHA-256
`9ed6e5e64fc249b19c38d7b8e3022d64918db46fabddb8bb1e222d2f91dd2e87`.
There was no executable CLI module in that observed response. Promotion required
the saved body classification, unchanged older published modules and exact
pre-promotion state checks. Correct HTTP status for unknown CLI assets remains
separate open hardening; this release does not claim to fix it. The installer
checks byte length/hash and fails closed on an HTML response.

## Production preservation and UI smoke

Immediately before promotion, all nine authenticated canary resources match
their retained baseline. After deployment, old fields in those resources and
five extra review/credential resources remain unchanged. New fields expose the
current review role, suggestion/resolve capabilities and reader protocol v1.

The existing private synthetic repository
`rachxpradhan/prod-codeowners-20261027`, PR #1, is the only write target. The
signed-in PR author saves one private comment on `.github/CODEOWNERS`, after-side
line 1, and publishes it as COMMENT review #6. Both immediate and pending author
forms disable Approve and Request changes. The new thread is resolved. No Git
push, merge, invitation, permission/policy change or credential creation occurs.

The final API comparison permits only the new review/comment and the PR's
updated timestamp. All seven Git refs, five original reviews, seven original
comments, check runs and eight settings resources are preserved. No private
pending review remains. Git and CLI credential inventories are both empty.
Eligible approvals remain zero, two CODEOWNERS groups still require approval,
the required deployment is unsatisfied and Merge remains disabled. Vault has no
references/grants or scheduled cleanup in this canary; saved values are neither
read nor changed.

Native production captures show the
[published review](reader-feedback-production-review.jpg) and
[resolved bounded hunk thread](reader-feedback-production-thread.jpg). The
production identity is the owner/author: multi-account reader mutations were
not repeated in production. Their enforcement is covered by the frozen Linux
Worker/Git and exact CLI artifact tests above.

## UI scope and remaining release work

Six desktop and eleven genuine 390×640 browsing-context captures passed the
fresh scoped finish review with disposition **ship**. The unchanged app was
rendered in a same-origin iframe with measured innerWidth/scrollWidth 390; native
screenshots were clipped without resizing or app CSS alteration. The temporary
local fixture was removed and excluded from the frozen build. This does not
establish mobile device/touch/virtual-keyboard or comprehensive accessibility
acceptance. The context launcher/single detector attempt failed with exit 126;
no detector or QUALITY BAR verdict is claimed. See the design record for the
recapture history and source-only edge-state limits.

At 07:27 UTC, a fresh intended Nanohub Actions key probe returns HTTP 403 /
`sandbox_scope_required`: one provider read, zero job claims, zero allocations.
Unattended dispatcher activation, actual application CI/staging/cutover, complete
production recovery, load/SLO/operations and the remaining
[GitHub compatibility gaps](../github-parity.md) stay open. This release does not
establish general production traffic readiness.
