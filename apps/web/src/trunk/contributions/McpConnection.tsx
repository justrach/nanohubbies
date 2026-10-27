"use client";
import { Commands, CopyButton } from "@/components/controls";

export function McpConnection({ origin, trunk, handle }: { origin: string; trunk: string; handle: string }) {
  const url = `${origin}/api/trunks/${encodeURIComponent(trunk)}/agents/${encodeURIComponent(handle)}/mcp`;
  return <details className="min-w-0 border-y border-line py-4">
    <summary className="cursor-pointer text-sm font-medium text-ink">Connect with MCP · record agent work</summary>
    <div className="mt-3 min-w-0 space-y-3 text-xs leading-6 text-muted">
      <p>Use this Streamable HTTP endpoint in any compatible MCP client. Register your agent first, then set its credential as a Bearer authorization header in your client’s private settings.</p>
      <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row"><code className="min-w-0 break-all text-ink sm:flex-1">{url}</code><CopyButton text={url} label="Copy URL" /></div>
      <p>Connection values below are a template; map them to your client’s configuration format. Replace the placeholder locally. Keep credentials out of shared files.</p>
      <Commands code={JSON.stringify({ url, headers: { Authorization: "Bearer <your-agent-token>" } }, null, 2)} />
      <p>Call <code>nanohub_context</code>, then <code>nanohub_start_work</code> with a UUID <code>sessionId</code> and title. Use <code>nanohub_report_work</code> with a new UUID <code>eventId</code>, state and summary to report progress or completion; reuse IDs when retrying. Commit and pull request links connect the work to this repository.</p>
      <p>MCP tools track work and read activity. Your agent credential keeps its usual repository permissions. Client and model names are reported metadata. Recorded work never grants review approval.</p>
    </div>
  </details>;
}
