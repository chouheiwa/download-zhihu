// src/shared/converters/html-to-docx.ts
// HTML → docx Document 转换器
// 依赖: docx, temml, mathml2omml

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  ExternalHyperlink, ImageRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ShadingType,
  Math as DocxMath, MathRun as DocxMathRun,
  MathFraction, MathSuperScript, MathSubScript, MathSubSuperScript,
  MathRadical, MathRoundBrackets, MathSquareBrackets, MathCurlyBrackets,
  MathSum, MathIntegral, MathAccentCharacter,
  MathLimitLower, MathLimitUpper, MathFunction,
  EndnoteReferenceRun,
  LevelFormat, convertInchesToTwip,
  type IParagraphOptions,
} from 'docx';
import temml from 'temml';
import mathml2omml from '@/vendor/mathml2omml.min.js';

import {
  getLatex, isMath, isInlineMath,
  getImageUrl, isImage,
  isFootnote, getFootnoteInfo,
  isVideo, getVideoInfo,
  isLinkCard, getLinkCardInfo,
  isCatalog, isReferenceList,
} from '@/shared/converters/zhihu-html-utils';

import type { ZhihuComment } from '@/types/zhihu';

// ============================================================
// 类型定义
// ============================================================

interface ImageInfo {
  buffer: ArrayBuffer;
  ext: string;
}

interface FrontMatter {
  id?: string;
  title?: string;
  author?: string;
  url?: string;
  createdTime?: number;
  updatedTime?: number;
}

export interface DocxOptions {
  images?: 'embed' | 'link';
  imageData?: Map<string, ImageInfo>;
  frontMatter?: FrontMatter;
}

interface ConvertContext {
  images: 'embed' | 'link';
  imageData: Map<string, ImageInfo>;
  endnotes: Array<{ id: number; text: string; url: string }>;
}

interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  code?: boolean;
  font?: { name: string; eastAsia?: string };
  color?: string;
  size?: number;
}

interface ImageDimensions {
  width: number;
  height: number;
}

// ============================================================
// 工具函数
// ============================================================

function parseHTML(html: string): globalThis.Document {
  const parser = new DOMParser();
  return parser.parseFromString(html, 'text/html');
}

/**
 * 从图片二进制数据解析尺寸（PNG/JPEG）
 */
function parseImageDimensions(buffer: ArrayBuffer): ImageDimensions | null {
  const view = new DataView(buffer);
  try {
    // PNG
    if (view.getUint32(0) === 0x89504E47) {
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    // JPEG: 搜索 SOF0/SOF2
    let offset = 2;
    while (offset < view.byteLength - 8) {
      const marker = view.getUint16(offset);
      if (marker === 0xFFC0 || marker === 0xFFC2) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      offset += 2 + view.getUint16(offset + 2);
    }
  } catch (e) { /* ignore */ }
  return null;
}

/**
 * 计算图片在 docx 中的显示尺寸（像素），最大宽度 576px（约 6 英寸 96dpi）
 */
function calcImageSize(widthPx: number, heightPx: number): ImageDimensions {
  const MAX_WIDTH = 576;
  let w = widthPx;
  let h = heightPx;
  if (w > MAX_WIDTH) {
    const ratio = MAX_WIDTH / w;
    w = MAX_WIDTH;
    h = Math.round(h * ratio);
  }
  return { width: w, height: h };
}

// ============================================================
// LaTeX → docx Math 转换
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MathComponent = any;

function convertLatexToDocxMath(latex: string): MathComponent[] | null {
  try {
    // Temml + mathml2omml pipeline
    const mathml = temml.renderToString(latex);
    const omml = mathml2omml.mml2omml(mathml);
    return parseOmmlToDocxMath(omml);
  } catch (e) {
    console.warn('LaTeX→OMML 转换失败:', latex, e);
    return null;
  }
}

/**
 * Parse OMML XML into docx Math component tree
 * Handles: fractions, superscripts, subscripts, radicals, delimiters, etc.
 */
function parseOmmlToDocxMath(ommlXml: string): MathComponent[] | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(ommlXml, 'text/xml');
    if (doc.querySelector('parsererror')) return null;

    // Find the m:oMath element (or m:oMathPara > m:oMath)
    const oMath = doc.querySelector('oMath') || doc.querySelector('oMathPara oMath');
    if (!oMath) {
      // Try direct children
      const root = doc.documentElement;
      return convertOmmlChildren(root);
    }
    return convertOmmlChildren(oMath);
  } catch (e) {
    console.warn('OMML parse error:', e);
    return null;
  }
}

