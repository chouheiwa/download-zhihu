import { ApiError } from '@/types/messages';
import * as throttle from './throttle';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF = 30000;

interface ProxyResponseData {
  ok?: boolean;
  data?: unknown;
  error?: string;
  status?: number;
}

export type FetchLikeResponse = {
  ok: true;
  status: 200;
  json: () => Promise<unknown>;
  text: () => Promise<unknown>;
};

/**
 * 通过 content script 代理请求（Extension Page 专用）
 */
function proxyFetch(url: string, responseType?: string): Promise<FetchLikeResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'proxyFetch', url, responseType },
      (response: ProxyResponseData) => {
        if (chrome.runtime.lastError) {
          reject(new ApiError(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.ok) {
          reject(new ApiError(response?.error || '代理请求失败', response?.status));
          return;
        }
        resolve({
          ok: true as const,
          status: 200 as const,
          json: async () => response.data,
          text: async () => response.data,
        });
      }
    );
  });
}

/**
 * Extension Page 专用：带 403 指数退避重试的代理请求
 */
export async function proxyFetchWithRetry(url: string, responseType?: string): Promise<FetchLikeResponse> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) await throttle.waitForInterval();
      return await proxyFetch(url, responseType);
    } catch (err) {
      if (err instanceof ApiError && err.httpStatus === 403 && attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF * Math.pow(2, attempt);
        const onRetry = throttle.getOnRetry();
        if (onRetry) onRetry(attempt + 1, MAX_RETRIES, backoff);
        await new Promise<void>((r) => setTimeout(r, backoff));
        continue;
      }
      throw err;
    }
  }
  throw new ApiError('请求被限制：已达最大重试次数，请稍后再试或手动完成验证码后重试', 403);
}
