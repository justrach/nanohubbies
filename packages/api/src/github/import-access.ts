/** Keep credential failures distinct from anonymous repository failures.
 * Public imports may still succeed when a GitHub connection is unavailable. */
export async function importWithAccess<T>(
  mint: (() => Promise<string>) | null,
  fallback: string | null,
  download: (token: string | null) => Promise<T>,
): Promise<{ imported: T; token: string | null }> {
  let token = fallback;
  let accessError: unknown;
  try {
    if (mint) token = await mint();
  } catch (error) {
    accessError = error;
  }
  try {
    return { imported: await download(token), token };
  } catch (error) {
    if (accessError) {
      const reason = accessError instanceof Error ? accessError.message : "GitHub access is unavailable.";
      throw new Error(`You are signed in, but the repository could not be imported. ${reason}`);
    }
    throw error;
  }
}
