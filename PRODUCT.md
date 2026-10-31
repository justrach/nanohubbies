# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Repository owners, collaborators and coding agents working with private code. Agent registration is optional; ordinary Git clients and the scoped `nh` / `nanohub` hosting CLI are supported.

## Product Purpose

Nanohub provides independent private Git hosting with owner/repository addressing, repository collaboration, review and protection controls. The existing swarm workflow also supports concurrent agent work. Hosting must remain usable without registering an agent.

## Operating Context

The browser repository workspace, ordinary Git transport and hosting CLI share repository access boundaries. Reader, writer, admin and owner roles carry distinct authority; current membership and credential scopes govern operations. See [access and secrets](docs/access-and-secrets.md), [repository workflows](docs/repository.md) and [hosting CLI](docs/hosting-cli.md).

## Capabilities and Constraints

- Branch and ref rules, locks, reviews and audit are repository controls. UI hints do not replace final server authorization.
- Published branch rename lets writers rename unprotected non-default branches; current admins are required for default or protected branches. A revision-checked atomic transaction preserves the commit and coordinates refs, default branch, PR targets, policies, CI invalidation, aliases and audit. PRs using the old name as their head close; open PRs targeting it retarget. The original code pusher stays the original pusher, preserving review independence.
- Rename must satisfy destination protections and source/destination rules, including exclusions and naming/creation/deletion constraints. Overlapping classic constraints can require a new exact rule; limits can require explicit reconciliation. Rename must not silently weaken protection. Git and raw URLs do not automatically redirect. Branch browsing follows stored aliases; a real branch recreated at the old name takes precedence.
- Secret values remain in Cloudflare Secrets Store. A private, idle-eligible Vault service holds references, grant hashes and audit metadata rather than repository plaintext values. Authorized workloads intentionally receive selected plaintext values; deployment operators remain trusted. This is not a zero-knowledge custody claim. See [custody and provisioning](docs/access-and-secrets.md).
- Published production CLI is **0.4.20**. Its release acceptance covers nine frozen Linux gates, exact public delivery, both installed aliases, a live synthetic branch rename and owner lock rejection, with existing repository state preserved. No new production credential is issued. Hosted fleet activation and production traffic readiness remain unestablished. General CLI help still omits the implemented `branches:write` grant explanation; the hosting guide documents it. Source candidate **0.4.21** corrects that help and passes local CLI plus focused Worker/Git checks, but is not published.

## Brand Commitments

The user-approved repository direction is the existing Harness Paper/Graphite pair with shared top navigation, recorded in [selected design](docs/design-variations/2026-10-26/selected-design.md). Preserve this established identity when extending repository UI; visual implementation details live in [DESIGN.md](DESIGN.md).

## Evidence on Hand

The repository contains implementation and scoped validation records under `docs/evidence/`. [Published CLI release evidence](docs/evidence/branch-rename-release-validation.md) distinguishes released behavior from candidates. [Branch rename design validation](docs/evidence/branch-rename-design-validation.md) records local UI evidence and its limits. These records do not establish complete GitHub parity.
