/**
 * 知乎 HTML 内容识别工具
 * 提供知乎页面特有 HTML 结构的统一检测方法
 * 供 html-to-markdown.ts 和 html-to-docx.ts 共享使用
 */

'use strict';

/**
 * 获取节点的公式类型
 * 支持 <img eeimg="1|2"> 和 <span data-eeimg="1|2" data-tex="...">
 * @returns {'1'|'2'|null} 1=行内公式, 2=块级公式, null=非公式
 */
export function getEeimg(node: Element): string | null {
  return node.getAttribute('eeimg') || node.getAttribute('data-eeimg') || null;
}

/**
 * 从公式节点提取 LaTeX 内容
 * 优先 data-tex，fallback 到 alt
 */
export function getLatex(node: Element): string {
  return (node.getAttribute('data-tex') || node.getAttribute('alt') || '').trim();
}

/**
 * 判断是否为行内公式节点
 */
export function isInlineMath(node: Element): boolean {
  const v = getEeimg(node);
  return v !== null && v !== '2';
}

/**
 * 判断是否为块级公式节点
 */
export function isBlockMath(node: Element): boolean {
  return getEeimg(node) === '2';
}

/**
 * 判断是否为公式节点（行内或块级）
 */
export function isMath(node: Element): boolean {
  return getEeimg(node) !== null;
}

/**
 * 解析图片 src，优先取高清源
 */
export function getImageUrl(node: Element): string {
  return node.getAttribute('data-original')
    || node.getAttribute('data-actualsrc')
    || node.getAttribute('src')
    || '';
}

/**
 * 判断是否为普通图片（非公式）
 */
export function isImage(node: Element): boolean {
  return node.nodeName === 'IMG' && !isMath(node);
}

/**
 * 判断是否为知乎引用脚注 <sup data-text="..." data-url="..." data-numero="n">
 */
export function isFootnote(node: Element): boolean {
  return node.nodeName === 'SUP' && typeof (node as HTMLElement).dataset?.text === 'string';
}

/**
 * 从脚注节点提取信息
 * @returns {{ numero: string, text: string, url: string }}
 */
export function getFootnoteInfo(node: HTMLElement): { numero: string; text: string; url: string } {
  return {
    numero: node.dataset.numero || '1',
    text: node.dataset.text || node.textContent || '',
    url: node.dataset.url || '',
  };
}

/**
 * 判断是否为知乎视频占位 <a class="video-box">
 */
export function isVideo(node: Element): boolean {
  return node.nodeName === 'A' && node.classList.contains('video-box');
}

/**
 * 从视频节点提取标题和链接
 * @returns {{ title: string, href: string }}
 */
export function getVideoInfo(node: Element): { title: string; href: string } {
  const href = node.getAttribute('href') || '';
  const titleEl = node.querySelector('.video-box-title');
  return { title: titleEl?.textContent?.trim() || '视频', href };
}

/**
 * 判断是否为知乎链接卡片 <a class="LinkCard">
 */
export function isLinkCard(node: Element): boolean {
  return node.nodeName === 'A' && node.classList.contains('LinkCard');
}

/**
 * 从链接卡片节点提取标题和链接
 * @returns {{ title: string, href: string }}
 */
export function getLinkCardInfo(node: Element): { title: string; href: string } {
  const href = node.getAttribute('href') || '';
  const titleEl = node.querySelector('.LinkCard-title');
  return { title: titleEl?.textContent?.trim() || href, href };
}

/**
 * 判断是否为知乎目录导航
 */
export function isCatalog(node: Element): boolean {
  return node.classList?.contains('Catalog')
    || node.classList?.contains('Catalog-content')
    || !!node.querySelector?.(':scope > .Catalog-content');
}

/**
 * 判断是否为知乎参考文献列表
 */
export function isReferenceList(node: Element): boolean {
  return !!node.classList?.contains('ReferenceList');
}
