# Git ref name validation — 2026-10-27

## Delivered contract

Branch/tag names now share Git-format validation, strict UTF-8 wire decoding,
255-byte full-reference bounds and exact identity without Unicode normalization.
New refs also reject the documented GitHub ambiguity cases; existing refs remain
addressable for protected updates/deletion. Protections, deployment selectors,
imports, migrations, CI identities and release labels retain the literal name.
Copied commands quote full refs and use an explicit remote push refspec. CLI
0.4.4 accepts assigned option values, including leading dashes and empty bodies.
See [the contract and limitations](../git-ref-names.md).

## Automated verification

- API unit suite: **222 tests**, all pass, including six ref-name tests.
- Repository gate: **174 focused unit tests** and all smoke invocations pass.
- Hosting gate: **19 tests** plus namespace/Git/Actions persistence smoke pass.
- CLI: **25 tests, 207 assertions**, all pass.
- Existing releases end-to-end check passes.
- Pinned tsrs: API, web, web Worker and vault pass. Final OpenNext build and
  `git diff --check` pass.

The ref unit suite compares names with real `git check-ref-format`, checks
byte/scalar boundaries, distinct canonical Unicode spellings, legacy ambiguity
handling, literal policy targets and malformed wire framing. The real
Worker/Git smoke pushes Unicode, emoji, shell punctuation, literal percent/hash,
Unicode whitespace, leading-dash and maximum-length refs; it verifies
advertisements, browse queries, mirror migration, clone/fsck, protected
update/deletion denial and restart persistence. Executing the actual generated
shell commands leaves the injection sentinel absent. Malformed UTF-8 receive
commands return 400 without creating a replacement-character ref. Temporary
local credentials are revoked and fixtures disposed.

## Browser evidence

Local desktop at 1280 px and mobile at 320 px have no horizontal document
overflow. The local fixture shows shell-quoted commands and rejects a new
40-hexadecimal ref without writing it. Existing Paper tokens and focus behavior
are retained. No automated design-detector result is claimed.

Screenshots: [quoted commands](ref-names-local-commands.png),
[mobile validation](ref-names-local-mobile.png).

## Production

Current main Worker: **9e23df34-1afa-44a0-aa5c-41af6f297545**.
Vault remains **02dcb88b-5c99-49d9-a4b6-cb95451e6bb5**.

The initial version-only rollout, **c2527a93-461b-4058-9497-08c4e0c2084c**,
reported current root Worker metadata but a Unicode policy save still returned
the old `Invalid branch name` error. A dry-run bundle contained the new validator
and no old error string. A full `wrangler deploy --keep-vars` of the same tested
build and existing deployment configuration resolved the observed behavior.
This establishes the successful rollout; it does not prove the cause of the
earlier stale behavior. Full deployment is not atomic across Workers and objects;
the subsequent [CLI protection rollout](cli-protections-validation.md) adds
mixed-version RPC handling. Verify a real stateful operation rather than relying
only on root metadata or assuming another deployment is required.

Using the signed-in browser in the existing private
`rachxpradhan/prod-codeowners-20261027` canary:

- Saved the exact new lock `検証/ロック-20261027-🔒` and reloaded to verify
  persistence. Creating that previously absent branch was denied with
  `branch is locked`; the ref remains absent.
- Created `検証/UTF8-20261027-🚀` from main, reloaded and browsed its files.
  There are now six branches; the existing five retain their displayed IDs.
  The new branch and main both show `33e73c2`. The branch and exact test lock
  remain available for inspection.
- Verified production command instructions quote the full Unicode ref.
- Reloaded PR #1: head remains `f9dc310ab27e59ec429f159d7dccbeb847655815`,
  the retained synthetic MCP work is linked to it, two CODEOWNERS groups await
  approval and the required deployment remains missing. Merge is disabled.

No new Git/agent/runner credential, Git push, review or environment deployment
was created for this ref-name validation. Existing rules/environments were not
edited; the one new exact test lock strengthens only the named future ref.
The separately approved MCP test credential remains revoked.

Screenshots: [saved lock](ref-names-production-lock.png),
[denied creation](ref-names-production-denied.png),
[Unicode branch and commands](ref-names-production-branch.png),
[retained MCP work and review gates](agent-mcp-production-pr-current.png).

## Published CLI

CLI **0.4.4**, **35,413 bytes**, SHA-256
`5c7173bdb72a8e8e411475149ff132300a3bac9e9ffed0a39522ef05da121a7d`.
The actual public manifest/module/checksum match the build. The published Bun
installer passes in an isolated prefix containing spaces and an apostrophe;
both `nh` and `nanohub` work outside the checkout. Root metadata identifies the
current Worker; legacy routes and cache headers pass. No global installed
command, PATH or Git configuration was changed. Private metadata receipt:
`~/.config/nanohub/prod-validation-2026-10-27/cli-distribution-release-0.4.4.json`.

Production Git transport with a new Unicode ref was not exercised with a new
credential in this rollout. It has the real local Worker/Git/migration coverage
above; the production positive/negative checks used signed-in HTTP operations.
