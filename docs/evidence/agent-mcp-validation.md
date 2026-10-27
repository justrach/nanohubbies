# MCP agent contribution validation — 2026-10-27

## Delivered behavior

Agent-agnostic, optional Streamable HTTP MCP service through official SDK 2.4.0,
with credential-bound agent/owner attribution, persistent work records,
server-observed native Git ref updates, member-only history and artifact links.
The Paper UI shows recent contributors on Code, full history under Agents,
PR-linked activity and generic connection values under Connect.

Model/client labels and summaries are explicitly reported; they never grant a
human review or prove authorship. Human Git remains independent of registration.
The [contract and limits](../agent-mcp.md) describe compatibility and current gaps.

## Automated verification

- All **210 API unit tests** pass, including six new contribution storage tests.
- The full repository gate passes: **163 focused unit tests**, plus all smoke
  invocations, including the new MCP smoke and existing archive/Git/CLI/review,
  deployment/ref-policy and authorization coverage.
- CLI: **23 tests, 187 assertions**, all pass.
- Pinned tsrs checks: API, web, web Worker and vault pass.
- Final OpenNext production build and `git diff --check` pass.

`smoke-agent-mcp.ts` uses the real official SDK Client and HTTP transport against
a Miniflare Worker, real native Git push/clone and `git fsck --strict`. It tests:

- discovery, all five tools, JSON resource, modern transport and legacy
  2025-11-25 stateless JSON/SSE requests;
- registered principal/owner binding, separate clients, no token in projections,
  spoof/cross-agent/cross-repository denial;
- idempotent sessions/events, finished-session behavior, cursors and scoped counts;
- real agent Git ref attribution independent of untrusted author strings, no
  invented attribution for ordinary Git tokens and none for rejected pushes;
- repository-local published commits/PR links, foreign/missing artifact refusal,
  unchanged human approval gate;
- current reader demotion/removal, archived read/write boundaries, namespace
  aliases, restart persistence, immediate revocation and retained history.

Negative raw HTTP probes use separate connections: the SDK's oversized-body
rejection can close its HTTP connection, which made a reused Node probe socket
race. Legacy tests consume both JSON and SSE response encodings. Both test
harness issues were corrected before the passing full gate.

## Browser verification

Local `git-ui-fixture` contains clearly synthetic work from `fixture-builder`
(Codex) and `fixture-reviewer` (Harness). Temporary credentials were revoked.
A synthetic local feature branch and PR #1 exercise an actual accepted agent Git
update and an MCP report linked to the same PR/head; main is unchanged. An initial
local scaffolding script read the wrapped PR response incorrectly; the existing
work session was completed after using the canonical PR projection, with no
second branch/PR or duplicate report.

- Desktop Code contributor sidebar at 1280 px, two named profiles and session
  counts; no horizontal document overflow.
- Full work history distinguishes start/completion, owner and reported labels.
- 320 px activity and MCP connection instructions: no horizontal document
  overflow; long endpoint wraps, code template scrolls within its own container.
- Keyboard disclosure/refresh focus and PR-linked history verified against the
  real HTTP data; reported PR links open the native PR. Commit IDs display as text
  because the existing version browser does not cover every feature commit.
- Computed text colors on Paper (`rgb(250,248,243)`): muted `rgb(107,101,87)`,
  secondary `rgb(81,76,64)`, primary `rgb(26,24,19)`; 14 px narrative copy has
  24 px leading and a 72ch measure. Existing focus/hover/theme tokens retained.
  No new animation or private-value placeholder was introduced. Manual visual
  polish only; no automated Impeccable detector pass is claimed.

Screenshots: [Code](agent-mcp-local-code.png),
[history](agent-mcp-local-desktop.png), [mobile](agent-mcp-local-mobile.png),
[mobile setup](agent-mcp-connect-mobile.png), [PR](agent-mcp-local-pr.png).

## Production

MCP was validated on main Worker **85bb3ccd-65a7-4628-97ec-54a5f864e8ee**,
at 100% traffic. The later [check-conclusion release](check-conclusions-validation.md)
records its Worker and CLI. The subsequent [ref-name release](ref-names-validation.md)
records a later deployment and rechecks retained MCP work and review gates.
Private vault service remains unchanged at
**02dcb88b-5c99-49d9-a4b6-cb95451e6bb5**. The CLI at this initial MCP release was 0.4.2.
The first version upload returned Cloudflare authentication error 10000; a single
retry with the same deployment configuration succeeded, then explicit rollout
completed. No authentication scope/configuration changes were made.

An unauthenticated production initialize request returns private-repository 404
(`not_found`) without disclosing the repository or creating a work record.
The live Connect page exposes the scoped MCP endpoint and template with a token
placeholder. With explicit user approval, issued one temporary repository-scoped agent
credential for `mcp-smoke-20261027` in the existing private
`rachxpradhan/prod-codeowners-20261027` canary. The official SDK passed discovery,
all five tools and the JSON resource, idempotent start/completion, PR #1 plus
current-head links, spoof refusal and unchanged Git/PR/review/deployment gates.
One clearly synthetic work session remains as production UI evidence.

The credential was immediately revoked through Connect. MCP initialize and
Basic API access both return 401; a fresh official SDK connection is denied.
The plaintext temporary input was deleted and the REPL token cleared. The agent
profile and work history remain, independent of presence. Main stays
`33e73c27c6d261a16c384cdad6d1514b40305a2f`, PR #1 head stays
`f9dc310ab27e59ec429f159d7dccbeb847655815`; no Git push or review was submitted.
Private metadata receipt: `~/.config/nanohub/prod-validation-2026-10-27/agent-mcp-smoke.json`.
Do not treat synthetic fixture labels as real model/vendor evidence.

Production history after revocation: [screenshot](agent-mcp-production-history.png).
The retained production Code/PR projections were rechecked after the later
check-conclusion deployment: [Code](agent-mcp-production-code.png),
[PR-linked work with original gates](agent-mcp-production-pr.png).
