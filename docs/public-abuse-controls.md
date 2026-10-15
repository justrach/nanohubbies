# Public admission controls

Every non-local API host enforces trunk admission and request throttles, even
when Codegraff sign-in is unavailable. Anonymous users can still try the site,
but cannot consume unbounded trunk capacity. No new bindings or Durable Object
class migrations are required: admission shares the existing Hub's SQL, and
rate-only Hub instances are named per hashed Cloudflare connecting address.

These limits protect the API and git push entry points. Next.js pages, legacy
Worker forwarding, immutable git downloads, and Durable Objects' internal
practice-agent calls are not rate limited here. Keep the deployment's
`SWARM_MAX_AGENTS` and `SWARM_MAX_SECONDS` settings alongside these controls.
They do not constitute a WAF, identity verification, a byte quota on existing
trunk history, or a global concurrency limit on practice swarms.

## Deployment settings

Set these as Worker variables in the deployment's ignored Wrangler config.
Omitted, zero, negative, fractional, infinite, or otherwise invalid numbers use
the defaults; they never mean unlimited.

| Variable | Default | What it bounds |
| --- | ---: | --- |
| `TRUNK_MAX_TOTAL` | 100 | All registered trunks and in-flight admissions, including existing trunks |
| `TRUNK_MAX_PER_OWNER` | 10 | A signed-in person's trunks and admissions, across addresses |
| `TRUNK_MAX_PER_IP` | 3 | Trunks and admissions created from one connecting address, signed in or not |
| `TRUNK_CREATIONS_PER_HOUR` | 3 | Creation/import attempts per connecting address per hour |
| `CONTROL_REQUESTS_PER_MINUTE` | 60 | API mutations, auth/GitHub reads, WebSocket openings, and git push requests, per address |
| `AGENT_REQUESTS_PER_MINUTE` | 6000 | All HTTP agent workflow reads and writes per address, across trunks/agent names |
| `TRUNK_REQUEST_MAX_BYTES` | 1048576 | Streamed JSON creation/import request bytes |
| `TRUNK_SEED_MAX_BYTES` | 8388608 | UTF-8 path and content bytes in a seed, including imported files |
| `RELEASE_MAX_BYTES` | 1073741824 | Every release file of one workspace together (also on local servers); each file is at most 250 MB, 20 per release, 100 releases |

Public creation also caps seeds at 3,000 files. The existing importer has its
own download, decompression, and per-file bounds; the seed check runs before
initializing a sequencer or creating its Artifacts repository.

Control and agent budgets are separate, so a swarm's HTTP traffic does not
consume sign-in/control capacity. Rate windows start with their first request;
rejected requests do not extend the window. Failed creation attempts count
against the hourly budget to prevent repeated expensive imports. IP-based
limits are shared by people and agents behind the same NAT; tune them for the
expected deployment. Changing cookies, agent names, or forwarded headers does
not reset an address's budget.

The IP key comes only from Cloudflare's `CF-Connecting-IP`. Missing addresses
share one bucket. Raw IPs are not stored; the digest remains pseudonymous data,
not anonymization. Existing trunks count towards the deployment and owner
caps. Old rows without an address cannot be attributed retroactively to an IP.
Trunk list/find responses retain their original JSON shape and do not expose
address digests.

## Failures and concurrency

The Hub reserves capacity atomically before any GitHub download or seed writes.
Concurrent imports cannot all observe the same free slot. A reserved or
registered name returns 409 without replacing its owner or downloading again.
Owner/address quota and rate refusals return 429, deployment capacity returns
503, and oversized creation requests/seeds return 413. Admission/rate refusals
carry `Retry-After` and `Cache-Control: no-store`. A quota refusal will not clear
merely by waiting: capacity must become available (or settings must change).

Parsing, validation, or download failures release unused admission capacity.
Successfully initialized trunks are registered before optional room/context
work, so a later metadata failure cannot orphan them or free their quota.
Deleting a registered trunk through the existing authorized deletion route
frees its deployment, owner, and address capacity, not its hourly rate budget.

An initializer can create objects and then lose its reply. Its pending
reservation therefore has **no automatic expiry**: reusing that slot while the
old initializer is still writing would evade the cap. Interrupted admissions
fail closed across restarts. An operator must reconcile such a reservation with
the sequencer's state before removing it; there is deliberately no anonymous
endpoint to release pending admissions. This favors bounded storage over
automatic recovery from an ambiguous partial initialization.

## Local verification

Localhost retains unrestricted development by default. Set
`ABUSE_PROTECTION=1` to exercise public limits locally. Setting this to `0`
does not disable protections on a public hostname.

From `swarm/packages/api`, run `npm run test:abuse`. It uses a disposable local
Workers runtime and SQLite/R2 state, intercepts every outbound request, and
checks concurrent admission, import-before-download refusal, successful import,
owner deletion, rate separation and expiry, restarts, additive schema migration,
streamed request limits, and a real git clone with `git fsck --strict`.
