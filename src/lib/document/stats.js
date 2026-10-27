function textFromHtml(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function countWords(value) {
  return textFromHtml(value).match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function getDocumentWordCount(nodes) {
  let total = 0;
  for (const node of nodes ?? []) {
    if (["chapter", "section", "subsection"].includes(node.type)) total += countWords(node.title);
    if (node.type === "paragraph") total += countWords(node.content);
    if (node.type === "abstract") total += countWords(node.title) + countWords(node.content) + countWords(node.keywords);
    if (node.type === "image" || node.type === "table") total += countWords(node.caption);
    if (node.type === "table") {
      for (const row of node.tableData?.rows ?? []) {
        for (const cell of row) total += countWords(cell);
      }
    }
    total += getDocumentWordCount(node.children);
  }
  return total;
}

function collectDocumentText(nodes) {
  const text = [];
  for (const node of nodes ?? []) {
    if (["chapter", "section", "subsection"].includes(node.type)) text.push(node.title ?? "");
    if (node.type === "paragraph") text.push(textFromHtml(node.content));
    if (node.type === "abstract") text.push(node.title ?? "", textFromHtml(node.content), node.keywords ?? "");
    if (node.type === "image" || node.type === "table") text.push(node.caption ?? "");
    if (node.type === "table") {
      for (const row of node.tableData?.rows ?? []) text.push(...row.map((cell) => String(cell ?? "")));
    }
    text.push(collectDocumentText(node.children));
  }
  return text.join(" ");
}

export function getDocumentCharacterCount(nodes) {
  return collectDocumentText(nodes).trim().length;
}

export function getDocumentHeadingCount(nodes) {
  let total = 0;
  for (const node of nodes ?? []) {
    if (["chapter", "section", "subsection"].includes(node.type)) total += 1;
    total += getDocumentHeadingCount(node.children);
  }
  return total;
}

export function getDocumentStructureCounts(nodes) {
  const counts = { chapters: 0, sections: 0, subsections: 0, paragraphs: 0, images: 0, tables: 0, pageBreaks: 0 };
  for (const node of nodes ?? []) {
    if (node.type === "chapter") counts.chapters += 1;
    if (node.type === "section") counts.sections += 1;
    if (node.type === "subsection") counts.subsections += 1;
    if (node.type === "paragraph") counts.paragraphs += 1;
    if (node.type === "image") counts.images += 1;
    if (node.type === "table") counts.tables += 1;
    if (node.type === "pageBreak") counts.pageBreaks += 1;
    const nested = getDocumentStructureCounts(node.children);
    for (const key of Object.keys(counts)) counts[key] += nested[key];
  }
  return counts;
}
