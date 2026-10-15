# Entire CLI: reusable patterns

Read-only inspection on October 2, 2026. Source observed at
`entireio/cli@89c26160877a27a5017dc0bd614768c463e793bd` (October 1).
Some storage/security documentation describes CLI 0.10.2; newer main-branch
source is not necessarily the released behavior. No CLI was installed or run,
and no hosting benchmark was reproduced.

## What it does

Entire combines agent/Git hooks, local session snapshots, commit-linked
checkpoints and optional checkpoint publication. Its command surface includes
setup/status/doctor, session and checkpoint discovery, explanation/search,
resume, attribution, and hosting operations. `agent-help --json` generates
machine-readable help from the installed command tree, filtering unavailable
or internal commands. Transcript streaming is separate from checkpoint metadata
JSON, which keeps ordinary agent responses bounded.

Git commits link to provenance with an `Entire-Checkpoint` trailer. A checkpoint
can contain contributions from multiple sessions; a session can span commits.
New repositories enabled since 0.10.0 default to a ref per checkpoint under
`refs/entire/checkpoints/<shard>/<ULID>`. Older repositories retain
`entire/checkpoints/v1`. Both are readable; changing configuration changes new
writes without requiring an existing-history migration. Local shadow branches
are working snapshots, not the same thing as published checkpoint metadata.

The inspected source has a file-backed push queue shared across worktrees,
locking, deduplication, batched fast-forward pushes and individual fallback with
fetch/replay. Fallback has a two-minute budget and stops after five consecutive
failures, retaining/rotating failures for later delivery. A checkpoint push
failure is fail-soft: the code push can still proceed. The path runs through
pre-push, and retries can occur on later pushes. This is not an atomic
code-plus-provenance commit or a proven autonomous delivery guarantee.

Redaction precedes checkpoint metadata/transcript writes, with secret detection
and optional PII/custom rules. It is not a complete publication boundary:
structural paths and image/base64 content have exclusions, local shadow
snapshots are unredacted, and checkpoint-repository readers can read its
checkpoints. Telemetry and optional summary-provider calls are separate egress
surfaces. Typed redacted-byte wrappers help discipline but do not establish
that every input was scanned.

## What is worth borrowing

1. Generate version-matched JSON command help, including capabilities and
   mutation indicators, rather than maintaining a separate agent command list.
2. Link compact provenance IDs to commits, while fetching transcripts explicitly
   and allowing provenance to have a stricter access boundary than source code.
3. Keep independent metadata publication off the shared trunk's ordering path.
   Per-checkpoint refs remove a metadata branch hotspot, not trunk contention;
   ref-count and advertisement costs still need measurement.
4. Use durable, bounded-work retry queues with clear failure states. Keep failed
   optional provenance delivery from pretending that code failed to land.
5. Show separate landed, clonable, provenance-published and mirrored states.
   The first two now have an explicit opt-in contract in our JSON submission API.
6. Put disclosure controls before persistence/publication. Secret scanning is
   not authorization to upload paths, images or incidental session context.

These are CLI/provenance patterns, not evidence of a faster sequencer or a Raft
implementation. The reported approximately 586 pushes/s remains an unverified
hosting claim here, not a measured CLI or shared-trunk rate. The native-branch
docs also describe a one-region, not-backed-up limitation for
`entire/unmirrored/*`; that boundary must be checked before comparing durability.

## Primary sources

- https://docs.entire.io/platforms/cli-and-entire-io
- https://docs.entire.io/cli-reference/agent-help
- https://docs.entire.io/cli-reference/checkpoint
- https://docs.entire.io/cli-reference/session
- https://docs.entire.io/guides/checkpoints/capture-checkpoints
- https://docs.entire.io/guides/checkpoints/checkpoint-storage
- https://docs.entire.io/guides/configuration/git-hooks
- https://docs.entire.io/agents/overview
- https://docs.entire.io/security
- https://docs.entire.io/guides/repositories/entire-native-branches
- https://github.com/entireio/cli/blob/89c26160877a27a5017dc0bd614768c463e793bd/cmd/entire/cli/checkpoint/pushqueue.go
- https://github.com/entireio/cli/blob/89c26160877a27a5017dc0bd614768c463e793bd/cmd/entire/cli/strategy/manual_commit_push.go
- https://github.com/entireio/cli/blob/89c26160877a27a5017dc0bd614768c463e793bd/cmd/entire/cli/strategy/push_common.go
- https://github.com/entireio/cli/blob/89c26160877a27a5017dc0bd614768c463e793bd/redact/redact.go
