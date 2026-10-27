"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AppWindow, Maximize2, Minimize2 } from "lucide-react";
import { getHeadingLabel, getHeadingLabels, getMediaEntries, getMediaLabels } from "@/lib/document/numbering";
import { formatReferenceEntry, formatReferenceParts, getAuthorDateYearSuffixMap, getCitationNumberMap, getReferenceAnchorId, getUsedReferences, renderCitationHtml } from "@/lib/document/references";
import { sanitizeEditorHtml } from "@/lib/document/sanitizeHtml";
import { getDocumentCharacterCount, getDocumentHeadingCount, getDocumentStructureCounts, getDocumentWordCount } from "@/lib/document/stats";
import { collectHangingNumbers, formatHangingMarker } from "@/lib/document/hanging";
import { codeTokenColor, getCodeTheme, resolveCodeLanguage, tokenizeCodeLine } from "@/lib/document/codeHighlight";
import { getOutlineStyle, getOutlineTextFormat, getParagraphTextIndentCm } from "@/lib/document/paragraphFormat";
import { renderMathNotationHtml } from "@/lib/document/mathNotation";
import { FRONT_MATTER_PROFILE_DEFAULTS, getFrontMatterModel, renderFrontMatterTemplateHtml } from "@/lib/document/frontMatterTemplates";
import { useDocumentStore } from "@/store/useDocumentStore";

const PX_PER_CM = 96 / 2.54;
let textMeasureContext;

function roman(number) {
  const values = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let result = "";
  let remaining = number;
  values.forEach(([value, symbol]) => { while (remaining >= value) { result += symbol; remaining -= value; } });
  return result || "I";
}

function pageNumber(number, style) {
  if (style === "roman-lower") return roman(number).toLowerCase();
  if (style === "roman-upper") return roman(number);
  return String(number);
}

