/** "owner/repo#123", "owner/repo/pull/123", or a github.com pull request URL,
 *  as the path of its page here; null for anything else. */
export function pullPath(input: string): string | null {
  const m = input.trim().match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+)(?:\/pulls?\/|#)(\d+)/);
  return m ? `/pr/${m[1]}/${m[2]}/${m[3]}` : null;
}
