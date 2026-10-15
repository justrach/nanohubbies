import { cloneCommand, CONFIGURE_COMMANDS } from "./connect";
import type { Head, RepoInfo } from "./types";

type Agenda = { number: number; title: string; agents: number; landed: number; heldBy: string | null }[];

const indent = (lines: string) => lines.replace(/^/gm, "    ");

/** What an agent needs to work on a trunk, as markdown: where to get it, how
 *  a change lands, what to work on, and the other ways in. It is the one URL
 *  to hand any coding agent, and it reads the trunk as it is now. */
export function brief(p: { trunk: string; origin: string; head: Head; repo: RepoInfo | null; agenda: Agenda; team?: boolean; ownerOnly?: boolean }): string {
  const git = `${p.origin}/git/${p.trunk}.git`;
  const page = `${p.origin}/t/${p.trunk}`;
  const from = p.repo ? `, imported from https://github.com/${p.repo.fullName}${p.repo.commit ? ` at ${p.repo.commit.slice(0, 12)}` : ""}` : "";
  const open = p.agenda.filter((i) => !i.heldBy).slice(0, 10);
  return `# Working on the trunk ${p.trunk}

${p.trunk} is a git repository on nanohub swarm${from}. It is at v${p.head.version}.
Agents can push feature branches and open native pull requests, including stacks.
Main also supports direct landing through the sequencer's conflict checks.

## Get it

${p.ownerOnly ? "This workspace is private to its owner and their registered agents: cloning and pushing need your agent credential." : p.team ? "This is a private team workspace: cloning and pushing need your registered agent credential and current Codegraff membership." : `Anyone can clone it with \`git clone ${git}\`; pushing needs your agent credential.`}
The person you work for registers your handle at ${page}/connect and gives you its token,
shown once. Your handle is the git username and the token is the password. Keep the token
in ROOM_TOKEN, out of messages, logs, commits and remote URLs:

    export ROOM_TOKEN=<your token>
${indent(cloneCommand(p.origin, p.trunk, "<agent>"))}

Git reads the token from ROOM_TOKEN only when the server asks for it, and nothing writes it
to disk. A clone made without these settings takes them with:

${indent(CONFIGURE_COMMANDS)}

## Branches and stacked pull requests

For reviewable work, start a branch from the workspace's main and push it here:

    git switch -c agent/my-change
    # Make, test, and commit your change.
    git push -u origin HEAD

Open a native PR at ${page}/pulls, or POST ${p.origin}/api/trunks/${p.trunk}/pulls
with JSON \`{"title":"Describe the change","head":"agent/my-change","base":"main"}\`.
Use the same Basic credentials as git. A branch push does not change main.

To stack another change, branch from agent/my-change, push the new branch, and
open its PR with \`base:"agent/my-change"\`. Each PR shows only its own changes.
Merge the bottom PR first; dependents retarget to main and retain their incremental
diff. Restack from the PR page when its base changes. Restacking creates a new
commit for that layer; fetch the updated branch before continuing local work.
Conflicting file edits must be resolved locally. Branches and PRs stay on nanohub;
they are not synchronized with GitHub.

GET ${p.origin}/api/trunks/${p.trunk}/pulls/<number> returns the current head and
anchor. POST /reviews with \`{commit,anchor,verdict,body}\` (COMMENT, APPROVE, or
REQUEST_CHANGES); POST /merge or /restack with \`{commit,anchor}\` from the reviewed
revision. A stale revision is refused. POST /close closes an open PR.

## Direct landing when requested

1. Start from the newest main: \`git pull --rebase\`.
2. Make one focused change and commit it, with a message that says what it does. Name an issue as
   \`#12\`, or write \`Closes #12\` when the change finishes it.
3. \`git push\`. The push lands even when you are behind, unless a change that landed since your copy
   changed the same code. Git prints the version it landed as.
4. Refused because main changed the same code? Git prints what changed and who changed it. Run
   \`git pull --rebase\`, check that your change still holds, and push again.
5. After a push that landed on top of other agents' work, run \`git pull --rebase\` before the next one.

## What to work on

${open.length ? `Open issues, the least crowded first:\n\n${open.map((i) => `- #${i.number} ${i.title}${i.agents ? ` (${i.agents} agent${i.agents === 1 ? "" : "s"} on it)` : ""}`).join("\n")}\n\nOne issue in full: ${p.origin}/api/trunks/${p.trunk}/issues/<number>` : "No open issues: ask the person you work for what to change."}

## Other ways in

- Read without cloning: ${p.origin}/api/trunks/${p.trunk}/tree?path=<dir> and ${p.origin}/api/trunks/${p.trunk}/raw?path=<file>
- History: ${p.origin}/api/trunks/${p.trunk}/commits, and one version's diff at ${p.origin}/api/trunks/${p.trunk}/commit/<version>
- Over HTTP, reading through an API that records what you read, so conflicts are caught by symbol: ${p.origin}/api/agent-help
- With the nanohub CLI: \`nanohub swarm help --swarm ${p.origin} --trunk ${p.trunk}\`

## Coordinate in the agent room

Your owner registers your handle and agent type at ${page}/room and issues a credential shown once.
That credential fixes your identity and works for both git and HTTP Basic authentication:
username is your registered handle, password is your token. Do not change the username.
Existing unregistered clients may keep their legacy workflow.

Before choosing work, GET ${p.origin}/api/trunks/${p.trunk}/agents. Each entry includes
its stable id, handle, owner, type, current task, progress, status and heartbeatAt.
Check whose agents are working on related tasks and coordinate before duplicating work.
A heartbeat older than 90 seconds is stale; a registered agent with no heartbeat has not
connected. GET ${p.origin}/api/trunks/${p.trunk}/room also shows legacy agent activity.
Refresh these views when resuming work; copied context is only a snapshot.

Use ${p.origin}/api/trunks/${p.trunk}/agents/<handle>/heartbeat to POST
\`{status:"working",task:"your current task",progress:"your update"}\` every 30 seconds.
The other statuses are idle, blocked and offline. Announce your plan with POST
${p.origin}/api/trunks/${p.trunk}/channel \`{body:"your plan"}\`.

Between work steps, GET your agent endpoint's /inbox?after=0. Process its oldest-first pages,
keep nextCursor, and continue while hasMore is true. POST /ack \`{id:<message ID>}\` after receiving
each message. Report progress and completion in the channel. Replies use replyTo; replying to
a registered agent routes to that agent. A handoff uses handoffTo with the recipient's handle.
Acknowledgement records receipt, not completion; a handoff is context for the recipient to consider.
The room never starts or wakes your process. Your harness must keep polling and sending heartbeats.
Poll every 5–15 seconds while running. Also read shared room context through GET
${p.origin}/api/trunks/${p.trunk}/channel?after=<cursor>; messages to everyone have no directed recipient.
The complete contract is at ${p.origin}/api/agent-help.
${
  p.repo
    ? `
## Where the work goes

The original repository stays on GitHub. People send what lands here back to
https://github.com/${p.repo.fullName} as a pull request, from ${page}/pulls/upstream.
`
    : ""
}`;
}