function stripHtml(html) {
  return String(html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').trim();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
}

function estimateLineCount(html, availableWidth, fontFamily, fontSizePx, bold = false, italic = false) {
  if (typeof window !== "undefined" && !textMeasureContext) textMeasureContext = window.document.createElement("canvas").getContext("2d");
  const context = textMeasureContext;
  if (!context) return Math.max(1, Math.ceil(stripHtml(html).length / Math.max(1, availableWidth / (fontSizePx * (bold ? 0.55 : 0.52)))));
  context.font = `${italic ? "italic " : ""}${bold ? "bold " : ""}${fontSizePx}px "${fontFamily.replaceAll('"', "")}"`;
  const text = String(html ?? "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/(?:p|div|blockquote)>/gi, "\n")
    .replace(/<\/?(?:ul|ol)\b[^>]*>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"');
  let lineCount = 0;
  text.split("\n").forEach((paragraph) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    // Closing list/paragraph tags add structural newlines, not visible blank
    // lines. Counting those empty segments made lists appear several times
    // taller than they render and pushed them onto the next preview page.
    if (!words.length) return;
    let line = "";
    let lines = 1;
    for (const word of words) {
      const candidate = line ? line + " " + word : word;
      if (line && context.measureText(candidate).width > availableWidth) {
        lines += 1;
        line = word;
      } else line = candidate;
    }
    lineCount += lines;
  });
  return Math.max(1, lineCount);
}

function splitRichListContent(html) {
  if (typeof window === "undefined" || !/<(?:ul|ol)\b/i.test(String(html ?? ""))) return null;
  const parsed = new DOMParser().parseFromString(sanitizeEditorHtml(html), "text/html");
  const parts = [];
  let foundList = false;
  let regularNodes = [];
  const flushRegular = () => {
    if (!regularNodes.length) return;
    const wrapper = window.document.createElement("div");
    regularNodes.forEach((child) => wrapper.append(child));
    parts.push({ html: wrapper.innerHTML, isListItem: false });
    regularNodes = [];
  };
  const appendListItems = (list) => {
    const start = Math.max(1, Number(list.getAttribute("start")) || 1);
    let itemIndex = 0;
    [...list.children].filter((item) => item.tagName === "LI").forEach((item) => {
      const nestedLists = [...item.children].filter((child) => ["OL", "UL"].includes(child.tagName));
      const contentNodes = [...item.childNodes].filter((child) => !(child.nodeType === Node.ELEMENT_NODE && ["OL", "UL"].includes(child.tagName)));
      const text = contentNodes.map((child) => child.textContent ?? "").join("").trim();
      if (text) {
        itemIndex += 1;
        const listPart = list.cloneNode(false);
        if (listPart.tagName === "OL") listPart.setAttribute("start", String(start + itemIndex - 1));
        const listItem = item.cloneNode(false);
        contentNodes.forEach((child) => listItem.append(child.cloneNode(true)));
        listPart.append(listItem);
        parts.push({ html: listPart.outerHTML, isListItem: true, indentCm: Number(listPart.getAttribute("data-dc-indent-cm")) || 0.65 });
      }
      nestedLists.forEach((nested) => appendListItems(nested));
    });
  };
  [...parsed.body.childNodes].forEach((child) => {
    if (child.nodeType === Node.ELEMENT_NODE && ["OL", "UL"].includes(child.tagName)) {
      foundList = true;
      flushRegular();
      appendListItems(child);
      return;
    }
    regularNodes.push(child.cloneNode(true));
  });
  flushRegular();
  return foundList && parts.length ? parts : null;
}

function measureRichTextLines(html, width, fontFamily, fontSizePx, lineSpacing, firstLineIndentPx, bold = false, italic = false) {
  if (typeof window === "undefined" || /<(?:ul|ol|li|blockquote)\b/i.test(String(html ?? ""))) return null;
  const container = window.document.createElement("div");
  Object.assign(container.style, {
    position: "fixed", left: "-10000px", top: "0", visibility: "hidden", width: `${width}px`,
    fontFamily: `"${fontFamily.replaceAll('"', "")}", serif`, fontSize: `${fontSizePx}px`, fontWeight: bold ? "700" : "400", fontStyle: italic ? "italic" : "normal",
    lineHeight: String(lineSpacing), textIndent: `${firstLineIndentPx}px`, whiteSpace: "normal",
  });
  container.innerHTML = renderMathNotationHtml(sanitizeEditorHtml(html));
  window.document.body.appendChild(container);
  try {
    const walker = window.document.createTreeWalker(container, window.NodeFilter.SHOW_TEXT);
    const groups = new Map();
    let textNode;
    while ((textNode = walker.nextNode())) {
      const words = [...textNode.textContent.matchAll(/\S+/g)];
      words.forEach((word) => {
        const range = window.document.createRange();
        range.setStart(textNode, word.index);
        range.setEnd(textNode, word.index + word[0].length);
        const rect = range.getBoundingClientRect();
        if (!rect.height) return;
        const top = Math.round(rect.top * 2) / 2;
        const group = groups.get(top) ?? { startNode: textNode, startOffset: word.index, endNode: textNode, endOffset: word.index + word[0].length };
        group.endNode = textNode;
        group.endOffset = word.index + word[0].length;
        groups.set(top, group);
      });
    }
    const ordered = [...groups.values()];
    if (ordered.length < 2) return null;
    return ordered.map((group) => {
      const range = window.document.createRange();
      range.setStart(group.startNode, group.startOffset);
      range.setEnd(group.endNode, group.endOffset);
      const wrapper = window.document.createElement("div");
      wrapper.appendChild(range.cloneContents());
      return wrapper.innerHTML;
    });
  } finally {
    container.remove();
  }
}

function estimateTableHeight(node, contentWidth, typography) {
  const rows = Array.isArray(node.tableData?.rows) && node.tableData.rows.length
    ? node.tableData.rows
    : [["", ""], ["", ""]];
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const cellWidth = Math.max(24, contentWidth / columnCount - 12);
  const bodyFontPx = typography.bodyPt * 96 / 72;
  const tableHeight = rows.reduce((total, row) => {
    const lines = Math.max(1, ...row.map((cell) => estimateLineCount(String(cell ?? ""), cellWidth, typography.fontFamily, bodyFontPx)));
    return total + lines * bodyFontPx * 1.25 + 8;
  }, 0);
  const captionFontPx = typography.captionPt * 96 / 72;
  const captionLines = estimateLineCount(node.caption ?? "", contentWidth, typography.fontFamily, captionFontPx);
  return Math.max(86, tableHeight + captionLines * captionFontPx * 1.25 + 30);
}

function headingText(node, number) { return getHeadingLabel(node, number); }
function chapterHeadingLines(value) { return String(value ?? "").replace(/^(BAB\s+[IVXLCDM]+)\s+/i, "$1\n"); }

function collectHeadings(nodes, labels, result = []) {
  for (const node of nodes ?? []) {
    if (["chapter", "section", "subsection"].includes(node.type)) result.push({ id: node.id, type: node.type, text: labels[node.id] ?? node.title });
    collectHeadings(node.children, labels, result);
  }
  return result;
}

function buildBlocks(nodes, context, typography, paragraph, contentWidth, tocHeadings, mediaEntries, hangingNumbers, documentData) {
  const blocks = [];
  let chapterIndex = context.chapterIndex ?? 0;
  let sectionIndex = 0;
  let subsectionIndex = 0;

  for (const node of nodes ?? []) {
    const next = { ...context, chapterIndex };
    if (node.type === "titlePage") {
      blocks.push({ node: { ...node, id: `${node.id}:break-before` }, kind: "pageBreak", height: 0 });
      blocks.push({ node, kind: "titlePage", height: 560, numbering: context.numbering ?? null });
      blocks.push({ node: { ...node, id: `${node.id}:break-after` }, kind: "pageBreak", height: 0 });
    } else if (node.type === "frontMatter") {
      blocks.push({ node: { ...node, id: `${node.id}:break-before` }, kind: "pageBreak", height: 0 });
      if (node.frontMatterTemplate) {
        if (node.frontMatterTemplate === "preface") {
          blocks.push({ node, kind: "frontMatterTitle", height: typography.heading1Pt * 2.2 + 24 });
          const lineHeight = typography.bodyPt * paragraph.lineSpacing * 96 / 72;
          const lineFragments = measureRichTextLines(node.content ?? "", contentWidth, typography.fontFamily, typography.bodyPt * 96 / 72, paragraph.lineSpacing, 0, typography.bodyBold, typography.bodyItalic);
          if (lineFragments?.length > 1) {
            blocks.push({ node, kind: "paragraph", lineFragments, lineHeight, beforeHeight: 0, afterHeight: 0, height: lineFragments.length * lineHeight, firstLineHeight: lineHeight, frontMatter: true, reserveFollowing: true });
          } else if (node.content?.trim()) {
            const estimatedLines = estimateLineCount(node.content, contentWidth, typography.fontFamily, typography.bodyPt * 96 / 72, typography.bodyBold, typography.bodyItalic);
            blocks.push({ node, kind: "paragraph", staticHtml: node.content, lineHeight, height: estimatedLines * lineHeight, firstLineHeight: lineHeight, frontMatter: true });
          }
          const model = getFrontMatterModel(node, documentData.frontMatterProfile, documentData.title);
          blocks.push({ node, kind: "prefaceSignature", signature: model.signature, height: 190 });
        } else blocks.push({ node, kind: "frontMatterTemplate", height: 690 });
      } else {
        blocks.push({ node, kind: "frontMatterTitle", height: typography.heading1Pt * 2.2 + 20 });
      }
      if (!node.frontMatterTemplate && node.content) {
        const lineHeight = typography.bodyPt * paragraph.lineSpacing * 96 / 72;
        const estimatedLines = estimateLineCount(node.content, contentWidth, typography.fontFamily, typography.bodyPt * 96 / 72, typography.bodyBold, typography.bodyItalic);
        blocks.push({ node, kind: "paragraph", lineHeight, beforeHeight: 0, afterHeight: 0, height: estimatedLines * lineHeight, firstLineHeight: lineHeight, frontMatter: true });
      }
      blocks.push({ node: { ...node, id: `${node.id}:break-after` }, kind: "pageBreak", height: 0 });
    } else if (node.type === "abstract") {
      if (node.content?.trim() || node.keywords?.trim()) {
        const numbering = context.numbering ?? null;
        blocks.push({ node: { ...node, id: `${node.id}:break-before` }, kind: "pageBreak", height: 0, numbering });
        blocks.push({ node, kind: "abstractTitle", height: typography.heading1Pt * 2.2 + 20, numbering });
        if (node.content?.trim()) {
          const lineHeight = typography.bodyPt * paragraph.lineSpacing * 96 / 72;
          const estimatedLines = estimateLineCount(node.content, contentWidth, typography.fontFamily, typography.bodyPt * 96 / 72, typography.bodyBold, typography.bodyItalic);
          const lineFragments = estimatedLines > 1 ? measureRichTextLines(node.content, contentWidth, typography.fontFamily, typography.bodyPt * 96 / 72, paragraph.lineSpacing, 0, typography.bodyBold, typography.bodyItalic) : null;
          const lineCount = lineFragments?.length ?? estimatedLines;
          blocks.push({ node, kind: "paragraph", lineFragments, lineHeight, beforeHeight: 0, afterHeight: 0, height: lineCount * lineHeight, firstLineHeight: lineHeight, frontMatter: true, numbering });
        }
        if (node.keywords?.trim()) blocks.push({ node, kind: "abstractKeywords", height: typography.bodyPt * 96 / 72 * 2, numbering });
        blocks.push({ node: { ...node, id: `${node.id}:break-after` }, kind: "pageBreak", height: 0, numbering });
      }
    } else if (node.type === "chapter") {
      chapterIndex += 1;
      next.chapterIndex = chapterIndex;
      next.sectionIndex = 0;
      next.subsectionIndex = 0;
      const style = getOutlineStyle(documentData, "chapter");
      const textFormat = getOutlineTextFormat(documentData, "chapter");
      blocks.push({ node, kind: "heading", level: 1, text: headingText(node, chapterIndex), style, textFormat, height: textFormat.fontSizePt * style.lineSpacing * 96 / 72 + style.beforePt * 96 / 72 + style.afterPt * 96 / 72 + 8, startsChapter: node.pageStart !== false, pageBreakBefore: style.pageBreakBefore, keepWithNext: style.keepWithNext, keepLinesTogether: style.keepLinesTogether, numbering: node.pageNumbering ?? null });
    } else if (node.type === "section") {
      sectionIndex += 1;
      subsectionIndex = 0;
      next.sectionIndex = sectionIndex;
      next.subsectionIndex = subsectionIndex;
      const number = `${chapterIndex || 1}.${sectionIndex}`;
      const style = getOutlineStyle(documentData, "section");
      const textFormat = getOutlineTextFormat(documentData, "section");
      blocks.push({ node, kind: "heading", level: 2, text: headingText(node, number), style, textFormat, height: textFormat.fontSizePt * style.lineSpacing * 96 / 72 + style.beforePt * 96 / 72 + style.afterPt * 96 / 72 + 8, pageBreakBefore: style.pageBreakBefore, keepWithNext: style.keepWithNext, keepLinesTogether: style.keepLinesTogether, numbering: context.numbering ?? null });
    } else if (node.type === "subsection") {
      subsectionIndex += 1;
      next.subsectionIndex = subsectionIndex;
      const number = `${chapterIndex || 1}.${context.sectionIndex || sectionIndex || 1}.${subsectionIndex}`;
      const style = getOutlineStyle(documentData, "subsection");
      const textFormat = getOutlineTextFormat(documentData, "subsection");
      blocks.push({ node, kind: "heading", level: 3, text: headingText(node, number), style, textFormat, height: textFormat.fontSizePt * style.lineSpacing * 96 / 72 + style.beforePt * 96 / 72 + style.afterPt * 96 / 72 + 8, pageBreakBefore: style.pageBreakBefore, keepWithNext: style.keepWithNext, keepLinesTogether: style.keepLinesTogether, numbering: context.numbering ?? null });
    } else if (node.type === "paragraph") {
      const lineHeight = typography.bodyPt * paragraph.lineSpacing * 96 / 72;
      const bodyFontPx = typography.bodyPt * 96 / 72;
      const textIndentCm = getParagraphTextIndentCm(paragraph);
      const paragraphWidth = Math.max(24, contentWidth - (paragraph.leftIndentCm + paragraph.rightIndentCm) * PX_PER_CM);
      const appendHangingItems = () => {
        const list = node.hangingSettings;
        if (!list || !node.hangingItems?.length) return;
        const indentCm = Math.min(3, Math.max(0.5, Number(list.indentCm) || 0.65));
        const hangingCm = Math.min(indentCm, Math.max(0.2, Number(list.hangingCm) || 0.6));
        const hangingFontFamily = list.fontFamily || typography.fontFamily;
        const hangingFontSizePt = Number(list.fontSizePt) || typography.bodyPt;
        const hangingLineSpacing = Number(list.lineSpacing) || paragraph.lineSpacing;
        const hangingLineHeight = hangingFontSizePt * hangingLineSpacing * 96 / 72;
        const hangingBeforeHeight = (Number.isFinite(Number(list.beforePt)) ? Number(list.beforePt) : paragraph.beforePt) * 96 / 72;
        const hangingAfterHeight = (Number.isFinite(Number(list.afterPt)) ? Number(list.afterPt) : paragraph.afterPt) * 96 / 72;
        const hangingAlignment = list.alignment || paragraph.alignment || "justify";
        node.hangingItems.forEach((item, index) => {
          const marker = formatHangingMarker(list.format, index + 1);
          const markerText = list.format === "bullet" ? marker : `${marker}.`;
          const contentHtml = `${escapeHtml(markerText)}&nbsp;${escapeHtml(item.text || "")}`;
          const lines = estimateLineCount(contentHtml, Math.max(24, paragraphWidth - indentCm * PX_PER_CM), hangingFontFamily, hangingFontSizePt * 96 / 72);
          const beforeHeight = index === 0 ? hangingBeforeHeight : 0;
          const afterHeight = index === node.hangingItems.length - 1 ? hangingAfterHeight : 0;
          blocks.push({ node, kind: "paragraph", staticHtml: contentHtml, listItem: true, hangingItem: true, indentCm, hangingCm, hangingFontFamily, hangingFontSizePt, hangingLineSpacing, hangingAlignment, lineHeight: hangingLineHeight, beforeHeight, afterHeight, height: lines * hangingLineHeight + beforeHeight + afterHeight, firstLineHeight: hangingLineHeight + beforeHeight, numbering: context.numbering ?? null });
        });
      };
      if (node.hangingList?.listId) {
        const list = node.hangingList;
        const indentCm = Math.min(3, Math.max(0.5, Number(list.indentCm) || 0.65));
        const hangingCm = Math.min(indentCm, Math.max(0.2, Number(list.hangingCm) || 0.6));
        const marker = formatHangingMarker(list.format, hangingNumbers[node.id] ?? 1);
        const markerText = list.format === "bullet" ? marker : `${marker}.`;
        const contentHtml = `${escapeHtml(markerText)}&nbsp;${escapeHtml(node.title || "")}`;
        const lines = estimateLineCount(contentHtml, Math.max(24, paragraphWidth - indentCm * PX_PER_CM), typography.fontFamily, bodyFontPx);
        blocks.push({ node, kind: "paragraph", staticHtml: contentHtml, listItem: true, hangingItem: true, indentCm, hangingCm, lineHeight, beforeHeight: paragraph.beforePt * 96 / 72, afterHeight: paragraph.afterPt * 96 / 72, height: lines * lineHeight + paragraph.beforePt * 96 / 72 + paragraph.afterPt * 96 / 72, firstLineHeight: lineHeight, numbering: context.numbering ?? null });
        continue;
      }
      if (!node.content?.trim() && node.hangingItems?.length) {
        appendHangingItems();
        continue;
      }
      const richParts = splitRichListContent(node.content);
      if (richParts) {
        richParts.forEach((part, index) => {
          const partWidth = Math.max(24, paragraphWidth - (part.indentCm ?? 0) * PX_PER_CM);
          const lines = estimateLineCount(part.html, partWidth, typography.fontFamily, bodyFontPx, typography.bodyBold, typography.bodyItalic);
          const beforeHeight = index === 0 && !part.isListItem ? paragraph.beforePt * 96 / 72 : 0;
          const afterHeight = index === richParts.length - 1 && !part.isListItem ? paragraph.afterPt * 96 / 72 : 0;
          blocks.push({ node, kind: "paragraph", staticHtml: part.html, listItem: part.isListItem, lineHeight, beforeHeight, afterHeight, height: lines * lineHeight + beforeHeight + afterHeight, firstLineHeight: lineHeight + beforeHeight, numbering: context.numbering ?? null });
        });
        appendHangingItems();
        continue;
      }
      const estimatedLines = estimateLineCount(node.content, paragraphWidth, typography.fontFamily, bodyFontPx, typography.bodyBold, typography.bodyItalic);
      const lineFragments = estimatedLines > 1
        ? measureRichTextLines(node.content, paragraphWidth, typography.fontFamily, bodyFontPx, paragraph.lineSpacing, textIndentCm * PX_PER_CM, typography.bodyBold, typography.bodyItalic)
        : null;
      const lineCount = lineFragments?.length ?? estimatedLines;
      blocks.push({ node, kind: "paragraph", lineFragments, lineHeight, beforeHeight: paragraph.beforePt * 96 / 72, afterHeight: paragraph.afterPt * 96 / 72, height: lineCount * lineHeight + paragraph.beforePt * 96 / 72 + paragraph.afterPt * 96 / 72, firstLineHeight: lineHeight + paragraph.beforePt * 96 / 72, pageBreakBefore: paragraph.pageBreakBefore, keepWithNext: paragraph.keepWithNext, keepLinesTogether: paragraph.keepLinesTogether, numbering: context.numbering ?? null });
      appendHangingItems();
    } else if (node.type === "codeBlock") {
      const codeLines = String(node.content ?? "").split("\n");
      const codeFontPx = (Number(node.codeFontSizePt) || 9) * 96 / 72;
      const charsPerLine = Math.max(12, Math.floor(contentWidth / (codeFontPx * 0.62)));
      const visualLines = codeLines.reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
      const codeLineHeight = codeFontPx * 1.35;
      blocks.push({ node, kind: "codeBlock", height: visualLines * codeLineHeight + 26, codeLineHeight, codeFontPx, numbering: context.numbering ?? null });
    } else if (node.type === "image") {
      blocks.push({ node, kind: "image", height: node.asset?.dataUrl ? 250 : 80, numbering: context.numbering ?? null });
    } else if (node.type === "table") {
      blocks.push({ node, kind: "table", height: estimateTableHeight(node, contentWidth, typography), numbering: context.numbering ?? null });
    } else if (node.type === "pageBreak") {
      blocks.push({ node, kind: "pageBreak", height: 0, numbering: context.numbering ?? null });
    } else if (node.type === "tableOfContents") {
      const numbering = context.numbering ?? null;
      blocks.push({ node: { ...node, id: `${node.id}:break-before` }, kind: "pageBreak", height: 0, numbering });
      blocks.push({ node, kind: "tableOfContentsTitle", height: typography.heading1Pt * 2.2 + 20, numbering });
      tocHeadings.forEach((entry) => blocks.push({ node: { ...node, id: `${node.id}:entry:${entry.id}` }, kind: "tableOfContentsEntry", entry, height: typography.bodyPt * 1.45 + 4, numbering }));
      blocks.push({ node: { ...node, id: `${node.id}:break-after` }, kind: "pageBreak", height: 0, numbering });
    } else if (node.type === "listOfFigures" || node.type === "listOfTables") {
      const entries = mediaEntries[node.type] ?? [];
      if (entries.length) {
        const kind = node.type === "listOfFigures" ? "figureList" : "tableList";
        const numbering = context.numbering ?? null;
        blocks.push({ node: { ...node, id: `${node.id}:break-before` }, kind: "pageBreak", height: 0, numbering });
        blocks.push({ node, kind: `${kind}Title`, height: typography.heading1Pt * 2.2 + 20, numbering });
        entries.forEach((entry) => blocks.push({ node: { ...node, id: `${node.id}:entry:${entry.id}` }, kind: `${kind}Entry`, entry, height: typography.bodyPt * 1.45 + 4, numbering }));
        blocks.push({ node: { ...node, id: `${node.id}:break-after` }, kind: "pageBreak", height: 0, numbering });
      }
    }
    if (node.type === "chapter") next.numbering = node.pageNumbering ?? null;
    blocks.push(...buildBlocks(node.children, next, typography, paragraph, contentWidth, tocHeadings, mediaEntries, hangingNumbers, documentData));
    chapterIndex = next.chapterIndex ?? chapterIndex;
    if (node.type === "chapter") { sectionIndex = 0; subsectionIndex = 0; }
  }
  return blocks;
}

function paginate(blocks, availableHeight, globalNumbering) {
  const pages = [];
  const nextContentIndexes = new Array(blocks.length);
  let nextContentIndex = -1;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index].kind !== "pageBreak") nextContentIndex = index;
    nextContentIndexes[index] = nextContentIndex;
  }
  let page = { blocks: [], numbering: globalNumbering };
  let used = 0;
  const flush = () => { if (page.blocks.length) pages.push(page); page = { blocks: [], numbering: globalNumbering }; used = 0; };
  const minimumFollowingHeight = (startIndex) => {
    const index = nextContentIndexes[startIndex] ?? -1;
    if (index < 0) return 0;
    const following = blocks[index];
    if (following.kind === "heading") return following.height + minimumFollowingHeight(index + 1);
    if (following.kind === "paragraph") return Math.min(following.height, following.firstLineHeight ?? following.height);
    return following.height;
  };
  const carryTrailingHeadings = () => {
    let carryStart = page.blocks.length;
    while (carryStart > 0 && page.blocks[carryStart - 1].kind === "heading") carryStart -= 1;
    if (carryStart === page.blocks.length) return false;
    const carried = page.blocks.splice(carryStart);
    used = page.blocks.reduce((total, current) => total + current.height, 0);
    flush();
    page.blocks = carried;
    used = carried.reduce((total, current) => total + current.height, 0);
    page.numbering = carried[0].numbering ?? globalNumbering;
    return true;
  };
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const nextIndex = nextContentIndexes[index + 1] ?? -1;
    const nextBlock = nextIndex >= 0 ? blocks[nextIndex] : null;
    if (block.kind === "pageBreak") {
      const onlyChapterHeadingOnPage = page.blocks.length === 1 && page.blocks[0].kind === "heading" && page.blocks[0].level === 1;
      if (!onlyChapterHeadingOnPage) flush();
      continue;
    }
    if (block.kind === "prefaceSignature") {
      if (page.blocks.length && used + block.height > availableHeight) flush();
      const remainingHeight = Math.max(block.height, availableHeight - used);
      if (!page.blocks.length && block.numbering) page.numbering = block.numbering;
      page.blocks.push({ ...block, height: remainingHeight });
      used += remainingHeight;
      continue;
    }
    if ((block.startsChapter || block.pageBreakBefore) && page.blocks.length) flush();
    if (block.keepWithNext && nextBlock && page.blocks.length && used + block.height + minimumFollowingHeight(index + 1) > availableHeight) {
      // Keep a chapter heading attached to the subsection that follows it when
      // the remaining space on the current page is too small. Flushing here
      // used to leave the chapter heading by itself at the bottom of a page.
      if (!carryTrailingHeadings()) flush();
    }
    if (block.keepLinesTogether && block.height <= availableHeight && used + block.height > availableHeight && page.blocks.length) {
      // If a paragraph must move intact, carry the heading chain with it so
      // the live preview does not strand the chapter/subsection above it.
      if (!carryTrailingHeadings()) flush();
    }
    if (block.kind === "paragraph" && block.lineFragments?.length > 1) {
      if (block.height <= availableHeight - used) {
        if (!page.blocks.length && block.numbering) page.numbering = block.numbering;
        page.blocks.push(block);
        used += block.height;
        continue;
      }
      let lineIndex = 0;
      let isFirstFragment = true;
      while (lineIndex < block.lineFragments.length) {
        let remainingHeight = availableHeight - used;
        const firstSpacing = isFirstFragment ? block.beforeHeight : 0;
        const minimumLineHeight = block.lineHeight + firstSpacing;
        if (remainingHeight < minimumLineHeight && page.blocks.length) {
          if (!carryTrailingHeadings()) flush();
          remainingHeight = availableHeight - used;
        }
        if (remainingHeight < minimumLineHeight && !page.blocks.length && pages.length) {
          flush();
          remainingHeight = availableHeight;
        }
        if (remainingHeight < minimumLineHeight) {
          const count = Math.max(1, Math.min(block.lineFragments.length - lineIndex, Math.floor(availableHeight / block.lineHeight)));
          const isLastFragment = lineIndex + count >= block.lineFragments.length;
          const fragmentHeight = count * block.lineHeight + firstSpacing + (isLastFragment ? block.afterHeight : 0);
          page.blocks.push({ ...block, kind: "paragraphFragment", content: block.lineFragments.slice(lineIndex, lineIndex + count).join("<br />"), firstFragment: isFirstFragment, lastFragment: isLastFragment, height: fragmentHeight });
          used += fragmentHeight;
          lineIndex += count;
          isFirstFragment = false;
          if (lineIndex < block.lineFragments.length) flush();
          continue;
        }
        const remainingLines = block.lineFragments.length - lineIndex;
        let count = Math.min(remainingLines, Math.floor((remainingHeight - firstSpacing) / block.lineHeight));
        if (count === 1 && remainingLines > 1 && page.blocks.length) {
          if (!carryTrailingHeadings()) flush();
          remainingHeight = availableHeight - used;
          count = Math.min(remainingLines, Math.floor((remainingHeight - firstSpacing) / block.lineHeight));
        }
        if (block.reserveFollowing && nextBlock?.kind === "prefaceSignature") {
          const maxLinesWithSignature = Math.max(0, Math.floor((remainingHeight - firstSpacing - nextBlock.height) / block.lineHeight));
          const maxLinesWithoutSignature = Math.floor((remainingHeight - firstSpacing) / block.lineHeight);
          if (remainingLines <= maxLinesWithoutSignature && remainingLines > maxLinesWithSignature) count = maxLinesWithSignature;
          if (count <= 0 && page.blocks.length) { flush(); continue; }
          if (count <= 0) count = Math.min(1, remainingLines);
        }
        if (count > 1 && remainingLines - count === 1) count -= 1;
        if (count === remainingLines && remainingHeight < firstSpacing + count * block.lineHeight + block.afterHeight && count > 1) count -= 1;
        const isLastFragment = lineIndex + count >= block.lineFragments.length;
        const fragmentHeight = count * block.lineHeight + firstSpacing + (isLastFragment ? block.afterHeight : 0);
        page.blocks.push({ ...block, kind: "paragraphFragment", content: block.lineFragments.slice(lineIndex, lineIndex + count).join("<br />"), firstFragment: isFirstFragment, lastFragment: isLastFragment, height: fragmentHeight });
        used += fragmentHeight;
        lineIndex += count;
        isFirstFragment = false;
        if (lineIndex < block.lineFragments.length) flush();
      }
      continue;
    }
    if (page.blocks.length && used + block.height > availableHeight) {
      let carryStart = page.blocks.length;
      if (["paragraph", "image", "table"].includes(block.kind)) {
        while (carryStart > 0 && page.blocks[carryStart - 1].kind === "heading") carryStart -= 1;
      }
      if (carryStart < page.blocks.length) {
        const carriedHeadings = page.blocks.splice(carryStart);
        used = page.blocks.reduce((total, current) => total + current.height, 0);
        flush();
        page.blocks = carriedHeadings;
        used = carriedHeadings.reduce((total, current) => total + current.height, 0);
        page.numbering = carriedHeadings[0].numbering ?? globalNumbering;
      } else flush();
    }
    if (!page.blocks.length && block.numbering) page.numbering = block.numbering;
    page.blocks.push(block);
    used += block.height;
  }
  if (page.blocks.length || !pages.length) pages.push(page);
  return pages;
}

