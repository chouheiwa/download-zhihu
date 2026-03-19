/**
 * 数据层：知乎页面检测 + 内容提取 + 收藏夹信息
 * 依赖 lib/zhihu-api.js（API 调用层）
 * 所有函数挂载到 window.__zhihuDownloader 供 floating-ui.js 调用
 */

(() => {
  'use strict';

  const zhihuApi = window.__zhihuApi;

  // ============================
  // 单篇内容提取
  // ============================

  function extractContent() {
    const url = window.location.href;
    const pageInfo = zhihuApi.detectPage(url);
    if (!pageInfo || pageInfo.type === 'collection') {
      return null;
    }

    const initialData = extractInitialData();
    if (initialData) {
      return extractFromInitialData(initialData, pageInfo, url);
    }
    return extractFromDOM(pageInfo, url);
  }

  function extractInitialData() {
    const scriptTag = document.querySelector('script#js-initialData[type="text/json"]');
    if (!scriptTag || !scriptTag.textContent) return null;
    try {
      return JSON.parse(scriptTag.textContent);
    } catch {
      return null;
    }
  }

  function extractFromInitialData(jsonData, pageInfo, url) {
    const { type, id } = pageInfo;

    switch (type) {
      case 'answer': {
        const questionMatch = url.match(/question\/(\d+)/);
        const questionId = questionMatch ? questionMatch[1] : '';
        const data = jsonData?.initialState?.entities?.answers?.[id];
        return {
          type, url,
          title: data?.question?.title || `知乎问题${questionId}`,
          author: data?.author?.name || '知乎用户',
          html: data?.content || '',
        };
      }
      case 'article': {
        const data = jsonData?.initialState?.entities?.articles?.[id];
        return {
          type, url,
          title: data?.title || `知乎文章${id}`,
          author: data?.author?.name || '知乎用户',
          html: data?.content || '',
        };
      }
      case 'question': {
        const data = jsonData?.initialState?.entities?.questions?.[id];
        const detail = data?.detail || '';
        const title = data?.title || `知乎问题${id}`;
        const asker = data?.author?.name || '知乎用户';

        const answers = jsonData?.initialState?.entities?.answers || {};
        let answersHtml = '';
        for (const key in answers) {
          const answer = answers[key];
          const aAuthor = answer?.author?.name || '知乎用户';
          const aUrl = `https://www.zhihu.com/question/${id}/answer/${answer?.id}`;
          answersHtml += `<h1><a href="${aUrl}">${aAuthor}的回答</a></h1>`;
          answersHtml += `<div>${answer?.content || ''}</div>`;
        }

        return { type, url, title, author: asker, html: detail + answersHtml };
      }
      case 'pin': {
        const pinData = jsonData?.initialState?.entities?.pins?.[id];
        const users = jsonData?.initialState?.entities?.users || {};

        let author = '知乎用户';
        for (const key in users) {
          if (users[key]?.name) { author = users[key].name; break; }
        }

        const contentHtml = typeof pinData?.contentHtml === 'string' ? pinData.contentHtml : '';
        const contentArr = Array.isArray(pinData?.content) ? pinData.content : [];
        const imgsHtml = contentArr
          .filter((e) => e?.type === 'image' && e?.originalUrl)
          .map((e) => {
            const w = e.width ? ` width="${e.width}"` : '';
            const h = e.height ? ` height="${e.height}"` : '';
            return `<img src="${e.originalUrl}" alt=""${w}${h} />`;
          })
          .join('\n');

        return {
          type, url,
          title: `想法${id}`,
          author,
          html: contentHtml + (imgsHtml ? `<div>${imgsHtml}</div>` : ''),
        };
      }
      default:
        return null;
    }
  }

  function extractFromDOM(pageInfo, url) {
    const { type } = pageInfo;
    switch (type) {
      case 'article': {
        const titleEl = document.querySelector('.Post-Title');
        const contentEl = document.querySelector('.Post-RichText');
        const authorEl = document.querySelector('.AuthorInfo-name .UserLink-link');
        return {
          type, url,
          title: titleEl?.textContent?.trim() || '知乎文章',
          author: authorEl?.textContent?.trim() || '知乎用户',
          html: contentEl?.innerHTML || '',
        };
      }
      case 'answer': {
        const titleEl = document.querySelector('.QuestionHeader-title');
        const contentEl = document.querySelector('.RichContent-inner');
        const authorEl = document.querySelector('.AuthorInfo-name .UserLink-link');
        return {
          type, url,
          title: titleEl?.textContent?.trim() || '知乎回答',
          author: authorEl?.textContent?.trim() || '知乎用户',
          html: contentEl?.innerHTML || '',
        };
      }
      case 'question': {
        const titleEl = document.querySelector('.QuestionHeader-title');
        const detailEl = document.querySelector('.QuestionRichText--collapsed, .QuestionRichText--expandable');
        return {
          type, url,
          title: titleEl?.textContent?.trim() || '知乎问题',
          author: '知乎用户',
          html: detailEl?.innerHTML || '',
        };
      }
      case 'pin': {
        const contentEl = document.querySelector('.PinItem-contentWrapper');
        return {
          type, url,
          title: '知乎想法',
          author: '知乎用户',
          html: contentEl?.innerHTML || '',
        };
      }
      default:
        return null;
    }
  }

  // ============================
  // 收藏夹信息（需要 DOM）
  // ============================

  function getCollectionInfo() {
    const url = window.location.href;
    const match = url.match(/zhihu\.com\/collection\/(\d+)/);
    if (!match) return null;

    const id = match[1];
    const titleEl =
      document.querySelector('.CollectionDetailPageHeader-title') ||
      document.querySelector('[class*="CollectionDetail"] h2') ||
      document.querySelector('h1');

    return {
      id,
      title: titleEl?.textContent?.trim() || `收藏夹${id}`,
      itemCount: 0,
      apiUrl: `https://www.zhihu.com/api/v4/collections/${id}/items?offset=0&limit=20`,
    };
  }

  // ============================
  // 专栏信息（需要 DOM）
  // ============================

  function getColumnInfo() {
    const url = window.location.href;
    const match = url.match(/zhihu\.com\/column\/([^/?#]+)/);
    if (!match) return null;

    const id = match[1];

    // 从页面标题提取，去掉 "(N 条消息)" 前缀和 " - 知乎" 后缀
    let title = '';
    const pageTitle = (document.title || '').replace(/^\(\d+\s*条消息\)\s*/, '');
    if (pageTitle) {
      title = pageTitle.split(' - ')[0].trim();
    }

    // 兜底：从初始数据或 meta 提取
    if (!title) {
      const metaDesc = document.querySelector('meta[name="description"]');
      title = metaDesc?.content?.trim() || '';
    }

    if (!title) {
      title = document.querySelector('h1')?.textContent?.trim() || `专栏${id}`;
    }

    return {
      id,
      title,
      itemCount: 0,
      apiUrl: `https://www.zhihu.com/api/v4/columns/${id}/items`,
    };
  }

  // ============================
  // 导出到 window（兼容现有调用方）
  // ============================

  window.__zhihuDownloader = {
    detectPage: zhihuApi.detectPage,
    extractContent,
    getCollectionInfo,
    getColumnInfo,
    fetchCollectionPage: zhihuApi.fetchCollectionPage,
    fetchColumnPage: zhihuApi.fetchColumnPage,
    fetchAllComments: zhihuApi.fetchAllComments,
  };

  // ============================
  // Fetch 代理：通过页面上下文发起请求
  // 页面 JS 环境中的 fetch 会被知乎的请求拦截器自动加上 x-zse 签名头
  // ============================

  // 1. 注入桥接脚本到页面 JS 上下文（外部文件，不受 CSP 限制）
  const bridgeScript = document.createElement('script');
  bridgeScript.src = chrome.runtime.getURL('content/fetch-bridge.js');
  (document.head || document.documentElement).appendChild(bridgeScript);
  bridgeScript.onload = () => bridgeScript.remove();

  // 2. Content script 侧：管理请求/响应
  const pendingRequests = new Map();
  let requestIdCounter = 0;

  window.addEventListener('__zhihu_dl_fetch_response', (e) => {
    const { id, data, error } = e.detail;
    const pending = pendingRequests.get(id);
    if (pending) {
      pendingRequests.delete(id);
      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(data);
      }
    }
  });

  function pageFetch(url) {
    return new Promise((resolve, reject) => {
      const id = ++requestIdCounter;
      pendingRequests.set(id, { resolve, reject });
      window.dispatchEvent(new CustomEvent('__zhihu_dl_fetch_request', {
        detail: { id, url }
      }));
      // 超时 30 秒
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error('页面代理请求超时'));
        }
      }, 30000);
    });
  }

  // 3. 接收 service worker 转发的请求，通过页面上下文代理
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== 'fetchProxy') return;

    pageFetch(message.url)
      .then((data) => sendResponse({ data }))
      .catch((err) => sendResponse({ error: err.message }));

    return true;
  });
})();
