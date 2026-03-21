/**
 * 知乎 HTML 内容识别工具
 * 提供知乎页面特有 HTML 结构的统一检测方法
 * 供 html-to-markdown.js 和 html-to-docx.js 共享使用
 */

window.__zhihuHtmlUtils = (() => {
  'use strict';

  /**
   * 获取节点的公式类型
   * 支持 <img eeimg="1|2"> 和 <span data-eeimg="1|2" data-tex="...">
   * @returns {'1'|'2'|null} 1=行内公式, 2=块级公式, null=非公式
   */
  function getEeimg(node) {
    return node.getAttribute('eeimg') || node.getAttribute('data-eeimg') || null;
  }

  /**
   * 从公式节点提取 LaTeX 内容
   * 优先 data-tex，fallback 到 alt
   */
  function getLatex(node) {
    return (node.getAttribute('data-tex') || node.getAttribute('alt') || '').trim();
  }

  /**
   * 判断是否为行内公式节点
   */
  function isInlineMath(node) {
    const v = getEeimg(node);
    return v !== null && v !== '2';
  }

  /**
   * 判断是否为块级公式节点
   */
  function isBlockMath(node) {
    return getEeimg(node) === '2';
  }

  /**
   * 判断是否为公式节点（行内或块级）
   */
  function isMath(node) {
    return getEeimg(node) !== null;
  }

  /**
   * 解析图片 src，优先取高清源
   */
  function getImageUrl(node) {
    return node.getAttribute('data-original')
      || node.getAttribute('data-actualsrc')
      || node.getAttribute('src')
      || '';
  }

  /**
   * 判断是否为普通图片（非公式）
   */
  function isImage(node) {
    return node.nodeName === 'IMG' && !isMath(node);
  }

  /**
   * 判断是否为知乎引用脚注 <sup data-text="..." data-url="..." data-numero="n">
   */
  function isFootnote(node) {
    return node.nodeName === 'SUP' && typeof node.dataset?.text === 'string';
  }

  /**
   * 从脚注节点提取信息
   * @returns {{ numero: string, text: string, url: string }}
   */
  function getFootnoteInfo(node) {
    return {
      numero: node.dataset.numero || '1',
      text: node.dataset.text || node.textContent || '',
      url: node.dataset.url || '',
    };
  }

  /**
   * 判断是否为知乎视频占位 <a class="video-box">
   */
  function isVideo(node) {
    return node.nodeName === 'A' && node.classList.contains('video-box');
  }

  /**
   * 从视频节点提取标题和链接
   * @returns {{ title: string, href: string }}
   */
  function getVideoInfo(node) {
    const href = node.getAttribute('href') || '';
    const titleEl = node.querySelector('.video-box-title');
    return { title: titleEl?.textContent?.trim() || '视频', href };
  }

  /**
   * 判断是否为知乎链接卡片 <a class="LinkCard">
   */
  function isLinkCard(node) {
    return node.nodeName === 'A' && node.classList.contains('LinkCard');
  }

  /**
   * 从链接卡片节点提取标题和链接
   * @returns {{ title: string, href: string }}
   */
  function getLinkCardInfo(node) {
    const href = node.getAttribute('href') || '';
    const titleEl = node.querySelector('.LinkCard-title');
    return { title: titleEl?.textContent?.trim() || href, href };
  }

  /**
   * 判断是否为知乎目录导航
   */
  function isCatalog(node) {
    return node.classList?.contains('Catalog')
      || node.classList?.contains('Catalog-content')
      || !!node.querySelector?.(':scope > .Catalog-content');
  }

  /**
   * 判断是否为知乎参考文献列表
   */
  function isReferenceList(node) {
    return node.classList?.contains('ReferenceList');
  }

  return {
    getEeimg, getLatex, isInlineMath, isBlockMath, isMath,
    getImageUrl, isImage,
    isFootnote, getFootnoteInfo,
    isVideo, getVideoInfo,
    isLinkCard, getLinkCardInfo,
    isCatalog, isReferenceList,
  };
})();