function getPageNumbers(pages, globalNumbering) {
  let counter = globalNumbering.startAt ?? 1;
  return pages.map((page) => {
    const numbering = page.numbering ?? globalNumbering;
    const startsChapter = page.blocks[0]?.level === 1;
    if (startsChapter && numbering.restart) counter = numbering.startAt ?? 1;
    const value = counter;
    counter += 1;
    return { value, numbering };
  });
}

function EditableHeading({ node, value, style, onChange }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current && document.activeElement !== ref.current) ref.current.textContent = value; }, [node.id, value]);
  return <div ref={ref} contentEditable suppressContentEditableWarning role="textbox" aria-label="Edit judul pada pratinjau" style={style} onInput={(event) => onChange(event.currentTarget.textContent)}>{value}</div>;
}

function EditableContent({ node, style, onChange, references, citationStyle, citationNumbers, citationYearSuffixes }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current && document.activeElement !== ref.current) ref.current.innerHTML = renderMathNotationHtml(sanitizeEditorHtml(renderCitationHtml(node.content ?? "", references, citationStyle, citationNumbers, citationYearSuffixes))); }, [node.id, node.content, references, citationStyle, citationNumbers, citationYearSuffixes]);
  return <div ref={ref} className="preview-rich-content" contentEditable suppressContentEditableWarning lang="id" spellCheck={true} role="textbox" aria-label="Edit isi pada pratinjau" style={style} onInput={(event) => onChange(sanitizeEditorHtml(event.currentTarget.innerHTML))} />;
}