/** Get local name of an XML element, stripping namespace prefix */
function localName(el: Element): string {
  return el.localName || el.nodeName.replace(/^.*:/, '');
}

/** Convert children of an OMML element to docx Math components */
function convertOmmlChildren(parent: Element): MathComponent[] | null {
  const components: MathComponent[] = [];
  for (const child of parent.childNodes) {
    if (child.nodeType !== 1) continue; // element nodes only
    const comp = convertOmmlElement(child as Element);
    if (comp) {
      if (Array.isArray(comp)) components.push(...comp);
      else components.push(comp);
    }
  }
  return components.length > 0 ? components : null;
}

/** Convert a single OMML element to a docx Math component */
function convertOmmlElement(el: Element): MathComponent | MathComponent[] | null {
  const name = localName(el);

  switch (name) {
    case 'r': return convertOmmlRun(el);        // m:r -> MathRun
    case 'f': return convertOmmlFraction(el);    // m:f -> MathFraction
    case 'sSup': return convertOmmlSup(el);      // m:sSup -> MathSuperScript
    case 'sSub': return convertOmmlSub(el);      // m:sSub -> MathSubScript
    case 'sSubSup': return convertOmmlSubSup(el);// m:sSubSup -> MathSubSuperScript
    case 'rad': return convertOmmlRadical(el);   // m:rad -> MathRadical
    case 'd': return convertOmmlDelimiter(el);   // m:d -> brackets/parens
    case 'nary': return convertOmmlNary(el);     // m:nary -> sum/integral
    case 'acc': return convertOmmlAccent(el);    // m:acc -> accent
    case 'limLow': return convertOmmlLimLow(el); // m:limLow -> lower limit
    case 'limUpp': return convertOmmlLimUpp(el); // m:limUpp -> upper limit
    case 'func': return convertOmmlFunc(el);     // m:func -> function
    case 'oMath': return convertOmmlChildren(el);
    case 'oMathPara': return convertOmmlChildren(el);
    // Properties elements - skip
    case 'rPr': case 'fPr': case 'sSupPr': case 'sSubPr':
    case 'sSubSupPr': case 'radPr': case 'dPr': case 'naryPr':
    case 'accPr': case 'limLowPr': case 'limUppPr': case 'funcPr':
    case 'ctrlPr':
      return null;
    // Container elements - recurse
    case 'e': case 'num': case 'den': case 'sup': case 'sub':
    case 'deg': case 'lim': case 'fName':
      return convertOmmlChildren(el);
    default: {
      // Unknown element - try to extract text
      const text = el.textContent?.trim();
      if (text) return new DocxMathRun(text);
      return null;
    }
  }
}

/** m:r -> MathRun */
function convertOmmlRun(el: Element): MathComponent | null {
  const tEl = findChild(el, 't');
  const text = tEl ? tEl.textContent : el.textContent || '';
  if (!text) return null;
  return new DocxMathRun(text);
}

/** Helper: get children array or fallback */
function ommlChildrenOf(el: Element, childName: string): MathComponent[] {
  const child = findChild(el, childName);
  return child ? convertOmmlChildren(child) || [new DocxMathRun('')] : [new DocxMathRun('')];
}

/** m:f -> MathFraction */
function convertOmmlFraction(el: Element): MathComponent {
  return new MathFraction({
    numerator: ommlChildrenOf(el, 'num'),
    denominator: ommlChildrenOf(el, 'den'),
  });
}

/** m:sSup -> MathSuperScript */
function convertOmmlSup(el: Element): MathComponent {
  return new MathSuperScript({
    children: ommlChildrenOf(el, 'e'),
    superScript: ommlChildrenOf(el, 'sup'),
  });
}

/** m:sSub -> MathSubScript */
function convertOmmlSub(el: Element): MathComponent {
  return new MathSubScript({
    children: ommlChildrenOf(el, 'e'),
    subScript: ommlChildrenOf(el, 'sub'),
  });
}

/** m:sSubSup -> MathSubSuperScript */
function convertOmmlSubSup(el: Element): MathComponent {
  return new MathSubSuperScript({
    children: ommlChildrenOf(el, 'e'),
    subScript: ommlChildrenOf(el, 'sub'),
    superScript: ommlChildrenOf(el, 'sup'),
  });
}

