/**
 * 请求节流模块：统一的 API 请求间隔控制 + 403 指数退避重试
 * 挂载到 window.__throttle 供其他模块使用
 */

(() => {
  'use strict';

  const MIN_INTERVAL = 500; // 请求间最小间隔 (ms)
  const MAX_RETRIES = 3;
  const INITIAL_BACKOFF = 30000; // 首次 403 退避 30s

  let lastRequestTime = 0;
  let onRetryCallback = null;

  /**
   * 设置重试时的回调（用于 UI 通知）
   * @param {function(number, number, number): void} cb - (retryCount, maxRetries, waitMs)
   */
  function setOnRetry(cb) {
    onRetryCallback = cb;
  }

  /**
   * 等待直到满足最小请求间隔
   */
  async function waitForInterval() {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_INTERVAL) {
      await new Promise((r) => setTimeout(r, MIN_INTERVAL - elapsed));
    }
  }

  /**
   * 带节流和 403 重试的 fetch
   * @param {string} url
   * @param {RequestInit} [options]
   * @returns {Promise<Response>}
   */
  async function throttledFetch(url, options) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await waitForInterval();
      lastRequestTime = Date.now();

      const response = await fetch(url, options);

      if (response.status === 403 && attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF * Math.pow(2, attempt);
        if (onRetryCallback) {
          onRetryCallback(attempt + 1, MAX_RETRIES, backoff);
        }
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      return response;
    }

    // 不应到达这里，但作为保底
    throw new Error('请求失败：已达最大重试次数');
  }

  window.__throttle = {
    throttledFetch,
    waitForInterval,
    setOnRetry,
  };
})();
