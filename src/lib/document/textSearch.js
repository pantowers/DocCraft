import { sanitizeEditorHtml } from "@/lib/document/sanitizeHtml";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeQueryRegExp(query, options = {}) {
  const escaped = escapeRegExp(query);
  const pattern = options.wholeWords ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped;
  return new RegExp(pattern, options.caseSensitive ? "gu" : "giu");
}

function countInText(value, query, options) {
  if (!value || !query) return 0;
  return [...String(value).matchAll(makeQueryRegExp(query, options))].length;
}

function htmlText(value) {
  if (typeof window === "undefined") return String(value ?? "");
  return new DOMParser().parseFromString(String(value ?? ""), "text/html").body.textContent ?? "";
}

function countNodeMatches(node, query, options) {
  let count = countInText(htmlText(node.content), query, options)
    + countInText(node.caption, query, options);
  for (const row of node.tableData?.rows ?? []) {
    for (const cell of row) count += countInText(cell, query, options);
  }
  count += countInText(node.title, query, options);
  for (const child of node.children ?? []) count += countNodeMatches(child, query, options);
  return count;
}

export function countDocumentMatches(document, query, options = {}) {
  const term = String(query ?? "").trim();
  if (!document || !term) return 0;
  return (document.sections ?? []).reduce((total, node) => total + countNodeMatches(node, term, options), 0);
}

function replacePlainText(value, query, replacement, options) {
  if (typeof value !== "string" || !query) return value;
  return value.replace(makeQueryRegExp(query, options), replacement);
}

function replaceHtmlText(value, query, replacement, options) {
  if (typeof window === "undefined" || !value || !query) return value;
  const parsed = new DOMParser().parseFromString(String(value), "text/html");
  const walker = parsed.createTreeWalker(parsed.body, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const textNode of textNodes) {
    textNode.textContent = replacePlainText(textNode.textContent, query, replacement, options);
  }
  return sanitizeEditorHtml(parsed.body.innerHTML);
}

function replaceNodeMatches(node, query, replacement, options) {
  return {
    ...node,
    title: replacePlainText(node.title, query, replacement, options),
    content: replaceHtmlText(node.content, query, replacement, options),
    ...(typeof node.caption === "string" ? { caption: replacePlainText(node.caption, query, replacement, options) } : {}),
    ...(node.tableData?.rows ? {
      tableData: {
        ...node.tableData,
        rows: node.tableData.rows.map((row) => row.map((cell) => replacePlainText(String(cell ?? ""), query, replacement, options))),
      },
    } : {}),
    ...(node.children ? { children: node.children.map((child) => replaceNodeMatches(child, query, replacement, options)) } : {}),
  };
}

export function replaceDocumentMatches(document, query, replacement, options = {}) {
  const term = String(query ?? "").trim();
  if (!document || !term) return { document, count: 0 };
  const count = countDocumentMatches(document, term, options);
  if (!count) return { document, count };
  return {
    count,
    document: {
      ...document,
      sections: document.sections.map((node) => replaceNodeMatches(node, term, String(replacement ?? ""), options)),
    },
  };
}
