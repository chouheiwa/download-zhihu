/**
 * 知乎 API 调用层
 * 从 detector.js 抽取，使用 throttledFetch 实现请求节流
 * 挂载到 window.__zhihuApi 供 Extension Page 和 content script 使用
 */

(() => {
  'use strict';

  const throttle = window.__throttle;

  // 检测是否运行在 Extension Page（非知乎域名）
  const isExtensionPage = location.protocol === 'chrome-extension:';

  const MAX_RETRIES = 3;
  const INITIAL_BACKOFF = 30000; // 首次 403 退避 30s

  /**
   * API 请求：
   * - 在知乎页面（content script）：直接 fetch（同源）
   * - 在 Extension Page：通过 service worker → content script 代理（含 403 重试）
   */
  async function apiFetch(url, responseType) {
    await throttle.waitForInterval();

    if (isExtensionPage) {
      return proxyFetchWithRetry(url, responseType);
    }

    return throttle.throttledFetch(url, {
      credentials: 'include',
      headers: { 'Accept': '*/*' },
    });
  }

  /**
   * Extension Page 专用：带 403 指数退避重试的代理请求
   */
  async function proxyFetchWithRetry(url, responseType) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) await throttle.waitForInterval();
        return await proxyFetch(url, responseType);
      } catch (err) {
        if (err.httpStatus === 403 && attempt < MAX_RETRIES) {
          const backoff = INITIAL_BACKOFF * Math.pow(2, attempt);
          const onRetry = throttle.getOnRetry();
          if (onRetry) onRetry(attempt + 1, MAX_RETRIES, backoff);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw err;
      }
    }
    throw new Error('请求被限制：已达最大重试次数，请稍后再试或手动完成验证码后重试');
  }

  /**
   * 通过 content script 代理请求（Extension Page 专用）
   */
  function proxyFetch(url, responseType) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'proxyFetch', url, responseType },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response || !response.ok) {
            const err = new Error(response?.error || '代理请求失败');
            err.httpStatus = response?.status;
            reject(err);
            return;
          }
          // 包装成类似 Response 的对象供调用方使用
          resolve({
            ok: true,
            status: 200,
            json: async () => response.data,
            text: async () => response.data,
          });
        }
      );
    });
  }

  // 知乎 API 的 paging.next 可能返回 http://，修正为 https://
  function fixHttpUrl(url) {
    if (!url) return null;
    return url.replace(/^http:\/\//, 'https://');
  }

  // ============================
  // 页面类型检测（纯函数，无 DOM 依赖）
  // ============================

  function detectPage(url) {
    const patterns = [
      { type: 'answer', regex: /zhihu\.com\/question\/(\d+)\/answer\/(\d+)/ },
      { type: 'article', regex: /zhuanlan\.zhihu\.com\/p\/(\d+)/ },
      { type: 'question', regex: /zhihu\.com\/question\/(\d+)\/?(\?|$|#)/ },
      { type: 'pin', regex: /zhihu\.com\/pin\/(\d+)/ },
      { type: 'collection', regex: /zhihu\.com\/collection\/(\d+)/ },
      { type: 'column', regex: /zhihu\.com\/column\/([^/?#]+)/ },
      { type: 'column', regex: /zhuanlan\.zhihu\.com\/([^/?#p][^/?#]*)/ },
    ];

    for (const { type, regex } of patterns) {
      const match = url.match(regex);
      if (match) {
        const id = type === 'answer' ? match[2] : match[1];
        return { type, id };
      }
    }
    return null;
  }

  // ============================
  // 收藏夹 API
  // ============================

  async function fetchCollectionPage(apiUrl) {
    const response = await apiFetch(apiUrl);

    if (!response.ok) {
      throw new Error(`API 请求失败: ${response.status}`);
    }

    const data = await response.json();
    const paging = data.paging || {};
    // 收藏夹的 item.content 是实际内容对象
    const items = (data.data || []).map((item) =>
      parseContentItem(item.content || {}, item.created_time || 0)
    );

    return {
      items,
      nextUrl: paging.is_end ? null : fixHttpUrl(paging.next),
      totals: paging.totals || 0,
    };
  }

  // ============================
  // 专栏 API
  // ============================

  /**
   * 解析单个内容条目（收藏夹和专栏共用）
   * 收藏夹的 c = item.content，专栏的 c = item 本身
   */
  function parseContentItem(c, createdTime) {
    const type = c.type || 'unknown';

    let title = '';
    let html = '';

    if (type === 'article') {
      title = c.title || '';
      html = c.content || '';
    } else if (type === 'answer') {
      title = c.question?.title || '';
      html = c.content || '';
    } else if (type === 'pin') {
      html = (typeof c.content === 'string' ? c.content : '') || c.excerpt || '';
      const textContent = html.replace(/<[^>]*>/g, '').trim();
      title = textContent.slice(0, 30) || '想法';
      if (Array.isArray(c.content)) {
        const imgsHtml = c.content
          .filter((e) => e?.type === 'image' && e?.url)
          .map((e) => `<img src="${e.url}" alt="" />`)
          .join('\n');
        if (imgsHtml) html += `\n${imgsHtml}`;
      }
    } else {
      html = (typeof c.content === 'string' ? c.content : '') || c.excerpt || '';
      title = c.title || '';
    }

    const rawId = c.id || '';
    const id = rawId
      ? String(rawId)
      : (c.url || `${type}_${createdTime || Math.random()}`);

    return {
      id,
      type,
      url: c.url || '',
      title,
      author: c.author?.name || '知乎用户',
      html,
      isTruncated: !!(c.content_need_truncated),
      isPaidContent: c.is_free === 0,
      commentCount: c.comment_count || 0,
      created_time: c.created_time || c.created || createdTime,
      updated_time: c.updated_time || c.updated || 0,
    };
  }

  async function fetchColumnPage(apiUrl) {
    const response = await apiFetch(apiUrl);

    if (!response.ok) {
      throw new Error(`API 请求失败: ${response.status}`);
    }

    const data = await response.json();
    const paging = data.paging || {};
    // 专栏的 items 直接就是内容对象（不像收藏夹有 item.content 嵌套）
    const items = (data.data || []).map((c) =>
      parseContentItem(c, c.created_time || c.created || 0)
    );

    return {
      items,
      nextUrl: paging.is_end ? null : fixHttpUrl(paging.next),
      totals: paging.totals || items.length,
    };
  }

  // ============================
  // 评论 API
  // ============================

  const COMMENT_TYPE_MAP = {
    article: 'articles',
    answer: 'answers',
    pin: 'pins',
  };

  async function fetchRootComments(type, id) {
    const apiType = COMMENT_TYPE_MAP[type];
    if (!apiType) return { comments: [], totals: 0 };

    const comments = [];
    let totals = 0;
    let prevUrl = '';
    let nextUrl = `https://www.zhihu.com/api/v4/comment_v5/${apiType}/${id}/root_comment?order_by=score&limit=20&offset=`;

    while (nextUrl) {
      const response = await apiFetch(nextUrl);
      if (!response.ok) {
        const err = new Error(
          response.status === 403
            ? '请求被知乎限流（HTTP 403），可能需要完成验证码验证。请在知乎页面完成验证后重试。'
            : `评论 API 请求失败: ${response.status}`
        );
        err.httpStatus = response.status;
        throw err;
      }

      const data = await response.json();
      const paging = data.paging || {};
      const pageData = data.data || [];
      totals = paging.totals ?? totals;

      // 防止死循环：data 为空或 next 指向自身则停止
      if (pageData.length === 0) break;

      comments.push(...pageData);

      if (paging.is_end) break;
      const candidate = paging.next || null;
      if (!candidate || candidate === prevUrl || candidate === nextUrl) break;
      prevUrl = nextUrl;
      nextUrl = candidate;
    }

    return { comments, totals };
  }

  async function fetchChildComments(rootCommentId) {
    const children = [];
    let prevUrl = '';
    let nextUrl = `https://www.zhihu.com/api/v4/comment_v5/comment/${rootCommentId}/child_comment?order_by=score&limit=20&offset=`;

    while (nextUrl) {
      const response = await apiFetch(nextUrl);
      if (!response.ok) {
        throw new Error(`子评论请求失败: ${response.status}`);
      }

      const data = await response.json();
      const paging = data.paging || {};
      const pageData = data.data || [];

      if (pageData.length === 0) break;

      children.push(...pageData);

      if (paging.is_end) break;
      const candidate = paging.next || null;
      if (!candidate || candidate === prevUrl || candidate === nextUrl) break;
      prevUrl = nextUrl;
      nextUrl = candidate;
    }

    return children;
  }

  async function fetchAllComments(type, id, onProgress) {
    const { comments } = await fetchRootComments(type, id);

    let rateLimited = false;

    for (let i = 0; i < comments.length; i++) {
      const comment = comments[i];

      if (comment.child_comment_count > 0) {
        try {
          comment.child_comments = await fetchChildComments(comment.id);
        } catch (err) {
          // 403 被限流时中断整个评论获取，提示用户
          if (err.httpStatus === 403 || err.message?.includes('403')) {
            rateLimited = true;
            comment.child_comments = [];
            break;
          }
          // 其他错误：跳过该评论的子评论，继续处理下一条
          console.warn(`子评论加载失败 (comment ${comment.id}):`, err.message);
          comment.child_comments = [];
        }
      }

      if (onProgress) onProgress(i + 1, comments.length);
    }

    if (rateLimited) {
      const err = new Error('请求被知乎限流（HTTP 403），可能需要完成验证码验证。请在知乎页面完成验证后重试。');
      err.httpStatus = 403;
      err.partialComments = comments;
      throw err;
    }

    return comments;
  }

  // ============================
  // 单篇完整内容 API
  // ============================

  /**
   * 检查付费内容用户是否已购买
   * @returns {boolean} true 表示已购买可访问完整内容
   */
  async function checkPaidAccess(type, id) {
    try {
      const apiUrl = `https://www.zhihu.com/api/v4/column/paid-column/card?content_type=${type}&content_id=${id}`;
      const response = await apiFetch(apiUrl);
      if (!response.ok) return false;
      const data = await response.json();
      return !!(data.data?.has_purchased || data.data?.has_ownership);
    } catch {
      return false;
    }
  }

  /**
   * 获取单篇文章/回答的完整内容
   * 访问文章页面，从 initialData 和 DOM 两个来源提取，取更长的
   * 与单篇导出使用相同的逻辑
   * @param {string} type - 'article' | 'answer'
   * @param {string} itemUrl - 文章/回答的页面 URL
   */
  async function fetchFullContent(type, itemUrl) {
    if (!itemUrl) return null;

    const response = await apiFetch(itemUrl, 'text');
    if (!response.ok) return null;

    const pageHtml = await response.text();
    if (!pageHtml) return null;

    const pageInfo = detectPage(itemUrl);
    if (!pageInfo) return null;

    // 来源 1：从 initialData 提取
    let fromData = '';
    const scriptMatch = pageHtml.match(/<script\s+id="js-initialData"\s+type="text\/json">([^<]+)<\/script>/);
    if (scriptMatch) {
      try {
        const initialData = JSON.parse(scriptMatch[1]);
        if (type === 'article') {
          fromData = initialData?.initialState?.entities?.articles?.[pageInfo.id]?.content || '';
        } else if (type === 'answer') {
          fromData = initialData?.initialState?.entities?.answers?.[pageInfo.id]?.content || '';
        }
      } catch { /* 解析失败 */ }
    }

    // 来源 2：从 DOM 提取
    let fromDOM = '';
    const doc = new DOMParser().parseFromString(pageHtml, 'text/html');
    if (type === 'article') {
      fromDOM = doc.querySelector('.Post-RichText')?.innerHTML || '';
    } else if (type === 'answer') {
      fromDOM = doc.querySelector('.RichContent-inner')?.innerHTML || '';
    }

    // 取更长的
    return fromDOM.length > fromData.length ? fromDOM : (fromData || null);
  }

  window.__zhihuApi = {
    detectPage,
    fetchCollectionPage,
    fetchColumnPage,
    checkPaidAccess,
    fetchFullContent,
    fetchRootComments,
    fetchChildComments,
    fetchAllComments,
  };
})();
