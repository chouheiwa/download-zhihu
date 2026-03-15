/**
 * 内容脚本：检测当前知乎页面类型并通知 popup
 * 在知乎页面加载完成后运行
 */

(() => {
  'use strict';

  /**
   * 知乎页面类型检测
   * @param {string} url - 页面 URL
   * @returns {{ type: string, id: string } | null}
   */
  function detectZhihuPage(url) {
    const patterns = [
      { type: 'answer', regex: /zhihu\.com\/question\/(\d+)\/answer\/(\d+)/ },
      { type: 'article', regex: /zhuanlan\.zhihu\.com\/p\/(\d+)/ },
      { type: 'question', regex: /zhihu\.com\/question\/(\d+)$/ },
      { type: 'pin', regex: /zhihu\.com\/pin\/(\d+)/ },
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

  // 响应来自 popup 的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'detect') {
      const result = detectZhihuPage(window.location.href);
      sendResponse(result);
      return true;
    }

    if (message.action === 'extract') {
      try {
        const data = extractContent();
        sendResponse({ success: true, data });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      return true;
    }
  });

  /**
   * 从当前页面提取内容
   * 优先从 js-initialData 提取，回退到 DOM 提取
   */
  function extractContent() {
    const url = window.location.href;
    const pageInfo = detectZhihuPage(url);
    if (!pageInfo) {
      throw new Error('当前页面不是有效的知乎内容页');
    }

    // 尝试从 js-initialData 提取
    const initialData = extractInitialData();
    if (initialData) {
      return extractFromInitialData(initialData, pageInfo, url);
    }

    // 回退到 DOM 提取
    return extractFromDOM(pageInfo, url);
  }

  /**
   * 提取 js-initialData JSON
   */
  function extractInitialData() {
    const scriptTag = document.querySelector('script#js-initialData[type="text/json"]');
    if (!scriptTag || !scriptTag.textContent) return null;

    try {
      return JSON.parse(scriptTag.textContent);
    } catch {
      return null;
    }
  }

  /**
   * 从 initialData JSON 提取内容
   */
  function extractFromInitialData(jsonData, pageInfo, url) {
    const { type, id } = pageInfo;

    switch (type) {
      case 'answer': {
        const questionMatch = url.match(/question\/(\d+)/);
        const questionId = questionMatch ? questionMatch[1] : '';
        const answerData = jsonData?.initialState?.entities?.answers?.[id];
        return {
          type,
          url,
          title: answerData?.question?.title || `知乎问题${questionId}`,
          author: answerData?.author?.name || '知乎用户',
          html: answerData?.content || '',
        };
      }
      case 'article': {
        const articleData = jsonData?.initialState?.entities?.articles?.[id];
        return {
          type,
          url,
          title: articleData?.title || `知乎文章${id}`,
          author: articleData?.author?.name || '知乎用户',
          html: articleData?.content || '',
        };
      }
      case 'question': {
        const questionData = jsonData?.initialState?.entities?.questions?.[id];
        const questionDetail = questionData?.detail || '';
        const title = questionData?.title || `知乎问题${id}`;
        const asker = questionData?.author?.name || '知乎用户';

        // 附上问题下的回答
        const answers = jsonData?.initialState?.entities?.answers || {};
        let answersHtml = '';
        for (const key in answers) {
          const answer = answers[key];
          const answerAuthor = answer?.author?.name || '知乎用户';
          const answerUrl = `https://www.zhihu.com/question/${id}/answer/${answer?.id}`;
          answersHtml += `<h1><a href="${answerUrl}">${answerAuthor}的回答</a></h1>`;
          answersHtml += `<div>${answer?.content || ''}</div>`;
        }

        return {
          type,
          url,
          title,
          author: asker,
          html: questionDetail + answersHtml,
        };
      }
      case 'pin': {
        const pinData = jsonData?.initialState?.entities?.pins?.[id];
        const users = jsonData?.initialState?.entities?.users || {};

        let author = '知乎用户';
        for (const key in users) {
          if (users[key]?.name) {
            author = users[key].name;
            break;
          }
        }

        const contentHtml = typeof pinData?.contentHtml === 'string' ? pinData.contentHtml : '';
        const contentArr = Array.isArray(pinData?.content) ? pinData.content : [];
        const imgsHtml = contentArr
          .filter((entry) => entry?.type === 'image' && entry?.originalUrl)
          .map((entry) => {
            const w = entry.width ? ` width="${entry.width}"` : '';
            const h = entry.height ? ` height="${entry.height}"` : '';
            return `<img src="${entry.originalUrl}" alt=""${w}${h} />`;
          })
          .join('\n');

        return {
          type,
          url,
          title: `想法${id}`,
          author,
          html: contentHtml + (imgsHtml ? `<div>${imgsHtml}</div>` : ''),
        };
      }
      default:
        throw new Error(`不支持的类型: ${type}`);
    }
  }

  /**
   * DOM 回退提取（当 js-initialData 不可用时）
   */
  function extractFromDOM(pageInfo, url) {
    const { type } = pageInfo;

    switch (type) {
      case 'article': {
        const titleEl = document.querySelector('.Post-Title');
        const contentEl = document.querySelector('.Post-RichText');
        const authorEl = document.querySelector('.AuthorInfo-name .UserLink-link');
        return {
          type,
          url,
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
          type,
          url,
          title: titleEl?.textContent?.trim() || '知乎回答',
          author: authorEl?.textContent?.trim() || '知乎用户',
          html: contentEl?.innerHTML || '',
        };
      }
      case 'question': {
        const titleEl = document.querySelector('.QuestionHeader-title');
        const detailEl = document.querySelector('.QuestionRichText--collapsed, .QuestionRichText--expandable');
        return {
          type,
          url,
          title: titleEl?.textContent?.trim() || '知乎问题',
          author: '知乎用户',
          html: detailEl?.innerHTML || '',
        };
      }
      case 'pin': {
        const contentEl = document.querySelector('.PinItem-contentWrapper');
        return {
          type,
          url,
          title: '知乎想法',
          author: '知乎用户',
          html: contentEl?.innerHTML || '',
        };
      }
      default:
        throw new Error(`不支持的类型: ${type}`);
    }
  }
})();
