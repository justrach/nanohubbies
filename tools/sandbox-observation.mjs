/** Recovery is only for observations of an existing job, never allocations,
 * command launches, uploads or callbacks whose acknowledgement may be lost. */
export const transientObservationError = error => {
  if (error?.status !== undefined)
    return [408, 429, 500, 502, 503, 504].includes(error.status);
  if (error?.code === 'sandbox_command_failed') return false;
  return ['AbortError', 'TimeoutError'].includes(error?.name) ||
    /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENETUNREACH|UND_ERR_\w+)$/.test(error?.code ?? error?.cause?.code ?? '') ||
    (error instanceof TypeError && /fetch failed|network|socket|ECONNRESET/i.test(error.message));
};

export async function observeSandbox(read, {
  deadline, label, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  beforeRetry, recoveryDeadline = Infinity,
}) {
  const until = Math.min(deadline, recoveryDeadline, now() + 60000);
  for (let attempt = 0; attempt < 8; attempt++) {
    if (now() >= deadline)
      throw Object.assign(Error('Job timed out during ' + label), {code: 'job_deadline'});
    if (now() >= until) break;
    try {
      const value = await read({timeoutMs: Math.max(1, Math.min(20000, until - now()))});
      if (now() >= deadline)
        throw Object.assign(Error('Job timed out during ' + label), {code: 'job_deadline'});
      if (now() >= until) break;
      return value;
    } catch (error) {
      if (!transientObservationError(error)) throw error;
      if (attempt === 7 || now() >= until) break;
      await sleep(Math.min(1000 * 2 ** Math.min(attempt, 3), Math.max(0, until - now())));
      if (now() >= until) break;
      await beforeRetry?.({recoveryDeadline:until});
    }
  }
  if (now() >= deadline)
    throw Object.assign(Error('Job timed out during ' + label), {code: 'job_deadline'});
  throw Error('Unable to observe ' + label + ' within the bounded recovery window');
}

/** Read-only authorization check. Transient outages are not revocations. */
export async function readCiLease(cloneUrl, token, {timeoutMs = 20000, fetcher = fetch} = {}) {
  const response = await fetcher(cloneUrl + '/HEAD', {
    headers: {Authorization: `Bearer ${token}`},
    signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
  });
  // Discard the Git HEAD response rather than leave its stream unconsumed.
  await response.body?.cancel();
  if ([408, 429, 500, 502, 503, 504].includes(response.status))
    throw Object.assign(Error('CI lease observation temporarily unavailable'), {status: response.status});
  return response.status === 200;
}