function Block({ block, document, labels, onNodeChange, onNodeSelect, headingPages, mediaPages, citationNumbers, citationYearSuffixes }) {
  const { node } = block;
  const base = { fontFamily: `"${document.typography.fontFamily}", serif`, color: "#0f172a" };
  if (block.kind === "codeBlock") { const language = resolveCodeLanguage(node.codeLanguage, node.content); const theme = getCodeTheme(node.codeTheme); return <section className="preview-code-block" role="group" aria-label={`Blok kode ${language}`} onClick={() => onNodeSelect(node.id)} style={{ ...base, display: "block", width: "100%", margin: "8pt 0 12pt", borderTop: `1px solid ${theme.border}`, borderRight: `1px solid ${theme.border}`, borderBottom: `1px solid ${theme.border}`, borderLeft: "3px solid #64748b", borderRadius: 4, background: theme.background, overflow: "hidden", cursor: "text" }}><div style={{ padding: "4px 9px", borderBottom: `1px solid ${theme.border}`, background: theme.header, color: theme.label, font: "9px Arial, sans-serif", textTransform: "uppercase", letterSpacing: ".04em" }}>{language}</div><pre style={{ display: "block", margin: 0, padding: "8px 10px", color: theme.foreground, fontFamily: 'Consolas, "Courier New", monospace', fontSize: `${node.codeFontSizePt ?? 9}pt`, lineHeight: 1.35, whiteSpace: "pre-wrap", overflowWrap: "anywhere", tabSize: 4 }}>{String(node.content ?? " ").split("\n").map((line, lineIndex) => <span key={`${node.id}-line-${lineIndex}`}>{lineIndex ? "\n" : ""}{tokenizeCodeLine(line, language).map((token, tokenIndex) => <span key={`${lineIndex}-${tokenIndex}`} style={{ color: codeTokenColor(token.kind, node.codeTheme) }}>{token.text}</span>)}</span>)}</pre></section>; }
  if (block.kind === "titlePage") {
    const cover = { ...FRONT_MATTER_PROFILE_DEFAULTS, ...(document.frontMatterProfile ?? {}), ...(node.coverData ?? {}) };
    const details = [cover.institution, cover.faculty, cover.department, cover.concentration].filter(Boolean);
    return <div style={{ ...base, height: "22cm", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", textAlign: "center", fontSize: `${document.typography.bodyPt}pt`, padding: "2cm 0" }}>
      <div>{details.map((line, index) => <div key={`${line}-${index}`} style={{ fontWeight: index === 0 ? 700 : 400 }}>{line}</div>)}</div>
      <div><strong style={{ display: "block", fontSize: `${document.typography.heading1Pt}pt` }}>{cover.workType || "TUGAS AKHIR"}<br /><br />{cover.thesisTitle || document.title || "JUDUL KARYA TULIS"}</strong>{cover.logoDataUrl ? <img src={cover.logoDataUrl} alt="Logo kampus" style={{ display: "block", maxWidth: "4cm", maxHeight: "4cm", width: "auto", height: "auto", margin: "1cm auto" }} /> : <div style={{ boxSizing: "border-box", display: "grid", width: "4cm", height: "4cm", placeItems: "center", margin: "1cm auto", border: "1px dashed #94a3b8", color: "#64748b", font: "9pt Arial, sans-serif" }}>Tempat logo kampus</div>}{cover.author || cover.studentId ? <p style={{ marginTop: "1cm" }}>NIM: {cover.studentId}<br />Nama: {cover.author}</p> : null}</div>
      <div>{cover.programLevel}<br />{cover.institution}<br />{cover.city}<br />{cover.year || new Date().getFullYear()}</div>
    </div>;
  }
  if (block.kind === "frontMatterTemplate") return <div className="preview-front-matter-template" onClick={() => onNodeSelect(node.id)} style={{ ...base, fontSize: `${document.typography.bodyPt}pt`, lineHeight: document.paragraph.lineSpacing }} dangerouslySetInnerHTML={{ __html: renderFrontMatterTemplateHtml(node, document.frontMatterProfile, document.title) }} />;
  if (block.kind === "prefaceSignature") return <div className="preview-preface-signature" onClick={() => onNodeSelect(node.id)} style={{ ...base, boxSizing: "border-box", position: "absolute", right: 0, bottom: 0, display: "flex", width: "50%", flexDirection: "column", alignItems: "flex-end", paddingBottom: "0.2cm", textAlign: "right", fontSize: `${document.typography.bodyPt}pt`, lineHeight: document.paragraph.lineSpacing }}><div>{block.signature.city}, {block.signature.date}</div><div>Penulis,</div><div style={{ height: "1.5cm", flexShrink: 0 }} /><strong><u>{block.signature.name}</u></strong></div>;
  if (block.kind === "abstractTitle") return <h2 style={{ ...base, textAlign: "center", fontSize: `${document.typography.heading1Pt}pt`, margin: "14pt 0 8pt", lineHeight: document.paragraph.lineSpacing }}>{node.title || "ABSTRAK"}</h2>;
  if (block.kind === "frontMatterTitle") return <EditableHeading node={node} value={node.title || "HALAMAN AWAL"} onChange={(title) => onNodeChange(node.id, { title })} style={{ ...base, textAlign: "center", fontSize: `${document.typography.heading1Pt}pt`, fontWeight: 700, margin: "14pt 0 18pt", lineHeight: document.paragraph.lineSpacing }} />;
  if (block.kind === "abstractKeywords") return <p style={{ ...base, margin: "12pt 0 0", fontSize: `${document.typography.bodyPt}pt`, lineHeight: document.paragraph.lineSpacing }}><strong>Kata kunci: </strong>{node.keywords}</p>;
  if (block.kind === "heading") {
    const textFormat = block.textFormat ?? getOutlineTextFormat(document, node.type);
    const size = textFormat.fontSizePt;
    if (block.generated) return <div style={{ ...base, fontFamily: `"${textFormat.fontFamily}", serif`, margin: "14pt 0 8pt", fontSize: `${size}pt`, fontWeight: textFormat.bold ? 700 : 400, fontStyle: textFormat.italic ? "italic" : "normal", textAlign: "center", lineHeight: document.paragraph.lineSpacing }}>{block.text}</div>;
    const headingValue = block.level === 1 ? chapterHeadingLines(block.text) : block.text;
    const headingStyle = block.style ?? getOutlineStyle(document, node.type);
    return <EditableHeading node={node} value={headingValue} onChange={(value) => onNodeChange(node.id, { title: block.level === 1 && /^BAB\s+/i.test(value) ? value.replace(/^BAB\s+[IVXLCDM]+\s*/i, "").trim() : value.replace(/^\d+(?:\.\d+)*\s*/, "") })} style={{ ...base, fontFamily: `"${textFormat.fontFamily}", serif`, margin: `${headingStyle.beforePt}pt ${headingStyle.rightIndentCm}cm ${headingStyle.afterPt}pt ${headingStyle.leftIndentCm}cm`, textIndent: `${getParagraphTextIndentCm(headingStyle)}cm`, fontSize: `${size}pt`, fontWeight: textFormat.bold ? 700 : 400, fontStyle: textFormat.italic ? "italic" : "normal", textAlign: headingStyle.alignment, lineHeight: headingStyle.lineSpacing, whiteSpace: block.level === 1 && !node.plainHeading ? "pre-line" : "normal" }} />;
  }
  if (block.kind === "paragraph") {
    if (block.staticHtml != null) return <div className="preview-rich-content" role="document" onClick={() => onNodeSelect(node.id)} style={{ ...base, minHeight: "1em", marginTop: `${block.beforeHeight ?? 0}px`, marginBottom: `${block.afterHeight ?? 0}px`, marginLeft: block.hangingItem ? `${block.indentCm}cm` : `${document.paragraph.leftIndentCm}cm`, marginRight: `${document.paragraph.rightIndentCm}cm`, paddingLeft: block.hangingItem ? `${block.hangingCm}cm` : undefined, textIndent: block.hangingItem ? `-${block.hangingCm}cm` : block.listItem ? 0 : `${getParagraphTextIndentCm(document.paragraph)}cm`, fontFamily: block.hangingItem ? `"${block.hangingFontFamily}", serif` : undefined, fontSize: `${block.hangingItem ? block.hangingFontSizePt : document.typography.bodyPt}pt`, fontWeight: document.typography.bodyBold ? 700 : 400, fontStyle: document.typography.bodyItalic ? "italic" : "normal", lineHeight: block.hangingItem ? block.hangingLineSpacing : document.paragraph.lineSpacing, textAlign: block.hangingItem ? block.hangingAlignment : document.paragraph.alignment ?? "justify", cursor: "text", "--dc-first-indent": block.listItem ? "0cm" : `${getParagraphTextIndentCm(document.paragraph)}cm`, "--dc-left-indent": `${document.paragraph.leftIndentCm}cm`, "--dc-right-indent": `${document.paragraph.rightIndentCm}cm`, "--dc-before-spacing": "0pt", "--dc-after-spacing": "0pt" }} dangerouslySetInnerHTML={{ __html: renderMathNotationHtml(sanitizeEditorHtml(block.staticHtml)) }} />;
    return <EditableContent node={node} references={document.references ?? []} citationStyle={document.citationStyle} citationNumbers={citationNumbers} citationYearSuffixes={citationYearSuffixes} onChange={(content) => onNodeChange(node.id, { content })} style={{
      ...base,
      minHeight: "1em",
      textIndent: block.frontMatter ? 0 : `${getParagraphTextIndentCm(document.paragraph)}cm`,
      fontSize: `${document.typography.bodyPt}pt`,
      fontWeight: document.typography.bodyBold ? 700 : 400,
      fontStyle: document.typography.bodyItalic ? "italic" : "normal",
      lineHeight: document.paragraph.lineSpacing,
      textAlign: document.paragraph.alignment ?? "justify",
      marginLeft: `${document.paragraph.leftIndentCm}cm`,
      marginRight: `${document.paragraph.rightIndentCm}cm`,
      outline: "none",
      "--dc-first-indent": block.frontMatter ? "0cm" : `${getParagraphTextIndentCm(document.paragraph)}cm`,
      "--dc-left-indent": `${document.paragraph.leftIndentCm}cm`,
      "--dc-right-indent": `${document.paragraph.rightIndentCm}cm`,
      "--dc-before-spacing": `${document.paragraph.beforePt}pt`,
      "--dc-after-spacing": `${document.paragraph.afterPt}pt`,
    }} />;
  }
  if (block.kind === "paragraphFragment") return <div className="preview-rich-content" role="document" onClick={() => onNodeSelect(node.id)} style={{ ...base, minHeight: "1em", marginLeft: `${document.paragraph.leftIndentCm}cm`, marginRight: `${document.paragraph.rightIndentCm}cm`, textIndent: block.frontMatter ? 0 : block.firstFragment ? `${getParagraphTextIndentCm(document.paragraph)}cm` : 0, fontSize: `${document.typography.bodyPt}pt`, fontWeight: document.typography.bodyBold ? 700 : 400, fontStyle: document.typography.bodyItalic ? "italic" : "normal", lineHeight: document.paragraph.lineSpacing, textAlign: document.paragraph.alignment ?? "justify", textAlignLast: document.paragraph.alignment === "justify" && !block.lastFragment ? "justify" : "auto", cursor: "text", "--dc-first-indent": block.frontMatter ? "0cm" : block.firstFragment ? `${getParagraphTextIndentCm(document.paragraph)}cm` : "0cm", "--dc-left-indent": `${document.paragraph.leftIndentCm}cm`, "--dc-right-indent": `${document.paragraph.rightIndentCm}cm`, "--dc-before-spacing": block.firstFragment ? `${document.paragraph.beforePt}pt` : "0pt", "--dc-after-spacing": block.lastFragment ? `${document.paragraph.afterPt}pt` : "0pt" }} dangerouslySetInnerHTML={{ __html: renderMathNotationHtml(sanitizeEditorHtml(renderCitationHtml(block.content, document.references ?? [], document.citationStyle, citationNumbers, citationYearSuffixes))) }} />;
  if (block.kind === "bibliographyEntry") return <div id={block.anchorId} style={{ ...base, margin: "0 0 12pt 1.27cm", textIndent: "-1.27cm", fontSize: `${document.typography.bodyPt}pt`, lineHeight: document.paragraph.lineSpacing }}>{block.parts.map((part, index) => {
    const text = part.italics ? <em>{part.text}</em> : part.text;
    return part.href ? <a key={index} href={part.href} target="_blank" rel="noreferrer">{text}</a> : <span key={index}>{text}</span>;
  })}</div>;
  if (block.kind === "tableOfContentsTitle") {
    return <h2 className="preview-toc-title" style={{ ...base, textAlign: "center", fontSize: `${document.typography.heading1Pt}pt`, margin: "14pt 0 8pt", lineHeight: document.paragraph.lineSpacing }}>{node.title || "DAFTAR ISI"}</h2>;
  }
  if (block.kind === "tableOfContentsEntry") {
    const { entry } = block;
    return <div className="preview-toc-entry" style={{ ...base, display: "flex", justifyContent: "space-between", gap: "12px", margin: "0 0 5pt", paddingLeft: entry.type === "section" ? "0.6cm" : entry.type === "subsection" ? "1.2cm" : 0, lineHeight: 1.25, fontSize: `${document.typography.bodyPt}pt` }}><span>{entry.text}</span><span>{headingPages[entry.id] ?? "…"}</span></div>;
  }
  if (block.kind === "tableOfContentsEmpty") return <p style={{ ...base, margin: 0, fontSize: `${document.typography.bodyPt}pt` }}>Tambahkan judul bab atau sub-bab untuk mengisi daftar isi.</p>;
  if (block.kind === "figureListTitle" || block.kind === "tableListTitle") return <h2 style={{ ...base, textAlign: "center", fontSize: `${document.typography.heading1Pt}pt`, margin: "14pt 0 8pt", lineHeight: document.paragraph.lineSpacing }}>{node.title || (block.kind === "figureListTitle" ? "DAFTAR GAMBAR" : "DAFTAR TABEL")}</h2>;
  if (block.kind === "figureListEntry" || block.kind === "tableListEntry") {
    const { entry } = block;
    const text = `${entry.label}${entry.caption ? ` ${entry.caption}` : ""}`;
    return <div style={{ ...base, display: "flex", justifyContent: "space-between", gap: "12px", margin: "0 0 5pt", fontSize: `${document.typography.bodyPt}pt`, lineHeight: 1.25 }}><span>{text}</span><span>{mediaPages[entry.id] ?? "…"}</span></div>;
  }
  if (block.kind === "figureListEmpty" || block.kind === "tableListEmpty") return <p style={{ ...base, margin: 0, fontSize: `${document.typography.bodyPt}pt` }}>Tambahkan {block.kind === "figureListEmpty" ? "gambar" : "tabel"} dengan caption untuk mengisi daftar ini.</p>;
  if (block.kind === "image") {
    const alignment = node.alignment ?? "center";
    const widthPct = Math.min(100, Math.max(20, Number(node.widthPct) || 80));
    return <figure className="preview-media"><div className="preview-image-box" style={{ justifyItems: alignment === "left" ? "start" : alignment === "right" ? "end" : "center" }}>{node.asset?.dataUrl ? <Image src={node.asset.dataUrl} alt={node.altText || node.caption || node.title || "Gambar"} width={1000} height={700} unoptimized style={{ width: `${widthPct}%`, maxWidth: "100%" }} /> : <span>Gambar belum diunggah</span>}</div><figcaption style={{ ...base, fontSize: `${document.typography.captionPt}pt` }}><strong>{labels[node.id]}</strong>{node.caption ? ` ${node.caption}` : ""}</figcaption></figure>;
  }
  const rows = node.tableData?.rows ?? [["", ""], ["", ""]];
  return <figure className="preview-media preview-media--table"><figcaption style={{ ...base, fontSize: `${document.typography.captionPt}pt` }}><strong>{labels[node.id]}</strong>{node.caption ? ` ${node.caption}` : ""}</figcaption><table className="preview-doc-table" style={{ fontSize: document.typography.bodyPt + "pt" }}><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, columnIndex) => { const Cell = node.tableData?.hasHeaderRow && rowIndex === 0 ? "th" : "td"; return <Cell key={columnIndex} contentEditable suppressContentEditableWarning onBlur={(event) => { const nextRows = rows.map((cells) => [...cells]); nextRows[rowIndex][columnIndex] = event.currentTarget.textContent; onNodeChange(node.id, { tableData: { ...node.tableData, rows: nextRows } }); }}>{cell}</Cell>; })}</tr>)}</tbody></table></figure>;
}

