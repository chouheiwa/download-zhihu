// lib/html-to-docx.js
// HTML \u2192 docx Document \u8F6C\u6362\u5668
// \u4F9D\u8D56: docx \u5E93 (\u5168\u5C40\u53D8\u91CF docx)

(function () {
  'use strict';

  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel,
    ExternalHyperlink, ImageRun, Table, TableRow, TableCell,
    WidthType, BorderStyle, AlignmentType, ShadingType,
    Math: DocxMath, MathRun: DocxMathRun,
    MathFraction, MathSuperScript, MathSubScript, MathSubSuperScript,
    MathRadical, MathRoundBrackets, MathSquareBrackets, MathCurlyBrackets,
    MathSum, MathIntegral, MathAccentCharacter,
    MathLimitLower, MathLimitUpper, MathFunction,
    FootnoteReferenceRun,
    LevelFormat, convertInchesToTwip,
  } = docx;

  // ============================================================
  // \u5DE5\u5177\u51FD\u6570
  // ============================================================

  function parseHTML(html) {
    const parser = new DOMParser();
    return parser.parseFromString(html, 'text/html');
  }

  function getImageUrl(img) {
    return img.getAttribute('data-original')
      || img.getAttribute('data-actualsrc')
      || img.getAttribute('src')
      || '';
  }

  /**
   * \u4ECE\u56FE\u7247\u4E8C\u8FDB\u5236\u6570\u636E\u89E3\u6790\u5C3A\u5BF8\uFF08PNG/JPEG\uFF09
   */
  function parseImageDimensions(buffer) {
    const view = new DataView(buffer);
    try {
      // PNG
      if (view.getUint32(0) === 0x89504E47) {
        return { width: view.getUint32(16), height: view.getUint32(20) };
      }
      // JPEG: \u641C\u7D22 SOF0/SOF2
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
   * \u8BA1\u7B97\u56FE\u7247\u5728 docx \u4E2D\u7684\u663E\u793A\u5C3A\u5BF8\uFF08\u50CF\u7D20\uFF09\uFF0C\u6700\u5927\u5BBD\u5EA6 576px\uFF08\u7EA6 6 \u82F1\u5BF8 96dpi\uFF09
   */
  function calcImageSize(widthPx, heightPx) {
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
  // LaTeX \u2192 docx Math \u8F6C\u6362
  // ============================================================

  function convertLatexToDocxMath(latex) {
    try {
      // Temml + mathml2omml pipeline
      if (typeof window.temml !== 'undefined' && typeof window.mathml2omml !== 'undefined') {
        const mathml = window.temml.renderToString(latex);
        const omml = window.mathml2omml.mml2omml(mathml);
        return parseOmmlToDocxMath(omml);
      }
      return null;
    } catch (e) {
      console.warn('LaTeX\u2192OMML \u8F6C\u6362\u5931\u8D25:', latex, e);
      return null;
    }
  }

  /**
   * Parse OMML XML into docx Math component tree
   * Handles: fractions, superscripts, subscripts, radicals, delimiters, etc.
   */
  function parseOmmlToDocxMath(ommlXml) {
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
  function localName(el) {
    return el.localName || el.nodeName.replace(/^.*:/, '');
  }

  /** Convert children of an OMML element to docx Math components */
  function convertOmmlChildren(parent) {
    const components = [];
    for (const child of parent.childNodes) {
      if (child.nodeType !== 1) continue; // element nodes only
      const comp = convertOmmlElement(child);
      if (comp) {
        if (Array.isArray(comp)) components.push(...comp);
        else components.push(comp);
      }
    }
    return components.length > 0 ? components : null;
  }

  /** Convert a single OMML element to a docx Math component */
  function convertOmmlElement(el) {
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
      default:
        // Unknown element - try to extract text
        const text = el.textContent?.trim();
        if (text) return new DocxMathRun(text);
        return null;
    }
  }

  /** m:r -> MathRun */
  function convertOmmlRun(el) {
    const tEl = findChild(el, 't');
    const text = tEl ? tEl.textContent : el.textContent || '';
    if (!text) return null;
    return new DocxMathRun(text);
  }

  /** Helper: get children array or fallback */
  function ommlChildrenOf(el, childName) {
    const child = findChild(el, childName);
    return child ? convertOmmlChildren(child) || [new DocxMathRun('')] : [new DocxMathRun('')];
  }

  /** m:f -> MathFraction */
  function convertOmmlFraction(el) {
    return new MathFraction({
      numerator: ommlChildrenOf(el, 'num'),
      denominator: ommlChildrenOf(el, 'den'),
    });
  }

  /** m:sSup -> MathSuperScript */
  function convertOmmlSup(el) {
    return new MathSuperScript({
      children: ommlChildrenOf(el, 'e'),
      superScript: ommlChildrenOf(el, 'sup'),
    });
  }

  /** m:sSub -> MathSubScript */
  function convertOmmlSub(el) {
    return new MathSubScript({
      children: ommlChildrenOf(el, 'e'),
      subScript: ommlChildrenOf(el, 'sub'),
    });
  }

  /** m:sSubSup -> MathSubSuperScript */
  function convertOmmlSubSup(el) {
    return new MathSubSuperScript({
      children: ommlChildrenOf(el, 'e'),
      subScript: ommlChildrenOf(el, 'sub'),
      superScript: ommlChildrenOf(el, 'sup'),
    });
  }

  /** m:rad -> MathRadical */
  function convertOmmlRadical(el) {
    const opts = { children: ommlChildrenOf(el, 'e') };
    const deg = findChild(el, 'deg');
    if (deg) {
      const degChildren = convertOmmlChildren(deg);
      if (degChildren) opts.degree = degChildren;
    }
    return new MathRadical(opts);
  }

  /** m:d -> Delimiters (parentheses, brackets, braces) */
  function convertOmmlDelimiter(el) {
    const dPr = findChild(el, 'dPr');
    let begChar = '(', endChar = ')';
    if (dPr) {
      const begChr = findChild(dPr, 'begChr');
      const endChr = findChild(dPr, 'endChr');
      if (begChr) begChar = begChr.getAttribute('m:val') || begChr.getAttribute('val') || '(';
      if (endChr) endChar = endChr.getAttribute('m:val') || endChr.getAttribute('val') || ')';
    }
    const eChildren = [];
    for (const child of el.childNodes) {
      if (child.nodeType === 1 && localName(child) === 'e') {
        const converted = convertOmmlChildren(child);
        if (converted) eChildren.push(...converted);
      }
    }
    const children = eChildren.length > 0 ? eChildren : [new DocxMathRun('')];

    if (begChar === '[' && endChar === ']') return new MathSquareBrackets({ children });
    if (begChar === '{' && endChar === '}') return new MathCurlyBrackets({ children });
    return new MathRoundBrackets({ children });
  }

  /** m:nary -> Sum/Integral */
  function convertOmmlNary(el) {
    const naryPr = findChild(el, 'naryPr');
    let chr = null;
    if (naryPr) {
      const chrEl = findChild(naryPr, 'chr');
      if (chrEl) chr = chrEl.getAttribute('m:val') || chrEl.getAttribute('val');
    }

    const sub = findChild(el, 'sub');
    const sup = findChild(el, 'sup');
    const subChildren = sub ? convertOmmlChildren(sub) || [new DocxMathRun('')] : undefined;
    const supChildren = sup ? convertOmmlChildren(sup) || [new DocxMathRun('')] : undefined;
    const baseChildren = ommlChildrenOf(el, 'e');

    const opts = { children: baseChildren };
    if (subChildren) opts.subScript = subChildren;
    if (supChildren) opts.superScript = supChildren;

    if (chr && (chr === '\u222B' || chr === '\u222C' || chr === '\u222D')) {
      return new MathIntegral(opts);
    }
    return new MathSum(opts);
  }

  /** m:acc -> Accent (hat, bar, etc.) */
  function convertOmmlAccent(el) {
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
  function convertOmmlLimLow(el) {
    return new MathLimitLower({
      children: ommlChildrenOf(el, 'e'),
      limit: ommlChildrenOf(el, 'lim'),
    });
  }

  /** m:limUpp -> Upper limit */
  function convertOmmlLimUpp(el) {
    return new MathLimitUpper({
      children: ommlChildrenOf(el, 'e'),
      limit: ommlChildrenOf(el, 'lim'),
    });
  }

  /** m:func -> Math function (sin, cos, etc.) */
  function convertOmmlFunc(el) {
    return new MathFunction({
      name: ommlChildrenOf(el, 'fName'),
      children: ommlChildrenOf(el, 'e'),
    });
  }

  /** Find first child element by local name */
  function findChild(parent, name) {
    for (const child of parent.childNodes) {
      if (child.nodeType === 1 && localName(child) === name) return child;
    }
    return null;
  }

  // ============================================================
  // \u884C\u5185\u5143\u7D20\u6536\u96C6
  // ============================================================

  function collectInlineElements(node, style, ctx) {
    const runs = [];

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (text) {
        runs.push(new TextRun({
          text,
          bold: style.bold || false,
          italics: style.italic || false,
          strike: style.strike || false,
          underline: style.underline ? { type: 'single' } : undefined,
          font: style.code ? { name: 'Consolas' } : undefined,
          shading: style.code ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E8E8E8' } : undefined,
        }));
      }
      return runs;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return runs;
    const tag = node.tagName.toLowerCase();

    if (tag === 'br') {
      runs.push(new TextRun({ break: 1 }));
      return runs;
    }

    if (tag === 'strong' || tag === 'b') {
      for (const child of node.childNodes)
        runs.push(...collectInlineElements(child, { ...style, bold: true }, ctx));
      return runs;
    }

    if (tag === 'em' || tag === 'i') {
      for (const child of node.childNodes)
        runs.push(...collectInlineElements(child, { ...style, italic: true }, ctx));
      return runs;
    }

    if (tag === 'del' || tag === 's') {
      for (const child of node.childNodes)
        runs.push(...collectInlineElements(child, { ...style, strike: true }, ctx));
      return runs;
    }

    if (tag === 'u') {
      for (const child of node.childNodes)
        runs.push(...collectInlineElements(child, { ...style, underline: true }, ctx));
      return runs;
    }

    if (tag === 'code' && node.parentElement?.tagName.toLowerCase() !== 'pre') {
      for (const child of node.childNodes)
        runs.push(...collectInlineElements(child, { ...style, code: true }, ctx));
      return runs;
    }

    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      const linkChildren = [];
      for (const child of node.childNodes) {
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

    // \u516C\u5F0F: <img eeimg> or <span data-eeimg data-tex="..."> or any element with data-eeimg
    if ((tag === 'img' && node.hasAttribute('eeimg')) ||
        node.hasAttribute('data-eeimg')) {
      const latex = node.getAttribute('data-tex') || node.getAttribute('alt') || '';
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

    // \u56FE\u7247\uFF08\u975E\u516C\u5F0F\uFF09
    if (tag === 'img' && !node.getAttribute('eeimg')) {
      const url = getImageUrl(node);
      if (!url) return runs;

      if (ctx.images === 'embed' && ctx.imageData) {
        const imgInfo = ctx.imageData.get(url);
        if (imgInfo) {
          const imgW = parseInt(node.getAttribute('width')) || 0;
          const imgH = parseInt(node.getAttribute('height')) || 0;
          let dims;
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
          runs.push(new TextRun({ text: `[\u56FE\u7247\u52A0\u8F7D\u5931\u8D25](${url})`, color: '999999' }));
        }
      } else {
        runs.push(new ExternalHyperlink({
          link: url,
          children: [new TextRun({ text: '[\u56FE\u7247]', color: '0563C1', underline: { type: 'single' } })],
        }));
      }
      return runs;
    }

    // \u811A\u6CE8
    if (tag === 'sup' && node.getAttribute('data-text')) {
      const noteText = node.getAttribute('data-text') || node.textContent;
      const footnoteId = ctx.footnotes.length + 1;
      ctx.footnotes.push({ id: footnoteId, text: noteText });
      runs.push(new FootnoteReferenceRun(footnoteId));
      return runs;
    }

    // \u9ED8\u8BA4\u9012\u5F52
    for (const child of node.childNodes)
      runs.push(...collectInlineElements(child, style, ctx));
    return runs;
  }

  // ============================================================
  // \u5757\u7EA7\u5143\u7D20\u8F6C\u6362
  // ============================================================

  function convertBlockElement(element, ctx, listLevel) {
    if (listLevel === undefined) listLevel = -1;
    const blocks = [];
    const tag = element.tagName?.toLowerCase();
    if (!tag) return blocks;

    // \u6807\u9898
    const hMatch = tag.match(/^h([1-6])$/);
    if (hMatch) {
      const headingMap = {
        1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4, 5: HeadingLevel.HEADING_5, 6: HeadingLevel.HEADING_6,
      };
      const children = [];
      for (const child of element.childNodes) children.push(...collectInlineElements(child, {}, ctx));
      blocks.push(new Paragraph({ heading: headingMap[parseInt(hMatch[1])], children }));
      return blocks;
    }

    // \u6BB5\u843D
    if (tag === 'p') {
      const children = [];
      for (const child of element.childNodes) children.push(...collectInlineElements(child, {}, ctx));
      if (children.length > 0) blocks.push(new Paragraph({ children }));
      return blocks;
    }

    // \u5757\u7EA7\u516C\u5F0F: <img eeimg="2"> or <span data-eeimg="2" data-tex="...">
    if ((tag === 'img' && element.hasAttribute('eeimg')) ||
        element.hasAttribute('data-eeimg')) {
      const latex = element.getAttribute('data-tex') || element.getAttribute('alt') || '';
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

    // \u5F15\u7528\u5757
    if (tag === 'blockquote') {
      const quoteStyle = {
        indent: { left: convertInchesToTwip(0.5) },
        border: { left: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 8 } },
        spacing: { before: 60, after: 60 },
      };

      // Collect all inline content from blockquote children
      const children = [];
      for (const child of element.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const childTag = child.tagName.toLowerCase();
          // If child is a block element like <p>, collect its inline content
          if (childTag === 'p' || childTag === 'div') {
            for (const grandchild of child.childNodes) {
              children.push(...collectInlineElements(grandchild, {}, ctx));
            }
            children.push(new TextRun({ break: 1 }));
          } else {
            // For other block elements, create separate paragraphs
            const innerBlocks = convertBlockElement(child, ctx);
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
          children.push(...collectInlineElements(child, {}, ctx));
        }
      }
      // Flush remaining inlines
      if (children.length > 0) {
        blocks.push(new Paragraph({ children, ...quoteStyle }));
      }
      // If nothing was produced, create empty quoted paragraph
      if (blocks.length === 0) {
        blocks.push(new Paragraph({ children: [new TextRun({ text: '' })], ...quoteStyle }));
      }
      return blocks;
    }

    // \u5217\u8868
    if (tag === 'ul' || tag === 'ol') {
      const newLevel = listLevel + 1;
      for (const li of element.children) {
        if (li.tagName?.toLowerCase() !== 'li') continue;
        const children = [];
        for (const child of li.childNodes) {
          if (child.nodeType === Node.ELEMENT_NODE &&
            (child.tagName.toLowerCase() === 'ul' || child.tagName.toLowerCase() === 'ol')) {
            blocks.push(...convertBlockElement(child, ctx, newLevel));
          } else {
            children.push(...collectInlineElements(child, {}, ctx));
          }
        }
        if (children.length > 0) {
          blocks.push(new Paragraph({
            children,
            numbering: { reference: tag === 'ol' ? 'ordered-list' : 'bullet-list', level: newLevel },
          }));
        }
      }
      return blocks;
    }

    // \u4EE3\u7801\u5757
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

    // \u8868\u683C
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

    // \u77E5\u4E4E\u89C6\u9891
    if (element.classList?.contains('video-box')) {
      const link = element.querySelector('a');
      const href = link?.getAttribute('href') || '';
      const text = link?.textContent || '\u89C6\u9891';
      blocks.push(new Paragraph({
        children: [
          new TextRun({ text: '[\u89C6\u9891] ', bold: true }),
          new ExternalHyperlink({ link: href, children: [new TextRun({ text, color: '0563C1', underline: { type: 'single' } })] }),
        ],
      }));
      return blocks;
    }

    // \u94FE\u63A5\u5361\u7247
    if (element.classList?.contains('LinkCard')) {
      const link = element.querySelector('a');
      const href = link?.getAttribute('href') || element.querySelector('[href]')?.getAttribute('href') || '';
      const title = element.querySelector('.LinkCard-title')?.textContent || link?.textContent || '\u94FE\u63A5';
      blocks.push(new Paragraph({
        children: [new ExternalHyperlink({ link: href, children: [new TextRun({ text: title, color: '0563C1', underline: { type: 'single' } })] })],
      }));
      return blocks;
    }

    // \u72EC\u7ACB\u56FE\u7247\uFF08\u5757\u7EA7\uFF09
    if (tag === 'img' && !element.getAttribute('eeimg')) {
      const inlineRuns = collectInlineElements(element, {}, ctx);
      if (inlineRuns.length > 0) blocks.push(new Paragraph({ children: inlineRuns, alignment: AlignmentType.CENTER }));
      return blocks;
    }

    // \u6C34\u5E73\u7EBF
    if (tag === 'hr') {
      blocks.push(new Paragraph({
        children: [],
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } },
        spacing: { before: 120, after: 120 },
      }));
      return blocks;
    }

    // \u5BB9\u5668\u5143\u7D20\uFF1A\u9012\u5F52
    if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'span') {
      for (const child of element.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          blocks.push(...convertBlockElement(child, ctx));
        } else if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
          blocks.push(new Paragraph({ children: collectInlineElements(child, {}, ctx) }));
        }
      }
      return blocks;
    }

    // \u672A\u77E5\u5143\u7D20\uFF1A\u63D0\u53D6\u6587\u672C
    const textContent = element.textContent?.trim();
    if (textContent) blocks.push(new Paragraph({ children: [new TextRun({ text: textContent })] }));
    return blocks;
  }

  // ============================================================
  // \u8868\u683C\u8F6C\u6362
  // ============================================================

  function convertTable(tableEl, ctx) {
    const rows = [];
    for (const tr of tableEl.querySelectorAll('tr')) {
      const cells = [];
      const cellEls = tr.querySelectorAll('th, td');
      const isHeader = cellEls[0]?.tagName.toLowerCase() === 'th';

      for (const cell of cellEls) {
        const children = [];
        for (const child of cell.childNodes) {
          if (child.nodeType === Node.ELEMENT_NODE) {
            children.push(...convertBlockElement(child, ctx));
          } else if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
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
  // Front Matter \u5143\u4FE1\u606F\u8868\u683C
  // ============================================================

  function buildFrontMatterTable(meta) {
    if (!meta) return [];
    const fields = [
      ['ID', meta.id], ['\u6807\u9898', meta.title], ['\u4F5C\u8005', meta.author],
      ['\u6765\u6E90', meta.url], ['\u65E5\u671F', meta.date],
    ].filter(([, v]) => v);

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
              children: label === '\u6765\u6E90'
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
  // \u4E3B\u8F6C\u6362\u51FD\u6570
  // ============================================================

  /**
   * @param {string} htmlString - \u77E5\u4E4E\u6587\u7AE0 HTML
   * @param {Object} options - { images: 'embed'|'link', imageData: Map<url, {buffer,ext}>, frontMatter: {id,title,author,url,date} }
   * @returns {Promise<Blob>}
   */
  async function htmlToDocx(htmlString, options) {
    options = options || {};
    const doc = parseHTML(htmlString);
    const body = doc.body;

    const ctx = {
      images: options.images || 'link',
      imageData: options.imageData || new Map(),
      footnotes: [],
    };

    const sections = [];

    if (options.frontMatter) sections.push(...buildFrontMatterTable(options.frontMatter));

    for (const child of body.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        sections.push(...convertBlockElement(child, ctx));
      } else if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
        sections.push(new Paragraph({ children: [new TextRun({ text: child.textContent })] }));
      }
    }

    const footnotes = {};
    for (const fn of ctx.footnotes) {
      footnotes[fn.id] = {
        children: [new Paragraph({ children: [new TextRun({ text: fn.text })] })],
      };
    }

    const document = new Document({
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
      footnotes: Object.keys(footnotes).length > 0 ? footnotes : undefined,
      sections: [{ children: sections }],
    });

    return await Packer.toBlob(document);
  }

  // ============================================================
  // \u8BC4\u8BBA docx \u751F\u6210
  // ============================================================

  async function commentsToDocx(comments, title) {
    const sections = [];

    sections.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: `${title} - \u8BC4\u8BBA\u533A` })],
    }));

    const totalCount = comments.reduce((sum, c) => sum + 1 + (c.child_comments?.length || 0), 0);
    sections.push(new Paragraph({ children: [new TextRun({ text: `\u5171 ${totalCount} \u6761\u8BC4\u8BBA`, color: '666666' })] }));
    sections.push(new Paragraph({ children: [] }));

    for (const comment of comments) {
      const authorTag = comment.author_tag?.some?.(t => t.type === 'content_author') ? '\uFF08\u4F5C\u8005\uFF09' : '';
      const ipInfo = comment.comment_tag?.find?.(t => t.type === 'ip_info')?.text || '';
      const time = _formatTimestamp(comment.created_time);
      const likes = comment.like_count || 0;
      const metaText = [`${comment.author?.name || '\u533F\u540D'}${authorTag}`, time, ipInfo, `\uD83D\uDC4D ${likes}`].filter(Boolean).join(' \u00B7 ');

      sections.push(new Paragraph({
        children: [new TextRun({ text: metaText, bold: true, size: 20 })],
        indent: { left: convertInchesToTwip(0.3) },
        border: { left: { style: BorderStyle.SINGLE, size: 6, color: '4A90D9', space: 8 } },
        spacing: { before: 120 },
      }));

      sections.push(new Paragraph({
        children: [new TextRun({ text: _htmlToText(comment.content || ''), size: 20 })],
        indent: { left: convertInchesToTwip(0.3) },
        border: { left: { style: BorderStyle.SINGLE, size: 6, color: '4A90D9', space: 8 } },
        spacing: { after: 60 },
      }));

      if (comment.child_comments?.length > 0) {
        for (const child of comment.child_comments) {
          const cTag = child.author_tag?.some?.(t => t.type === 'content_author') ? '\uFF08\u4F5C\u8005\uFF09' : '';
          const cIp = child.comment_tag?.find?.(t => t.type === 'ip_info')?.text || '';
          const cTime = _formatTimestamp(child.created_time);
          const replyTo = child.reply_to_author?.name ? ` \u56DE\u590D ${child.reply_to_author.name}` : '';
          const cMeta = [`${child.author?.name || '\u533F\u540D'}${cTag}${replyTo}`, cTime, cIp].filter(Boolean).join(' \u00B7 ');

          sections.push(new Paragraph({
            children: [new TextRun({ text: cMeta, bold: true, size: 18, color: '555555' })],
            indent: { left: convertInchesToTwip(0.8) },
            border: { left: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 8 } },
            spacing: { before: 60 },
          }));

          sections.push(new Paragraph({
            children: [new TextRun({ text: _htmlToText(child.content || ''), size: 18 })],
            indent: { left: convertInchesToTwip(0.8) },
            border: { left: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 8 } },
            spacing: { after: 40 },
          }));
        }
      }

      sections.push(new Paragraph({
        children: [],
        border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: 'E0E0E0' } },
        spacing: { before: 80, after: 80 },
      }));
    }

    const document = new Document({ sections: [{ children: sections }] });
    return await Packer.toBlob(document);
  }

  function _htmlToText(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || '';
  }

  function _formatTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // ============================================================
  // \u5BFC\u51FA
  // ============================================================

  window.htmlToDocx = htmlToDocx;
  window.commentsToDocx = commentsToDocx;
})();