/** m:rad -> MathRadical */
function convertOmmlRadical(el: Element): MathComponent {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts: any = { children: ommlChildrenOf(el, 'e') };
  const deg = findChild(el, 'deg');
  if (deg) {
    const degChildren = convertOmmlChildren(deg);
    if (degChildren) opts.degree = degChildren;
  }
  return new MathRadical(opts);
}

/** m:d -> Delimiters (parentheses, brackets, braces) */
function convertOmmlDelimiter(el: Element): MathComponent {
  const dPr = findChild(el, 'dPr');
  let begChar = '(', endChar = ')';
  if (dPr) {
    const begChr = findChild(dPr, 'begChr');
    const endChr = findChild(dPr, 'endChr');
    if (begChr) begChar = begChr.getAttribute('m:val') || begChr.getAttribute('val') || '(';
    if (endChr) endChar = endChr.getAttribute('m:val') || endChr.getAttribute('val') || ')';
  }
  const eChildren: MathComponent[] = [];
  for (const child of el.childNodes) {
    if (child.nodeType === 1 && localName(child as Element) === 'e') {
      const converted = convertOmmlChildren(child as Element);
      if (converted) eChildren.push(...converted);
    }
  }
  const children = eChildren.length > 0 ? eChildren : [new DocxMathRun('')];

  if (begChar === '[' && endChar === ']') return new MathSquareBrackets({ children });
  if (begChar === '{' && endChar === '}') return new MathCurlyBrackets({ children });
  return new MathRoundBrackets({ children });
}

/** m:nary -> Sum/Integral */
function convertOmmlNary(el: Element): MathComponent {
  const naryPr = findChild(el, 'naryPr');
  let chr: string | null = null;
  if (naryPr) {
    const chrEl = findChild(naryPr, 'chr');
    if (chrEl) chr = chrEl.getAttribute('m:val') || chrEl.getAttribute('val');
  }

  const sub = findChild(el, 'sub');
  const sup = findChild(el, 'sup');
  const subChildren = sub ? convertOmmlChildren(sub) || [new DocxMathRun('')] : undefined;
  const supChildren = sup ? convertOmmlChildren(sup) || [new DocxMathRun('')] : undefined;
  const baseChildren = ommlChildrenOf(el, 'e');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts: any = { children: baseChildren };
  if (subChildren) opts.subScript = subChildren;
  if (supChildren) opts.superScript = supChildren;

  if (chr && (chr === '\u222B' || chr === '\u222C' || chr === '\u222D')) {
    return new MathIntegral(opts);
  }
  return new MathSum(opts);
}

/** m:acc -> Accent (hat, bar, etc.) */
function convertOmmlAccent(el: Element): MathComponent {
  const accPr = findChild(el, 'accPr');
  let chr = '\u0302';
  if (accPr) {
    const chrEl = findChild(accPr, 'chr');
    if (chrEl) chr = chrEl.getAttribute('m:val') || chrEl.getAttribute('val') || chr;
  }
  return new MathAccentCharacter({
    accent: chr,
    children: ommlChildrenOf(el, 'e'),
  });
}

/** m:limLow -> Lower limit */
function convertOmmlLimLow(el: Element): MathComponent {
  return new MathLimitLower({
    children: ommlChildrenOf(el, 'e'),
    limit: ommlChildrenOf(el, 'lim'),
  });
}

/** m:limUpp -> Upper limit */
function convertOmmlLimUpp(el: Element): MathComponent {
  return new MathLimitUpper({
    children: ommlChildrenOf(el, 'e'),
    limit: ommlChildrenOf(el, 'lim'),
  });
}

/** m:func -> Math function (sin, cos, etc.) */
function convertOmmlFunc(el: Element): MathComponent {
  return new MathFunction({
    name: ommlChildrenOf(el, 'fName'),
    children: ommlChildrenOf(el, 'e'),
  });
}

/** Find first child element by local name */
function findChild(parent: Element, name: string): Element | null {
  for (const child of parent.childNodes) {
    if (child.nodeType === 1 && localName(child as Element) === name) return child as Element;
  }
  return null;
}

// ============================================================
// 行内元素收集
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InlineRun = any;

