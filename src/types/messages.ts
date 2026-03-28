/** Content Script / Extension Page → Service Worker 消息 */
export type ExtensionMessage =
  | { action: 'openExportPage'; url: string }
  | { action: 'proxyFetch'; url: string; responseType?: 'text' | 'json' }

/** Service Worker → Content Script 消息 */
export type ContentScriptMessage =
  | { action: 'fetchProxy'; url: string; responseType?: 'text' | 'json' }

/** proxyFetch 响应 */
export type ProxyResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; status?: number }

/** API 请求错误（携带 HTTP 状态码） */
export class ApiError extends Error {
  httpStatus?: number;
  partialComments?: unknown[];

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.httpStatus = status;
  }
}