function Ruler({ length, scale, orientation, marginStart, marginEnd }) {
  const marks = Array.from({ length: Math.floor(length / PX_PER_CM) + 1 }, (_, index) => index);
  return <div className={`preview-ruler preview-ruler--${orientation}`} style={orientation === "top" ? { width: length * scale, height: 24 } : { height: length * scale, width: 24 }} aria-hidden="true">
    {marks.map((mark) => <span key={mark} className={`preview-ruler__mark ${mark % 5 === 0 ? "preview-ruler__mark--major" : ""}`} style={orientation === "top" ? { left: mark * PX_PER_CM * scale } : { top: mark * PX_PER_CM * scale }}>{mark % 5 === 0 ? <i>{mark}</i> : null}</span>)}
    <b className="preview-ruler__margin" style={orientation === "top" ? { left: marginStart * PX_PER_CM * scale } : { top: marginStart * PX_PER_CM * scale }} />
    <b className="preview-ruler__margin" style={orientation === "top" ? { left: (length - marginEnd) * PX_PER_CM * scale } : { top: (length - marginEnd) * PX_PER_CM * scale }} />
  </div>;
}

export default function LivePreviewCanvas() {
  const documentData = useDocumentStore((state) => state.document);
  const selectedNodeId = useDocumentStore((state) => state.selectedNodeId);
  const updateNode = useDocumentStore((state) => state.updateNode);
  const selectNode = useDocumentStore((state) => state.selectNode);
  const [fitScale, setFitScale] = useState(0.65);
  const [manualScale, setManualScale] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [statsOpen, setStatsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const panelRef = useRef(null);
  const viewportRef = useRef(null);
  const lastNavigatedNodeRef = useRef(null);
  const scale = manualScale ?? fitScale;
  const doc = documentData;
  const width = (doc?.paper.widthCm ?? 21) * PX_PER_CM;
  const height = (doc?.paper.heightCm ?? 29.7) * PX_PER_CM;
  const margins = doc?.margins ?? { topCm: 4, rightCm: 3, bottomCm: 3, leftCm: 4 };
  const contentWidth = Math.max(24, width - (margins.leftCm + margins.rightCm) * PX_PER_CM);
  const citationNumbers = useMemo(() => doc ? getCitationNumberMap(doc.sections) : {}, [doc]);
  const usedReferences = useMemo(() => doc ? getUsedReferences(doc.sections, doc.references, doc.citationStyle) : [], [doc]);
  const citationYearSuffixes = useMemo(() => getAuthorDateYearSuffixMap(usedReferences), [usedReferences]);
  const tocHeadings = useMemo(() => {
    if (!doc) return [];
    const headings = collectHeadings(doc.sections, getHeadingLabels(doc.sections));
    if (usedReferences.length) headings.push({ id: "generated-bibliography", type: "chapter", text: "DAFTAR PUSTAKA" });
    return headings;
  }, [doc, usedReferences]);
  const mediaEntries = useMemo(() => doc ? ({
    listOfFigures: getMediaEntries(doc.sections, "image"),
    listOfTables: getMediaEntries(doc.sections, "table"),
  }) : { listOfFigures: [], listOfTables: [] }, [doc]);
  const blocks = useMemo(() => {
    if (!doc) return [];
    const hangingNumbers = collectHangingNumbers(doc.sections);
    const generated = buildBlocks(doc.sections, { chapterIndex: 0 }, doc.typography, doc.paragraph, contentWidth, tocHeadings, mediaEntries, hangingNumbers, doc);
    if (!usedReferences.length) return generated;
    const titleNode = { id: "generated-bibliography", type: "chapter", title: "DAFTAR PUSTAKA" };
    generated.push({ node: titleNode, kind: "heading", level: 1, text: "DAFTAR PUSTAKA", height: doc.typography.heading1Pt * 2.2 + 22, startsChapter: true, generated: true, numbering: null });
    usedReferences.forEach((reference) => {
      const yearSuffix = citationYearSuffixes[reference.id] ?? "";
      const text = formatReferenceEntry(reference, doc.citationStyle, citationNumbers[reference.id], yearSuffix);
      const lines = estimateLineCount(text, contentWidth, doc.typography.fontFamily, doc.typography.bodyPt * 96 / 72);
      generated.push({ node: { id: `reference-${reference.id}`, type: "paragraph" }, kind: "bibliographyEntry", anchorId: getReferenceAnchorId(reference.id), text, parts: formatReferenceParts(reference, doc.citationStyle, citationNumbers[reference.id], yearSuffix), height: lines * doc.typography.bodyPt * doc.paragraph.lineSpacing * 96 / 72 + 16, numbering: null });
    });
    return generated;
  }, [doc, contentWidth, tocHeadings, mediaEntries, usedReferences, citationNumbers, citationYearSuffixes]);
  const visibleBlocks = useMemo(() => {
    if (!doc || tocHeadings.length) return blocks;
    return blocks.flatMap((block) => block.kind === "tableOfContentsTitle" ? [block, { ...block, node: { ...block.node, id: `${block.node.id}:empty` }, kind: "tableOfContentsEmpty", height: doc.typography.bodyPt * 1.45 + 4 }] : [block]);
  }, [blocks, doc, tocHeadings.length]);
  const availableHeight = height - (margins.topCm + margins.bottomCm) * PX_PER_CM;
  const pages = useMemo(() => doc ? paginate(visibleBlocks, availableHeight, doc.pageNumbering) : [], [visibleBlocks, availableHeight, doc]);
  const pageNumbers = useMemo(() => doc ? getPageNumbers(pages, doc.pageNumbering) : [], [pages, doc]);
  const headingPages = useMemo(() => {
    const result = {};
    pages.forEach((page, index) => page.blocks.forEach((block) => {
      if (block.kind === "heading") result[block.node.id] = pageNumber(pageNumbers[index]?.value ?? index + 1, pageNumbers[index]?.numbering?.style ?? "arabic");
    }));
    return result;
  }, [pages, pageNumbers]);
  const mediaPages = useMemo(() => {
    const result = {};
    pages.forEach((page, index) => page.blocks.forEach((block) => {
      if (block.kind === "image" || block.kind === "table") result[block.node.id] = pageNumber(pageNumbers[index]?.value ?? index + 1, pageNumbers[index]?.numbering?.style ?? "arabic");
    }));
    return result;
  }, [pages, pageNumbers]);
  const labels = useMemo(() => doc ? getMediaLabels(doc.sections) : {}, [doc]);
  const wordCount = useMemo(() => doc ? getDocumentWordCount(doc.sections) : 0, [doc]);
  const characterCount = useMemo(() => doc ? getDocumentCharacterCount(doc.sections) : 0, [doc]);
  const headingCount = useMemo(() => doc ? getDocumentHeadingCount(doc.sections) : 0, [doc]);
  const structureCounts = useMemo(() => doc ? getDocumentStructureCounts(doc.sections) : getDocumentStructureCounts([]), [doc]);
  const shownCurrentPage = Math.min(currentPage, Math.max(1, pages.length));

  const scrollToPreviewPage = useCallback((row, behavior = "smooth") => {
    const viewport = viewportRef.current;
    if (!viewport || !row) return;
    const rowTop = row.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    const target = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, viewport.scrollTop + rowTop - 14));
    viewport.scrollTo({ top: target, behavior });
  }, []);

  useEffect(() => {
    if (!viewportRef.current || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => setFitScale(Math.min(1, Math.max(0.25, (entry.contentRect.width - 64) / width))));
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, [width]);

  useEffect(() => {
    function syncFullscreenState() {
      setIsFullscreen(document.fullscreenElement === panelRef.current);
    }
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => {
    if (!selectedNodeId || !viewportRef.current) return;
    if (lastNavigatedNodeRef.current === selectedNodeId) return;
    let pageIndex = pages.findIndex((page) => page.blocks.some((block) => block.node.id === selectedNodeId));
    if (pageIndex < 0) {
      const selectedIndex = blocks.findIndex((block) => block.node.id === selectedNodeId);
      if (selectedIndex >= 0 && blocks[selectedIndex].kind === "pageBreak") {
        const nextContentBlock = blocks.slice(selectedIndex + 1).find((block) => block.kind !== "pageBreak");
        const previousContentBlock = [...blocks.slice(0, selectedIndex)].reverse().find((block) => block.kind !== "pageBreak");
        const anchor = nextContentBlock ?? previousContentBlock;
        if (anchor) pageIndex = pages.findIndex((page) => page.blocks.some((block) => block.node.id === anchor.node.id));
      }
    }
    if (pageIndex < 0) return;
    lastNavigatedNodeRef.current = selectedNodeId;
    setCurrentPage(pageIndex + 1);
    const row = viewportRef.current.querySelector(`[data-preview-page="${pageIndex}"]`);
    if (row) scrollToPreviewPage(row);
  }, [selectedNodeId, pages, blocks, scrollToPreviewPage]);

  function goToPage(pageNumber) {
    const pageIndex = Math.max(0, Math.min(pages.length - 1, pageNumber - 1));
    setCurrentPage(pageIndex + 1);
    const row = viewportRef.current?.querySelector(`[data-preview-page="${pageIndex}"]`);
    if (row) scrollToPreviewPage(row);
  }

  function adjustZoom(delta) {
    setManualScale((currentScale) => Math.min(1.5, Math.max(0.25, (currentScale ?? fitScale) + delta)));
  }

  function updatePageFromScroll(event) {
    const viewport = event.currentTarget;
    const rows = [...viewport.querySelectorAll("[data-preview-page]")];
    const viewportTop = viewport.getBoundingClientRect().top;
    let visiblePage = 1;
    for (const row of rows) {
      if (row.getBoundingClientRect().top <= viewportTop + 40) visiblePage = Number(row.dataset.previewPage) + 1;
      else break;
    }
    setCurrentPage(visiblePage);
  }

  async function toggleFullscreen() {
    if (!panelRef.current || !document.fullscreenEnabled) return;
    try {
      if (document.fullscreenElement === panelRef.current) await document.exitFullscreen();
      else await panelRef.current.requestFullscreen();
    } catch {
      // The browser may deny fullscreen when the document is embedded or permission is unavailable.
    }
  }

  if (!doc) return null;
  return <section ref={panelRef} className="editor-panel editor-preview-panel">
    <div className="panel-heading preview-panel-heading"><div className="preview-panel-heading__title"><AppWindow size={17} /> Live Preview Canvas <span className="preview-live-badge">LIVE</span></div><div className="preview-zoom-controls"><button type="button" onClick={() => adjustZoom(-0.1)} disabled={scale <= 0.25} aria-label="Perkecil pratinjau" title="Perkecil">−</button><span>{Math.round(scale * 100)}%</span><button type="button" onClick={() => adjustZoom(0.1)} disabled={scale >= 1.5} aria-label="Perbesar pratinjau" title="Perbesar">+</button><button type="button" onClick={() => setManualScale(null)} title="Sesuaikan dengan panel">Sesuaikan</button><button type="button" onClick={toggleFullscreen} title={isFullscreen ? "Keluar dari layar penuh" : "Pratinjau layar penuh"} aria-label={isFullscreen ? "Keluar dari layar penuh" : "Pratinjau layar penuh"}>{isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button></div></div>
    <div ref={viewportRef} className="preview-viewport" onScroll={updatePageFromScroll}>
      <div className="preview-stage" style={{ width: width * scale + 36, paddingTop: 28 }}>
        {pages.map((page, index) => {
          const { value: shownPage, numbering: pageStyle } = pageNumbers[index];
          const displayedPageNumber = pageNumber(shownPage, pageStyle?.style ?? "arabic");
          return <div className="preview-sheet-row" data-preview-page={index} data-preview-number={displayedPageNumber} key={`page-${index}`} style={{ height: height * scale, width: width * scale + 34, marginBottom: index === pages.length - 1 ? 0 : 24 }}>
            <Ruler length={height} scale={scale} orientation="left" marginStart={margins.topCm} marginEnd={margins.bottomCm} />
            <div className="preview-sheet-frame" style={{ width: width * scale, height: height * scale }}>
              <article className="preview-sheet" style={{ width, height, transform: `scale(${scale})`, fontFamily: `"${doc.typography.fontFamily}", serif` }}>
                <div className="preview-margin-guide" style={{ inset: `${margins.topCm}cm ${margins.rightCm}cm ${margins.bottomCm}cm ${margins.leftCm}cm` }} />
                <div className="preview-sheet-content" style={{ top: margins.topCm * PX_PER_CM, right: margins.rightCm * PX_PER_CM, bottom: margins.bottomCm * PX_PER_CM, left: margins.leftCm * PX_PER_CM }}>
                  {page.blocks.map((block, blockIndex) => <div key={`${block.node.id}-${blockIndex}`} data-preview-node-id={block.node.id} style={{ display: "contents" }}><Block block={block} document={doc} labels={labels} onNodeChange={updateNode} onNodeSelect={selectNode} headingPages={headingPages} mediaPages={mediaPages} citationNumbers={citationNumbers} citationYearSuffixes={citationYearSuffixes} /></div>)}
                </div>
                {pageStyle?.show !== false ? <div className="preview-page-number" style={{ right: margins.rightCm * PX_PER_CM, bottom: Math.max(20, margins.bottomCm * PX_PER_CM * 0.38), fontSize: `${doc.typography.captionPt}pt` }}>{pageNumber(shownPage, pageStyle?.style ?? "arabic")}</div> : null}
              </article>
            </div>
          </div>;
        })}
        <div className="preview-ruler-top-wrap" style={{ left: 34, top: 0 }}><Ruler length={width} scale={scale} orientation="top" marginStart={margins.leftCm} marginEnd={margins.rightCm} /></div>
      </div>
    </div>
    <div className="preview-footer"><button type="button" className="preview-stats-button" onClick={() => setStatsOpen(true)} title="Lihat statistik lengkap dokumen">{wordCount.toLocaleString("id-ID")} kata · {characterCount.toLocaleString("id-ID")} karakter · {headingCount} judul</button><span className="preview-footer__separator" aria-hidden="true">•</span><div className="preview-page-nav"><button type="button" onClick={() => goToPage(shownCurrentPage - 1)} disabled={shownCurrentPage <= 1} aria-label="Halaman sebelumnya">‹</button><label><span className="sr-only">Pilih halaman</span><select value={shownCurrentPage} onChange={(event) => goToPage(Number(event.target.value))} aria-label="Pilih halaman">{pages.map((_, index) => <option key={index} value={index + 1}>Halaman {index + 1} / {pages.length}</option>)}</select></label><button type="button" onClick={() => goToPage(shownCurrentPage + 1)} disabled={shownCurrentPage >= pages.length} aria-label="Halaman berikutnya">›</button></div><span className="preview-footer__separator" aria-hidden="true">•</span><span>{doc.paper.size} {doc.paper.widthCm} × {doc.paper.heightCm} cm</span></div>
    {statsOpen ? <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setStatsOpen(false); }}><section className="settings-dialog document-stats-dialog" role="dialog" aria-modal="true" aria-labelledby="document-stats-title"><div className="settings-dialog__header"><div><p className="eyebrow">Ringkasan</p><h2 id="document-stats-title">Statistik dokumen</h2></div><button type="button" className="icon-button icon-button--light" onClick={() => setStatsOpen(false)} aria-label="Tutup">×</button></div><dl className="document-stats-grid"><div><dt>Kata</dt><dd>{wordCount.toLocaleString("id-ID")}</dd></div><div><dt>Karakter, termasuk spasi</dt><dd>{characterCount.toLocaleString("id-ID")}</dd></div><div><dt>Bab</dt><dd>{structureCounts.chapters}</dd></div><div><dt>Sub-bab</dt><dd>{structureCounts.sections}</dd></div><div><dt>Anak sub-bab</dt><dd>{structureCounts.subsections}</dd></div><div><dt>Paragraf</dt><dd>{structureCounts.paragraphs}</dd></div><div><dt>Gambar</dt><dd>{structureCounts.images}</dd></div><div><dt>Tabel</dt><dd>{structureCounts.tables}</dd></div><div><dt>Pemisah halaman</dt><dd>{structureCounts.pageBreaks}</dd></div><div><dt>Perkiraan waktu baca</dt><dd>{wordCount ? `${Math.max(1, Math.ceil(wordCount / 200))} menit` : "—"}</dd></div></dl><div className="settings-dialog__actions"><button type="button" className="button button--primary" onClick={() => setStatsOpen(false)}>Tutup</button></div></section></div> : null}
  </section>;
}