function collectInlineElements(node: Node, style: InlineStyle, ctx: ConvertContext): InlineRun[] {
  const runs: InlineRun[] = [];

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent;
    if (text) {
      runs.push(new TextRun({
        text,
        bold: style.bold || false,
        italics: style.italic || false,
        strike: style.strike || false,
        underline: style.underline ? { type: 'single' } : undefined,
        font: style.code ? { name: 'Consolas' } : style.font || undefined,
        color: style.color || undefined,
        size: style.size || undefined,
        shading: style.code ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E8E8E8' } : undefined,
      }));
    }
    return runs;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return runs;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === 'br') {
    runs.push(new TextRun({ break: 1 }));
    return runs;
  }

  if (tag === 'strong' || tag === 'b') {
    for (const child of el.childNodes)
      runs.push(...collectInlineElements(child, { ...style, bold: true }, ctx));
    return runs;
  }

  if (tag === 'em' || tag === 'i') {
    for (const child of el.childNodes)
      runs.push(...collectInlineElements(child, { ...style, italic: true }, ctx));
    return runs;
  }

  if (tag === 'del' || tag === 's') {
    for (const child of el.childNodes)
      runs.push(...collectInlineElements(child, { ...style, strike: true }, ctx));
    return runs;
  }

  if (tag === 'u') {
    for (const child of el.childNodes)
      runs.push(...collectInlineElements(child, { ...style, underline: true }, ctx));
    return runs;
  }

  if (tag === 'code' && el.parentElement?.tagName.toLowerCase() !== 'pre') {
    for (const child of el.childNodes)
      runs.push(...collectInlineElements(child, { ...style, code: true }, ctx));
    return runs;
  }

  if (tag === 'a') {
    const href = el.getAttribute('href') || '';
    const linkChildren: InlineRun[] = [];
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent) {
        linkChildren.push(new TextRun({
          text: child.textContent,
          color: '0563C1',
          underline: { type: 'single' },
          bold: style.bold || false,
          italics: style.italic || false,
        }));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        // Recursively handle inline elements within the link
        const innerRuns = collectInlineElements(child, style, ctx);
        for (const r of innerRuns) {
          linkChildren.push(r);
        }
      }
    }
    if (href && linkChildren.length > 0) {
      runs.push(new ExternalHyperlink({ link: href, children: linkChildren }));
    } else {
      runs.push(...linkChildren);
    }
    return runs;
  }

  // 公式（行内或块级都可能出现在 inline 上下文中）
  if (isMath(el)) {
    const latex = getLatex(el);
    if (latex) {
      const mathRuns = convertLatexToDocxMath(latex);
      if (mathRuns) {
        runs.push(new DocxMath({ children: mathRuns }));
      } else {
        runs.push(new TextRun({ text: `$${latex}$`, font: { name: 'Consolas' } }));
      }
      return runs;
    }
  }

  // 图片（非公式）
  if (isImage(el)) {
    const url = getImageUrl(el);
    if (!url) return runs;

    if (ctx.images === 'embed' && ctx.imageData) {
      const imgInfo = ctx.imageData.get(url);
      if (imgInfo) {
        const imgW = parseInt(el.getAttribute('width') || '') || 0;
        const imgH = parseInt(el.getAttribute('height') || '') || 0;
        let dims: ImageDimensions;
        if (imgW && imgH) {
          dims = calcImageSize(imgW, imgH);
        } else {
          const parsed = parseImageDimensions(imgInfo.buffer);
          dims = parsed ? calcImageSize(parsed.width, parsed.height) : calcImageSize(600, 400);
        }
        runs.push(new ImageRun({
          data: imgInfo.buffer,
          transformation: { width: dims.width, height: dims.height },
        }));
      } else {
        runs.push(new TextRun({ text: `[图片加载失败](${url})`, color: '999999' }));
      }
    } else {
      runs.push(new ExternalHyperlink({
        link: url,
        children: [new TextRun({ text: '[图片]', color: '0563C1', underline: { type: 'single' } })],
      }));
    }
    return runs;
  }

  // 参考引用：使用尾注
  if (isFootnote(el)) {
    const info = getFootnoteInfo(el);
    const endnoteId = ctx.endnotes.length + 1;
    ctx.endnotes.push({ id: endnoteId, text: info.text, url: info.url });
    runs.push(new EndnoteReferenceRun(endnoteId));
    return runs;
  }

  // 默认递归
  for (const child of el.childNodes)
    runs.push(...collectInlineElements(child, style, ctx));
  return runs;
}

// ============================================================
// 块级元素转换
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BlockElement = any;

