// src/shared/api/throttle.ts

const MIN_INTERVAL = 500;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF = 30000;

let lastRequestTime = 0;
let onRetryCallback: ((retryCount: number, maxRetries: number, waitMs: number) => void) | null = null;

export function setOnRetry(cb: typeof onRetryCallback): void {
  onRetryCallback = cb;
}

export function getOnRetry(): typeof onRetryCallback {
  return onRetryCallback;
}

export async function waitForInterval(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL) {
    await new Promise<void>((r) => setTimeout(r, MIN_INTERVAL - elapsed));
  }
}

export async function throttledFetch(url: string, options?: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await waitForInterval();
    lastRequestTime = Date.now();

    const response = await fetch(url, options);

    if (response.status === 403 && attempt < MAX_RETRIES) {
      const backoff = INITIAL_BACKOFF * Math.pow(2, attempt);
      if (onRetryCallback) {
        onRetryCallback(attempt + 1, MAX_RETRIES, backoff);
      }
      await new Promise<void>((r) => setTimeout(r, backoff));
      continue;
    }

    return response;
  }

  throw new Error('请求失败：已达最大重试次数');
}
