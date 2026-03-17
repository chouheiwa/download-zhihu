/**
 * 数据层：知乎页面检测 + 内容提取 + 收藏夹 API
 * 所有函数挂载到 window.__zhihuDownloader 供 floating-ui.js 调用
 */

(() => {
  'use strict';

  // ============================
  // 页面类型检测
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
  // 单篇内容提取
  // ============================

  function extractContent() {
    const url = window.location.href;
    const pageInfo = detectPage(url);
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
  // 收藏夹
  // ============================

  function getCollectionInfo() {
    const url = window.location.href;
    const match = url.match(/zhihu\.com\/collection\/(\d+)/);
    if (!match) return null;

    const id = match[1];

    // 尝试多种选择器获取收藏夹标题
    const titleEl =
      document.querySelector('.CollectionDetailPageHeader-title') ||
      document.querySelector('[class*="CollectionDetail"] h2') ||
      document.querySelector('h1');

    return {
      id,
      title: titleEl?.textContent?.trim() || `收藏夹${id}`,
      itemCount: 0, // 由 API 获取真实数量
      apiUrl: `https://www.zhihu.com/api/v4/collections/${id}/items?offset=0&limit=20`,
    };
  }

  async function fetchCollectionPage(apiUrl) {
    const response = await fetch(apiUrl, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`API 请求失败: ${response.status}`);
    }

    const data = await response.json();
    const paging = data.paging || {};
    const items = (data.data || []).map((item) => {
      const c = item.content || {};
      const type = c.type || 'unknown';

      let title = '';
      if (type === 'article') {
        title = c.title || '';
      } else if (type === 'answer') {
        title = c.question?.title || '';
      }

      return {
        type,
        url: c.url || '',
        title,
        author: c.author?.name || '知乎用户',
        html: c.content || '',
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
    let nextUrl = `https://www.zhihu.com/api/v4/comment_v5/${apiType}/${id}/root_comment?order_by=ts&limit=20&offset=`;

    while (nextUrl) {
      const response = await fetch(nextUrl, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });
      if (!response.ok) throw new Error(`评论 API 请求失败: ${response.status}`);

      const data = await response.json();
      const paging = data.paging || {};
      totals = paging.totals ?? totals;
      comments.push(...(data.data || []));
      nextUrl = paging.is_end ? null : (paging.next || null);
    }

    return { comments, totals };
  }

  async function fetchChildComments(rootCommentId) {
    const children = [];
    let nextUrl = `https://www.zhihu.com/api/v4/comment_v5/comment/${rootCommentId}/child_comment?order_by=ts&limit=20&offset=`;

    while (nextUrl) {
      const response = await fetch(nextUrl, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });
      if (!response.ok) break;

      const data = await response.json();
      const paging = data.paging || {};
      children.push(...(data.data || []));
      nextUrl = paging.is_end ? null : (paging.next || null);
    }

    return children;
  }

  async function fetchAllComments(type, id, onProgress) {
    const { comments } = await fetchRootComments(type, id);

    for (let i = 0; i < comments.length; i++) {
      const comment = comments[i];

      if (comment.child_comment_count > 0 &&
          (comment.child_comments || []).length < comment.child_comment_count) {
        comment.child_comments = await fetchChildComments(comment.id);
      }

      if (onProgress) onProgress(i + 1, comments.length);
    }

    return comments;
  }

  // ============================
  // 导出到 window
  // ============================

  window.__zhihuDownloader = {
    detectPage,
    extractContent,
    getCollectionInfo,
    fetchCollectionPage,
    fetchAllComments,
  };
})();