function convertBlockElement(element: Element, ctx: ConvertContext, listLevel: number = -1): BlockElement[] {
  const blocks: BlockElement[] = [];
  const tag = element.tagName?.toLowerCase();
  if (!tag) return blocks;

  // 跳过知乎目录导航区域
  if (isCatalog(element)) return blocks;

  // 跳过知乎参考文献列表（已通过尾注方式嵌入）
  if (isReferenceList(element)) return blocks;

  // 标题
  const hMatch = tag.match(/^h([1-6])$/);
  if (hMatch) {
    // 跳过"参考"标题（当后面紧跟 ReferenceList 时，已通过尾注嵌入）
    if (element.nextElementSibling && isReferenceList(element.nextElementSibling)) return blocks;
    const headingMap: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
      1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3,
      4: HeadingLevel.HEADING_4, 5: HeadingLevel.HEADING_5, 6: HeadingLevel.HEADING_6,
    };
    const children: InlineRun[] = [];
    for (const child of element.childNodes) children.push(...collectInlineElements(child, { bold: true }, ctx));
    blocks.push(new Paragraph({ heading: headingMap[parseInt(hMatch[1])], children }));
    return blocks;
  }

  // 段落
  if (tag === 'p') {
    const children: InlineRun[] = [];
    for (const child of element.childNodes) children.push(...collectInlineElements(child, {}, ctx));
    if (children.length > 0) blocks.push(new Paragraph({ children, spacing: { line: 360, before: 60, after: 60 } }));
    return blocks;
  }

  // 块级公式
  if (isMath(element)) {
    const latex = getLatex(element);
    if (latex) {
      const mathRuns = convertLatexToDocxMath(latex);
      if (mathRuns) {
        blocks.push(new Paragraph({ children: [new DocxMath({ children: mathRuns })], alignment: AlignmentType.CENTER }));
      } else {
        blocks.push(new Paragraph({ children: [new TextRun({ text: `$$${latex}$$`, font: { name: 'Consolas' } })], alignment: AlignmentType.CENTER }));
      }
      return blocks;
    }
  }

  // 引用块
  if (tag === 'blockquote') {
    const quoteStyle: Partial<IParagraphOptions> = {
      indent: { left: convertInchesToTwip(0.5) },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: '999999', space: 10 } },
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F5F5F5' },
      spacing: { before: 120, after: 120, line: 340 },
    };
    // 引用块内文字使用楷体 + Georgia，灰色，稍小字号
    const quoteRunStyle: InlineStyle = {
      font: { name: 'Georgia', eastAsia: '楷体' },
      color: '555555',
      size: 21, // 10.5pt
    };

    // Collect all inline content from blockquote children
    const children: InlineRun[] = [];
    for (const child of element.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const childTag = (child as Element).tagName.toLowerCase();
        // If child is a block element like <p>, collect its inline content
        if (childTag === 'p' || childTag === 'div') {
          for (const grandchild of child.childNodes) {
            children.push(...collectInlineElements(grandchild, quoteRunStyle, ctx));
          }
          children.push(new TextRun({ break: 1 }));
        } else {
          // For other block elements, create separate paragraphs
          const innerBlocks = convertBlockElement(child as Element, ctx);
          if (innerBlocks.length > 0) {
            // Flush collected inlines
            if (children.length > 0) {
              blocks.push(new Paragraph({ children: [...children], ...quoteStyle }));
              children.length = 0;
            }
            for (const block of innerBlocks) {
              blocks.push(block);
            }
          }
        }
      } else {
        children.push(...collectInlineElements(child, quoteRunStyle, ctx));
      }
    }
    // Flush remaining inlines
    if (children.length > 0) {
      blocks.push(new Paragraph({ children, ...quoteStyle }));
    }
    // If nothing was produced, create empty quoted paragraph
    if (blocks.length === 0) {
      blocks.push(new Paragraph({ children: [new TextRun({ text: '', ...quoteRunStyle })], ...quoteStyle }));
    }
    return blocks;
  }

  // 列表
  if (tag === 'ul' || tag === 'ol') {
    const newLevel = listLevel + 1;
    for (const li of element.children) {
      if (li.tagName?.toLowerCase() !== 'li') continue;
      const children: InlineRun[] = [];
      for (const child of li.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE &&
          ((child as Element).tagName.toLowerCase() === 'ul' || (child as Element).tagName.toLowerCase() === 'ol')) {
          blocks.push(...convertBlockElement(child as Element, ctx, newLevel));
        } else {
          children.push(...collectInlineElements(child, {}, ctx));
        }
      }
      if (children.length > 0) {
        blocks.push(new Paragraph({
          children,
          numbering: { reference: tag === 'ol' ? 'ordered-list' : 'bullet-list', level: newLevel },
          spacing: { line: 360, before: 40, after: 40 },
        }));
      }
    }
    return blocks;
  }

  // 代码块
  if (tag === 'pre') {
    const codeEl = element.querySelector('code') || element;
    const lines = (codeEl.textContent || '').split('\n');
    for (const line of lines) {
      blocks.push(new Paragraph({
        children: [new TextRun({ text: line || ' ', font: { name: 'Consolas' }, size: 20 })],
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F5F5F5' },
        spacing: { before: 0, after: 0, line: 276 },
        indent: { left: convertInchesToTwip(0.3) },
      }));
    }
    return blocks;
  }

  // 表格
  if (tag === 'table') {
    blocks.push(convertTable(element, ctx));
    return blocks;
  }

  // figure
  if (tag === 'figure') {
    const img = element.querySelector('img');
    const figcaption = element.querySelector('figcaption');
    if (img) blocks.push(...convertBlockElement(img, ctx));
    if (figcaption) {
      blocks.push(new Paragraph({
        children: [new TextRun({ text: figcaption.textContent || '', color: '666666', size: 18, italics: true })],
        alignment: AlignmentType.CENTER,
      }));
    }
    return blocks;
  }

  // 知乎视频
  if (isVideo(element)) {
    const info = getVideoInfo(element);
    blocks.push(new Paragraph({
      children: [
        new TextRun({ text: '[视频] ', bold: true }),
        new ExternalHyperlink({ link: info.href, children: [new TextRun({ text: info.title, color: '0563C1', underline: { type: 'single' } })] }),
      ],
    }));
    return blocks;
  }

  // 链接卡片
  if (isLinkCard(element)) {
    const info = getLinkCardInfo(element);
    blocks.push(new Paragraph({
      children: [new ExternalHyperlink({ link: info.href, children: [new TextRun({ text: info.title, color: '0563C1', underline: { type: 'single' } })] })],
    }));
    return blocks;
  }

  // 独立图片（块级）
  if (isImage(element)) {
    const inlineRuns = collectInlineElements(element, {}, ctx);
    if (inlineRuns.length > 0) blocks.push(new Paragraph({ children: inlineRuns, alignment: AlignmentType.CENTER }));
    return blocks;
  }

  // 水平线
  if (tag === 'hr') {
    blocks.push(new Paragraph({
      children: [],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } },
      spacing: { before: 120, after: 120 },
    }));
    return blocks;
  }

  // 容器元素：递归
  if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'span') {
    for (const child of element.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        blocks.push(...convertBlockElement(child as Element, ctx));
      } else if (child.nodeType === Node.TEXT_NODE && child.textContent!.trim()) {
        blocks.push(new Paragraph({ children: collectInlineElements(child, {}, ctx) }));
      }
    }
    return blocks;
  }

  // 未知元素：提取文本
  const textContent = element.textContent?.trim();
  if (textContent) blocks.push(new Paragraph({ children: [new TextRun({ text: textContent })] }));
  return blocks;
}

