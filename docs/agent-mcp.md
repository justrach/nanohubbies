# Agent work over MCP

Nanohub can show which registered agents worked in a repository, who owns each
identity, and what work they reported. Any compatible Streamable HTTP MCP client
can use the optional service. Ordinary Git clients and human workflows do not
need MCP or agent registration.

The Code sidebar shows recent agent contributors and counts of work sessions and
accepted Git ref updates. Agents → **Agents who worked here** retains the event
history independently of online presence. Pull requests have an **Agent
contributions** disclosure containing events explicitly linked to that PR or its
current head. This is attribution of recorded activity, not an exhaustive list of
commit authors.

## Connect

Under Connect → Agent collaboration, register an agent and issue its credential.
Use **Connect with MCP** to copy the endpoint and configuration values. The Agent
room's connection form exposes the same details. Register different handles for
distinct agents so their stable identities remain distinct.

- Endpoint: `https://nanohub.sh/api/trunks/<repository-id>/agents/<handle>/mcp`
- Alias: `https://nanohub.sh/api/repos/<owner>/<repo>/agents/<handle>/mcp`
- Transport: Streamable HTTP, stateless requests.
- Authorization header: `Bearer <your-agent-token>` using that agent's scoped
  `nha_` credential. Keep the actual value in the client's private settings.

The connection template is a set of values, not a universal client-specific JSON
configuration. Clients must support custom HTTP headers. There is no MCP OAuth
registration/discovery flow or automatic client installation in this feature.

The server uses the official `@modelcontextprotocol/server` SDK pinned to 2.4.0
with its Cloudflare-safe schema validator. Modern requests and stateless legacy
2025-11-25 JSON/SSE requests are tested. There are no long-lived subscriptions.
See the [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
and the [DeepWiki SDK reference](https://deepwiki.com/modelcontextprotocol/typescript-sdk).

## Tools and resource

| Tool | Purpose |
| --- | --- |
| `nanohub_context` | Read the current repository, authenticated agent/owner and whether work can be recorded. |
| `nanohub_start_work` | Start a session with a lowercase UUID `sessionId`, title, and optional reported `client` name/version/model. |
| `nanohub_report_work` | Append a progress, blocked or completed update to that agent's own session. Use a UUID `eventId`, state, summary and optional links. |
| `nanohub_get_work` | Read a session owned by the authenticated agent. |
| `nanohub_list_activity` | Read repository activity, optionally filtered by PR number or commit SHA. |

`nanohub://repository/<repository-id>/agent-activity` is the read-only JSON resource.
The member-only HTTP projection is `GET /api/trunks/<id>/contributions` with
optional `limit` (1–50), `before` sequence cursor, `pull` and `commit` filters.
Multiple artifact filters match either artifact. Pagination changes the events,
not the overall contributor counts in that artifact scope.

Start example:

```json
{
  "sessionId": "722af3d0-ddf4-4b64-a659-53e3b52489b1",
  "title": "Improve the hunk reviewer",
  "client": { "name": "My MCP client", "model": "client-reported label" }
}
```

Report example:

```json
{
  "sessionId": "722af3d0-ddf4-4b64-a659-53e3b52489b1",
  "eventId": "163bfb14-5168-471b-901b-ed7feb710782",
  "state": "completed",
  "summary": "Implemented keyboard navigation and checked focus in the diff.",
  "links": [{ "kind": "pull", "number": 12 }]
}
```

A commit link uses `{ "kind": "commit", "sha": "<full lowercase SHA>" }`.
A linked commit must be published in this repository, and a PR must exist here.
Commit IDs appear as text; PR links open the native PR. Reuse the same IDs and
payload on retries. Completed sessions accept identical event replays; start a
new session for additional work. A session ID cannot be claimed by another agent.

## What the attribution proves

An accepted record binds to the registered agent ID and owner resolved from its
credential. Tool input, MCP clientInfo and Git author headers cannot choose that
principal. Profile snapshots stay in history after revocation or loss of access.

Work titles, summaries, client/model names and artifact links are **reported by
the agent**. They do not attest to a model vendor, prove authorship, supply a
human review, satisfy CODEOWNERS, or alter any merge/check gate. Agent types are
registered labels, not model attestations.

For native Git repositories, successful ref updates authenticated with a
registered agent credential are automatically recorded in the same transaction
as the accepted refs. Rejected pushes produce no event. This records who updated
a ref, not who authored every commit. Ordinary human Git tokens and legacy
unregistered handles do not invent an agent identity. Existing history is not
backfilled from commit strings.

## Access, persistence and limits

Every HTTP request checks the current credential and membership. Bearer agent
credentials are accepted only at the exact scoped MCP endpoint; Git/other APIs
retain their existing authentication contracts. Human cookies cannot impersonate
an MCP agent. If an Origin is present, it must be trusted.

Recording work requires current repository write access and an unarchived
repository. Reads remain available to current readers on archived repositories.
Membership removal, expiration and revocation deny subsequent requests, including
requests from an already initialized SDK client. SQL writers retain the final
archive fence. Responses are private and non-cacheable.

These MCP tools track work and read activity; they cannot approve, merge, change
settings or read secrets. The credential itself retains its existing agent
Git/API permissions outside MCP, so use a separate registered identity per agent
and revoke it when the agent no longer needs access.

Records live in the repository's SQLite Durable Object, not a running agent
process. Current bounds: 64 KiB transport body, 160-character titles,
4,000-character summaries, 20 unique linked artifacts per session, 200 events per
session and 10,000 sessions per repository. Commit-link verification is bounded
and rejects unavailable/foreign objects. Contributor projections show the most
recent 100 profiles with an exact total; the Code sidebar previews four.

Run `bun run --filter @swarm/api test:mcp` for the SQL tests and official SDK
HTTP/Git integration smoke. See [validation evidence](evidence/agent-mcp-validation.md).
