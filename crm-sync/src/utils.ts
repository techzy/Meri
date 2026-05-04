export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// General retry for Notion (fast exponential backoff)
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

// Gemini-specific retry: reads retryDelay from the error, defaults to 30s, max 3 attempts
export async function geminiWithRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const e = err as Record<string, unknown>;

      const msg = typeof e?.['message'] === 'string' ? e['message'] : '';
      const is429 =
        e?.['status'] === 429 ||
        msg.includes('429') ||
        msg.toLowerCase().includes('resource has been exhausted') ||
        msg.toLowerCase().includes('quota');

      if (!is429) throw lastError;

      // Read retryDelay from Google's error details if present
      let delayMs = 30_000;
      const details = (e?.['errorDetails'] as Array<Record<string, unknown>>) ?? [];
      for (const detail of details) {
        const retryDelay = detail['retryDelay'] as string | undefined;
        if (retryDelay) {
          const secs = parseInt(retryDelay.replace('s', ''), 10);
          if (!isNaN(secs)) delayMs = secs * 1000 + 2000; // add 2s buffer
          break;
        }
      }

      console.warn(
        `[Gemini] 429 rate limit — waiting ${delayMs / 1000}s before retry (attempt ${attempt + 1}/${maxAttempts})`
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}
