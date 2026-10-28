interface CheckpointStub {
  fixtureRecoveryCheckpoint(key: string): Promise<{ id: string; bookmark: string }>;
}

/** Only a checkpoint observation is retried. A fresh stub is required after a
 * platform exception. Unknown failures and overloaded objects stop closed. */
export async function readCheckpoint(
  fresh: () => CheckpointStub,
  key: string,
  sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return { ...await fresh().fixtureRecoveryCheckpoint(key), readAttempts: attempt };
    } catch (error) {
      const flags = error as { retryable?: unknown; overloaded?: unknown } | null;
      if (attempt >= 3 || flags?.retryable !== true ||
          flags.overloaded !== undefined && flags.overloaded !== false)
        throw error;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
}
