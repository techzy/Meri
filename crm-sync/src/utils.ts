export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
  baseDelay = 1000
): Promise<T> {
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const e = err as Record<string, unknown>;
      lastError = err instanceof Error ? err : new Error(String(err));

      const isRateLimited =
        e?.['status'] === 429 ||
        e?.['code'] === 429 ||
        (typeof e?.['message'] === 'string' && e['message'].includes('429'));
      const isServiceUnavailable = e?.['status'] === 503;

      if (!isRateLimited && !isServiceUnavailable) throw lastError;

      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(
        `[Retry] Rate limited — retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}