// ============================================================
// 表格转换
// ============================================================

function convertTable(tableEl: Element, ctx: ConvertContext): Table {
  const rows: TableRow[] = [];
  for (const tr of tableEl.querySelectorAll('tr')) {
    const cells: TableCell[] = [];
    const cellEls = tr.querySelectorAll('th, td');
    const isHeader = cellEls[0]?.tagName.toLowerCase() === 'th';

    for (const cell of cellEls) {
      const children: BlockElement[] = [];
      for (const child of cell.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          children.push(...convertBlockElement(child as Element, ctx));
        } else if (child.nodeType === Node.TEXT_NODE && child.textContent!.trim()) {
          children.push(new Paragraph({ children: collectInlineElements(child, isHeader ? { bold: true } : {}, ctx) }));
        }
      }
      if (children.length === 0) children.push(new Paragraph({ children: [] }));
      cells.push(new TableCell({
        children,
        shading: isHeader ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E7E7E7' } : undefined,
      }));
    }
    if (cells.length > 0) rows.push(new TableRow({ children: cells }));
  }
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

// ============================================================
// Front Matter 元信息表格
// ============================================================

function _fmtTs(ts: number | undefined): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildFrontMatterTable(meta: FrontMatter): BlockElement[] {
  if (!meta) return [];
  const fields: [string, string][] = [
    ['ID', meta.id || ''], ['标题', meta.title || ''], ['作者', meta.author || ''],
    ['来源', meta.url || ''],
    ['创建时间', _fmtTs(meta.createdTime)],
    ['修改时间', _fmtTs(meta.updatedTime)],
    ['下载日期', new Date().toISOString().split('T')[0]],
  ].filter(([, v]) => v) as [string, string][];

  const rows = fields.map(([label, value]) =>
    new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20 })] })],
          width: { size: 20, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F0F0F0' },
        }),
        new TableCell({
          children: [new Paragraph({
            children: label === '来源'
              ? [new ExternalHyperlink({ link: value, children: [new TextRun({ text: value, color: '0563C1', underline: { type: 'single' }, size: 20 })] })]
              : [new TextRun({ text: String(value), size: 20 })],
          })],
          width: { size: 80, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F8F8F8' },
        }),
      ],
    })
  );

  return [
    new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }),
    new Paragraph({ children: [] }),
  ];
}

