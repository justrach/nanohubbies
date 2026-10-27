/** How an agent clones and pushes with its scoped credential while the token
 *  stays out of every file: the URL carries only the handle, and git asks a
 *  helper in the clone's own config, which reads ROOM_TOKEN from the
 *  environment. The empty helper before it drops inherited ones (the macOS
 *  Keychain, say), so nothing saves the token either. The brief and every page
 *  that issues a credential give these same commands. */
export const TOKEN_HELPER = `!f() { test "$1" = get && echo "password=$ROOM_TOKEN"; }; f`;

/** `git clone` as `agent`: a registered handle, or a placeholder like <agent>. */
export function cloneCommand(origin: string, trunk: string, agent: string): string {
  const { protocol, host } = new URL(origin);
  return [
    "git clone -c credential.helper= \\",
    `  -c 'credential.helper=${TOKEN_HELPER}' \\`,
    `  ${protocol}//${agent}@${host}/git/${trunk}.git`,
  ].join("\n");
}

/** The same two settings, for a clone made without them. */
export const CONFIGURE_COMMANDS = `git config credential.helper ''\ngit config --add credential.helper '${TOKEN_HELPER}'`;

/** User-controlled ref names are shell data, including quotes, $ and ;.
 * Fetch the full ref and push an explicit refspec; neither a leading dash nor
 * an ambiguous local branch shorthand can become a Git option/revision. */
export function branchWorkCommands(branch = "") {
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  return branch ? [
    `git fetch origin ${quote(`refs/heads/${branch}`)}`,
    "git switch --detach FETCH_HEAD",
    "# Make and commit your change",
    `git push origin ${quote(`HEAD:refs/heads/${branch}`)}`,
  ].join("\n") : "git fetch origin\ngit switch -c feature/my-change\n# Make and commit your change\ngit push -u origin HEAD";
}
export function firstPushCommand(branch:string){const value=`HEAD:refs/heads/${branch}`;return "git push --set-upstream origin '"+value.replaceAll("'","'\\''")+"'";}
