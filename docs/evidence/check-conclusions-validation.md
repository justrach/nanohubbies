# Required-check conclusion validation — 2026-10-27

## Delivered contract

Native trusted check results now accept success, neutral, skipped, failure,
cancelled, timed_out, action_required and stale. Ordinary named required checks
accept only success/neutral/skipped, matching the
[documented GitHub behavior](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

The exact current candidate/base, completed run, unique name and configured
source still apply at PR opening and final merge. Source pins cannot be erased
by a non-blocking conclusion. The reserved legacy staging check requires actual
successful verified staging evidence; named deployment reports retain their
separate success/failure/cancelled contract. A skipped workflow with no named
result cannot manufacture a satisfied check. See [the full contract](../check-conclusions.md).

Codegraff dependency jobs now report skipped, revoked leases remain cancelled,
and an exhausted job/lease deadline reports timed_out with sandbox cleanup.
Actions/PR panels show the conclusions, and CLI v0.4.3 preserves each distinct
conclusion in human output without changing JSON. Agent credential usage copy
now says last used; MCP/API reads were never Git pushes.

## Automated verification

- All 216 API unit tests pass, including five new storage/merge conclusion tests
  and a deterministic sandbox deadline/cleanup test.
- Full repository gate: 168 unit tests and all smoke invocations pass, including
  the new real Worker/Git/CLI conclusion smoke, ordinary/source and bundled CLI
  Git checks, MCP, signatures, review, deployment and archive regressions.
- Hosting gate: 19 tests plus the namespace/Git/Actions persistence smoke pass.
- CLI: 24 tests, 196 assertions, all pass.
- Pinned tsrs: API, web, web Worker and vault pass. Final OpenNext build and
  `git diff --check` pass.

The integration smoke demonstrates real neutral before-open checks and a real
skipped protected merge. All five blocking conclusions reject merge without
moving main; wrong sources, missing names, ordinary credentials, asserted
sources, unknown states and duplicate results are denied. It verifies identical
completion retries, native Bun CLI text/JSON, restart persistence, exact merged
commit IDs and clone/fsck.

The full gate caught an initial CLI cross-package source import when copying the
CLI into an independent quoted source directory. The import was removed; CLI
formatting simply displays its reported result states, while gate/Actions logic
remains in the API. Both isolated source and portable bundled Git helper tests
pass after the fix. No published CLI depends on the API source tree.

## Browser evidence

The local `check-conclusions-ui` repository is explicitly synthetic. Its test
reports allocate no real sandbox. PR #1 has lint neutral and docs skipped,
showing satisfied required checks and enabled Merge; PR #2 has lint timed_out,
shows the exact conclusion and has Merge disabled. No browser merge was
submitted. Main remains the synthetic seed. The temporary local Git credential
and runner were revoked.

Actions distinguishes Timed out, Neutral and Skipped. The PR protection panels
retain the candidate/base/source and show each required check's actual result.
Desktop at 1280 px and the blocked PR at 320 px have no horizontal document
overflow; hashes and long names wrap. Keyboard navigation, disabled controls,
existing focus/hover and Paper theme tokens were retained. No added animation
or new visual system. Manual Impeccable polish; no detector pass is claimed.

Screenshots: [Actions](check-conclusions-local-actions.png),
[accepted conclusions](check-conclusions-local-pr.png),
[320 px blocked PR](check-conclusions-local-mobile.png).

## Production rollout

Main Worker **4a81681c-4d5b-49dd-a8a9-0f22b5c92baf**, 100% traffic.
Private vault remains **02dcb88b-5c99-49d9-a4b6-cb95451e6bb5**.
Portable CLI **0.4.3**, 35,285 bytes,
SHA-256 `7b8d0d5aec46c89251c57c3f3a3c810baf784474747e2015d5f6e950caecb49a`.

No production runner credential, Git token, check result, protection change,
Git push, environment deployment or review is created by the conclusion rollout. Positive
conclusion enforcement is tested against the real local Worker/Git integration;
production read-only checks and published installer evidence are recorded below.
The separately approved [MCP production smoke](agent-mcp-validation.md) passed,
with its credential revoked and work history retained.

The actual published v0.4.3 manifest/module/checksum and published installer pass
in an isolated temporary prefix containing spaces and an apostrophe. Both `nh`
and `nanohub` run outside the checkout and report 0.4.3. Public destination output,
current Worker metadata, cache headers and legacy routes pass. No global PATH,
Git configuration or installed command was changed. Private metadata receipt:
`~/.config/nanohub/prod-validation-2026-10-27/cli-distribution-release-0.4.3.json`.

Read-only production browser checks after rollout show the retained MCP profile
on Code and its synthetic completion linked to PR #1. The PR remains open at the
same head, with two CODEOWNERS groups awaiting approval and its required
production deployment missing; Merge remains disabled. No check result was
published in production to simulate the new conclusions. The new conclusion
labels/gates have the local real-Worker/Git/CLI and browser evidence above.