// ============================================================
// 主转换函数
// ============================================================

/**
 * 将知乎文章 HTML 转换为 docx Blob
 * @param htmlString - 知乎文章 HTML
 * @param options - { images: 'embed'|'link', imageData: Map<url, {buffer,ext}>, frontMatter: {id,title,author,url,date} }
 * @returns Promise<Blob>
 */
export async function htmlToDocx(htmlString: string, options: DocxOptions = {}): Promise<Blob> {
  const doc = parseHTML(htmlString);
  const body = doc.body;

  const ctx: ConvertContext = {
    images: options.images || 'link',
    imageData: options.imageData || new Map(),
    endnotes: [],
  };

  const sections: BlockElement[] = [];

  if (options.frontMatter) sections.push(...buildFrontMatterTable(options.frontMatter));

  for (const child of body.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      sections.push(...convertBlockElement(child as Element, ctx));
    } else if (child.nodeType === Node.TEXT_NODE && child.textContent!.trim()) {
      sections.push(new Paragraph({ children: [new TextRun({ text: child.textContent! })] }));
    }
  }

  // 构建尾注
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const endnotes: Record<number, any> = {};
  for (const en of ctx.endnotes) {
    const enChildren: InlineRun[] = [new TextRun({ text: en.text, size: 20 })];
    if (en.url) {
      enChildren.push(new TextRun({ text: ' ' }));
      enChildren.push(new ExternalHyperlink({
        link: en.url,
        children: [new TextRun({ text: en.url, color: '0563C1', underline: { type: 'single' }, size: 18 })],
      }));
    }
    endnotes[en.id] = {
      children: [new Paragraph({ children: enChildren })],
    };
  }

  const document = new Document({
    styles: {
      default: {
        document: {
          run: {
            size: 24, // 12pt
          },
          paragraph: {
            spacing: {
              line: 360, // 1.5倍行距
              before: 60,
              after: 60,
            },
          },
        },
        heading1: {
          run: { font: { name: 'Arial', eastAsia: '黑体' }, size: 44, bold: true, color: '000000' },
          paragraph: { spacing: { before: 480, after: 240 } },
        },
        heading2: {
          run: { font: { name: 'Arial', eastAsia: '黑体' }, size: 36, bold: true, color: '000000' },
          paragraph: { spacing: { before: 400, after: 200 } },
        },
        heading3: {
          run: { font: { name: 'Arial', eastAsia: '黑体' }, size: 32, bold: true, color: '1a1a1a' },
          paragraph: { spacing: { before: 320, after: 160 } },
        },
        heading4: {
          run: { font: { name: 'Arial', eastAsia: '黑体' }, size: 28, bold: true, color: '1a1a1a' },
          paragraph: { spacing: { before: 280, after: 120 } },
        },
        heading5: {
          run: { font: { name: 'Arial', eastAsia: '黑体' }, size: 26, bold: true, color: '333333' },
          paragraph: { spacing: { before: 240, after: 100 } },
        },
        heading6: {
          run: { font: { name: 'Arial', eastAsia: '黑体' }, size: 24, bold: true, color: '333333' },
          paragraph: { spacing: { before: 200, after: 80 } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'bullet-list',
          levels: Array.from({ length: 9 }, (_, i) => ({
            level: i,
            format: LevelFormat.BULLET,
            text: i === 0 ? '\u2022' : i === 1 ? '\u25E6' : '\u25AA',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: convertInchesToTwip(0.5 * (i + 1)), hanging: convertInchesToTwip(0.25) } } },
          })),
        },
        {
          reference: 'ordered-list',
          levels: Array.from({ length: 9 }, (_, i) => ({
            level: i,
            format: LevelFormat.DECIMAL,
            text: `%${i + 1}.`,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: convertInchesToTwip(0.5 * (i + 1)), hanging: convertInchesToTwip(0.25) } } },
          })),
        },
      ],
    },
    endnotes: Object.keys(endnotes).length > 0 ? endnotes : undefined,
    sections: [{ children: sections }],
  });

  return await Packer.toBlob(document);
}

