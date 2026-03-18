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

  /**
   * API 请求：
   * - 在知乎页面（content script）：直接 fetch（同源）
   * - 在 Extension Page：通过 service worker → content script 代理
   */
  async function apiFetch(url) {
    await throttle.waitForInterval();

    if (isExtensionPage) {
      return proxyFetch(url);
    }

    return throttle.throttledFetch(url, {
      credentials: 'include',
      headers: { 'Accept': '*/*' },
    });
  }

  /**
   * 通过 content script 代理请求（Extension Page 专用）
   */
  function proxyFetch(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'proxyFetch', url },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response || !response.ok) {
            reject(new Error(response?.error || '代理请求失败'));
            return;
          }
          // 包装成类似 Response 的对象供调用方使用
          resolve({
            ok: true,
            status: 200,
            json: async () => response.data,
          });
        }
      );
    });
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
    const items = (data.data || []).map((item) => {
      const c = item.content || {};
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
        // 想法：content 可能是数组，HTML 在 excerpt 或 contentHtml
        html = (typeof c.content === 'string' ? c.content : '') || c.excerpt || '';
        // 用内容前 30 字做标题
        const textContent = html.replace(/<[^>]*>/g, '').trim();
        title = textContent.slice(0, 30) || `想法`;
        // 如果 content 是数组，拼接图片
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

      // ID: 优先用 content.id，没有则用 url hash 或时间戳合成
      const rawId = c.id || '';
      const id = rawId
        ? String(rawId)
        : (c.url || `${type}_${item.created_time || Math.random()}`);

      return {
        id,
        type,
        url: c.url || '',
        title,
        author: c.author?.name || '知乎用户',
        html,
        commentCount: c.comment_count || 0,
        created_time: item.created_time || 0,
      };
    });

    return {
      items,
      nextUrl: paging.is_end ? null : (paging.next || null),
      totals: paging.totals || 0,
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
      if (!response.ok) throw new Error(`评论 API 请求失败: ${response.status}`);

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
      if (!response.ok) break;

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

    for (let i = 0; i < comments.length; i++) {
      const comment = comments[i];

      if (comment.child_comment_count > 0) {
        comment.child_comments = await fetchChildComments(comment.id);
      }

      if (onProgress) onProgress(i + 1, comments.length);
    }

    return comments;
  }

  window.__zhihuApi = {
    detectPage,
    fetchCollectionPage,
    fetchRootComments,
    fetchChildComments,
    fetchAllComments,
  };
})();
