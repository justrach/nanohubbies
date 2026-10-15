/** Only server-observed work counts. Copying instructions never completes setup. */
export function setupFacts(
  agents: Iterable<{ kind: string; landed: number }>,
  usedTokens: number,
) {
  const agentRows = [...agents].filter((agent) => agent.kind === "agent");
  return {
    connected: agentRows.length > 0 || usedTokens > 0,
    landed: agentRows.some((agent) => agent.landed > 0),
    agents: agentRows.length,
  };
}

export function agentHandle(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, "-")
      .replace(/^[^A-Za-z0-9]+/, "")
      .slice(0, 48) || "my-agent"
  );
}