// ============================================================
// 评论 docx 生成
// ============================================================

export async function commentsToDocx(comments: ZhihuComment[], title: string): Promise<Blob> {
  const sections: BlockElement[] = [];

  sections.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: `${title} - 评论区`, bold: true })],
  }));

  const totalCount = comments.reduce((sum, c) => sum + 1 + (c.child_comments?.length || 0), 0);
  sections.push(new Paragraph({ children: [new TextRun({ text: `共 ${totalCount} 条评论`, color: '666666' })] }));
  sections.push(new Paragraph({ children: [] }));

  for (const comment of comments) {
    const authorTag = comment.author_tag?.some?.((t: { type: string }) => t.type === 'content_author') ? '（作者）' : '';
    const ipInfo = comment.comment_tag?.find?.((t: { type: string }) => t.type === 'ip_info')?.text || '';
    const time = _formatTimestamp(comment.created_time);
    const likes = comment.like_count || 0;
    const metaText = [`${comment.author?.name || '匿名'}${authorTag}`, time, ipInfo, `\uD83D\uDC4D ${likes}`].filter(Boolean).join(' \u00B7 ');

    sections.push(new Paragraph({
      children: [new TextRun({ text: metaText, bold: true, size: 20, font: { name: 'Arial', eastAsia: '微软雅黑' }, color: '333333' })],
      indent: { left: convertInchesToTwip(0.3) },
      border: { left: { style: BorderStyle.SINGLE, size: 8, color: '4A90D9', space: 10 } },
      spacing: { before: 160 },
    }));

    sections.push(new Paragraph({
      children: [new TextRun({ text: _htmlToText(comment.content || ''), size: 22 })],
      indent: { left: convertInchesToTwip(0.3) },
      border: { left: { style: BorderStyle.SINGLE, size: 8, color: '4A90D9', space: 10 } },
      spacing: { after: 80, line: 340 },
    }));

    if (comment.child_comments?.length && comment.child_comments.length > 0) {
      for (const child of comment.child_comments) {
        const cTag = child.author_tag?.some?.((t: { type: string }) => t.type === 'content_author') ? '（作者）' : '';
        const cIp = child.comment_tag?.find?.((t: { type: string }) => t.type === 'ip_info')?.text || '';
        const cTime = _formatTimestamp(child.created_time);
        const replyTo = child.reply_to_author?.name ? ` 回复 ${child.reply_to_author.name}` : '';
        const cMeta = [`${child.author?.name || '匿名'}${cTag}${replyTo}`, cTime, cIp].filter(Boolean).join(' \u00B7 ');

        sections.push(new Paragraph({
          children: [new TextRun({ text: cMeta, bold: true, size: 18, color: '666666', font: { name: 'Arial', eastAsia: '微软雅黑' } })],
          indent: { left: convertInchesToTwip(0.8) },
          border: { left: { style: BorderStyle.SINGLE, size: 4, color: 'D0D0D0', space: 10 } },
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FAFAFA' },
          spacing: { before: 80 },
        }));

        sections.push(new Paragraph({
          children: [new TextRun({ text: _htmlToText(child.content || ''), size: 20, color: '444444' })],
          indent: { left: convertInchesToTwip(0.8) },
          border: { left: { style: BorderStyle.SINGLE, size: 4, color: 'D0D0D0', space: 10 } },
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FAFAFA' },
          spacing: { after: 60, line: 340 },
        }));
      }
    }

    sections.push(new Paragraph({
      children: [],
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: 'E0E0E0' } },
      spacing: { before: 80, after: 80 },
    }));
  }

  const document = new Document({
    styles: {
      default: {
        document: {
          run: {
            size: 24,
          },
          paragraph: {
            spacing: { line: 360, before: 60, after: 60 },
          },
        },
        heading1: {
          run: { font: { name: 'Arial', eastAsia: '黑体' }, size: 44, bold: true, color: '000000' },
          paragraph: { spacing: { before: 480, after: 240 } },
        },
      },
    },
    sections: [{ children: sections }],
  });
  return await Packer.toBlob(document);
}

function _htmlToText(html: string): string {
  const div = globalThis.document.createElement('div');
  div.innerHTML = html;
  return div.textContent || '';
}

function _formatTimestamp(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
