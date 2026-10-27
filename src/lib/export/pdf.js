import { getEditableHeadingTitle, getHeadingLabels, getMediaEntries, getMediaLabels } from "@/lib/document/numbering";
import { formatReferenceParts, getAuthorDateYearSuffixMap, getCitationNumberMap, getReferenceAnchorId, getUsedReferences, renderCitationHtml } from "@/lib/document/references";
import { sanitizeEditorHtml } from "@/lib/document/sanitizeHtml";
import { formatHangingMarker } from "@/lib/document/hanging";
import { getCodeTheme, highlightCodeHtml, resolveCodeLanguage } from "@/lib/document/codeHighlight";
import { getOutlineStyle, getOutlineTextFormat, getParagraphTextIndentCm } from "@/lib/document/paragraphFormat";
import { FRONT_MATTER_PROFILE_DEFAULTS, renderFrontMatterTemplateHtml } from "@/lib/document/frontMatterTemplates";
import { renderMathNotationHtml } from "@/lib/document/mathNotation";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function outlineFontCss(document, type) {
  const format = getOutlineTextFormat(document, type);
  return `font-family:"${escapeHtml(format.fontFamily)}",serif;font-size:${format.fontSizePt}pt;font-weight:${format.bold ? "bold" : "normal"};font-style:${format.italic ? "italic" : "normal"};`;
}

function roman(number) {
  const values = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let result = "";
  let remaining = number;
  values.forEach(([value, symbol]) => { while (remaining >= value) { result += symbol; remaining -= value; } });
  return result || "I";
}

function headingLabel(node, number) {
  const title = getEditableHeadingTitle(node);
  if (node.plainHeading) return title;
  if (node.type === "chapter") return /^(bab\s+|[ivxlcdm]+\s*[.:-])/i.test(title) ? title : `BAB ${roman(number)}${title ? ` ${title}` : ""}`;
  return new RegExp(`^${number.replaceAll(".", "\\.")}(?:\\s|$)`).test(title) ? title : `${number} ${title || "Sub-bab"}`;
}

function renderedContent(html, typography) {
  return sanitizeEditorHtml(renderMathNotationHtml(renderCitationHtml(html || "", typography.references ?? [], typography.citationStyle, typography.citationNumbers)));
}

function collectHeadings(nodes, labels, result = []) {
  for (const node of nodes ?? []) {
    if (["chapter", "section", "subsection"].includes(node.type)) result.push({ id: node.id, type: node.type, text: labels[node.id] ?? node.title });
    collectHeadings(node.children, labels, result);
  }
  return result;
}

function renderNodes(nodes, labels, typography, numbering = { chapter: 0, section: 0, subsection: 0, pageNumbering: null }, pageRules = [], tocHeadings = [], mediaEntries = {}, hangingCounters = {}, paragraph = {}) {
  let output = "";
  const paragraphAlignment = ["left", "center", "right"].includes(paragraph.alignment) ? paragraph.alignment : "justify";
  for (const node of nodes ?? []) {
    if (node.type === "titlePage") {
      const cover = { ...FRONT_MATTER_PROFILE_DEFAULTS, ...(typography.frontMatterProfile ?? {}), ...(node.coverData ?? {}) };
      const details = [cover.institution, cover.faculty, cover.department, cover.concentration].filter(Boolean);
      const lines = details.map((line, index) => `<p${index === 0 ? ' class="cover-institution"' : ""}>${escapeHtml(line)}</p>`).join("");
      output += `<section class="print-title-page"><div>${lines}</div><div class="cover-title">${escapeHtml(cover.workType || "TUGAS AKHIR")}<br><br>${escapeHtml(cover.thesisTitle || typography.documentTitle || "JUDUL KARYA TULIS")}</div>${cover.logoDataUrl ? `<img class="cover-logo" src="${escapeHtml(cover.logoDataUrl)}" alt="Logo kampus">` : `<div class="cover-logo-placeholder" aria-hidden="true"></div>`}${cover.author || cover.studentId ? `<p>NIM: ${escapeHtml(cover.studentId)}<br>Nama: ${escapeHtml(cover.author)}</p>` : ""}<div class="cover-year">${escapeHtml(cover.programLevel || "")}<br>${escapeHtml(cover.institution || "")}<br>${escapeHtml(cover.city || "")}<br>${escapeHtml(cover.year || String(new Date().getFullYear()))}</div></section>`;
    } else if (node.type === "abstract") {
      if (node.content?.trim() || node.keywords?.trim()) output += `<section class="print-abstract"><h1>${escapeHtml(node.title || "ABSTRAK")}</h1>${node.content?.trim() ? `<div class="body-paragraph">${renderedContent(node.content, typography)}</div>` : ""}${node.keywords?.trim() ? `<p class="abstract-keywords"><strong>Kata kunci: </strong>${escapeHtml(node.keywords)}</p>` : ""}</section>`;
    } else if (node.type === "frontMatter") {
      if (node.frontMatterTemplate) output += `<section class="print-front-matter">${renderFrontMatterTemplateHtml(node, typography.frontMatterProfile, typography.documentTitle)}</section>`;
      else {
        const content = renderedContent(node.content, typography);
        output += `<section class="print-front-matter"><h1>${escapeHtml(node.title || "HALAMAN AWAL")}</h1><div class="front-matter-content">${content.replace(/\n/g, "<br>")}</div></section>`;
      }
    } else if (node.type === "chapter") {
      numbering.chapter += 1;
      if (node.plainHeading || node.pageStart === false) {
        numbering.section = 0;
        numbering.subsection = 0;
        const style = getOutlineStyle(typography, "chapter");
        const headingCss = `${outlineFontCss(typography, "chapter")}text-align:${style.alignment};margin:${style.beforePt}pt ${style.rightIndentCm}cm ${style.afterPt}pt ${style.leftIndentCm}cm;text-indent:${getParagraphTextIndentCm(style)}cm;line-height:${style.lineSpacing};break-after:${style.keepWithNext ? "avoid" : "auto"};${style.keepLinesTogether ? "break-inside:avoid;" : ""}${style.widowControl ? "orphans:2;widows:2;" : "orphans:1;widows:1;"}${style.pageBreakBefore && (node.pageStart === false || node.plainHeading) ? "break-before:page;page-break-before:always;" : ""}`;
        output += `<h1 id="${escapeHtml(node.id)}" style="${headingCss}">${escapeHtml(headingLabel(node, numbering.chapter))}</h1>`;
        output += renderNodes(node.children, labels, typography, { ...numbering }, pageRules, tocHeadings, mediaEntries, hangingCounters, paragraph);
        continue;
      }
      const chapterPageNumbering = node.pageNumbering ?? numbering.pageNumbering;
      const pageName = `dcChapter${numbering.chapter}`;
      pageRules.push({ name: pageName, numbering: chapterPageNumbering });
      output += `<section class="chapter-print chapter--new-page" style="page:${pageName}">`;
      const chapterText = headingLabel(node, numbering.chapter);
      const chapterStyle = getOutlineStyle(typography, "chapter");
      const chapterCss = `${outlineFontCss(typography, "chapter")}text-align:${chapterStyle.alignment};margin:${chapterStyle.beforePt}pt ${chapterStyle.rightIndentCm}cm ${chapterStyle.afterPt}pt ${chapterStyle.leftIndentCm}cm;text-indent:${getParagraphTextIndentCm(chapterStyle)}cm;line-height:${chapterStyle.lineSpacing};break-after:${chapterStyle.keepWithNext ? "avoid" : "auto"};${chapterStyle.keepLinesTogether ? "break-inside:avoid;" : ""}${chapterStyle.widowControl ? "orphans:2;widows:2;" : "orphans:1;widows:1;"}${chapterStyle.pageBreakBefore && node.pageStart === false ? "break-before:page;page-break-before:always;" : ""}`;
      const chapterLines = chapterText.match(/^(BAB\s+[IVXLCDM]+)\s+([\s\S]+)$/i);
      output += `<h1 id="${escapeHtml(node.id)}" class="chapter" style="${chapterCss}">${chapterLines ? `${escapeHtml(chapterLines[1])}<br>${escapeHtml(chapterLines[2])}` : escapeHtml(chapterText)}</h1>`;
      const chapterChildren = [...(node.children ?? [])];
      while (chapterChildren[0]?.type === "pageBreak") chapterChildren.shift();
      output += renderNodes(chapterChildren, labels, typography, { chapter: numbering.chapter, section: 0, subsection: 0, pageNumbering: chapterPageNumbering }, pageRules, tocHeadings, mediaEntries, hangingCounters, paragraph);
      output += "</section>";
      continue;
    } else if (node.type === "section" || node.type === "subsection") {
      if (node.type === "section") { numbering.section += 1; numbering.subsection = 0; }
      else numbering.subsection += 1;
      const level = node.type === "section" ? 2 : 3;
      const num = node.type === "section" ? `${numbering.chapter || 1}.${numbering.section}` : `${numbering.chapter || 1}.${numbering.section || 1}.${numbering.subsection}`;
      const style = getOutlineStyle(typography, node.type);
      const headingCss = `${outlineFontCss(typography, node.type)}text-align:${style.alignment};margin:${style.beforePt}pt ${style.rightIndentCm}cm ${style.afterPt}pt ${style.leftIndentCm}cm;text-indent:${getParagraphTextIndentCm(style)}cm;line-height:${style.lineSpacing};break-after:${style.keepWithNext ? "avoid" : "auto"};${style.keepLinesTogether ? "break-inside:avoid;" : ""}${style.widowControl ? "orphans:2;widows:2;" : "orphans:1;widows:1;"}${style.pageBreakBefore ? "break-before:page;page-break-before:always;" : ""}`;
      output += `<h${level} id="${escapeHtml(node.id)}" style="${headingCss}">${escapeHtml(headingLabel(node, num))}</h${level}>`;
    } else if (node.type === "paragraph") {
      if (node.hangingItems?.length && node.hangingSettings) {
        if (node.content?.trim()) output += `<div class="body-paragraph">${renderedContent(node.content, typography)}</div>`;
        const list = node.hangingSettings;
        const indent = Math.min(3, Math.max(0.5, Number(list.indentCm) || 0.65));
        const hanging = Math.min(indent, Math.max(0.2, Number(list.hangingCm) || 0.6));
        const listFont = list.fontFamily || typography.fontFamily;
        const listFontSize = Math.max(6, Number(list.fontSizePt) || typography.bodyPt);
        const listAlignment = ["left", "center", "right", "justify"].includes(list.alignment) ? list.alignment : paragraphAlignment;
        const listLineSpacing = Number(list.lineSpacing) || paragraph.lineSpacing;
        const listBeforePt = Number.isFinite(Number(list.beforePt)) ? Number(list.beforePt) : paragraph.beforePt;
        const listAfterPt = Number.isFinite(Number(list.afterPt)) ? Number(list.afterPt) : paragraph.afterPt;
        node.hangingItems.forEach((item, index) => {
          const marker = formatHangingMarker(list.format, index + 1);
          const label = list.format === "bullet" ? marker : `${marker}.`;
          output += `<p class="hanging-item" style="margin:${index === 0 ? listBeforePt : 0}pt 0 ${index === node.hangingItems.length - 1 ? listAfterPt : 0}pt ${indent}cm;padding-left:${hanging}cm;text-indent:-${hanging}cm;text-align:${listAlignment};line-height:${listLineSpacing};font-family:&quot;${escapeHtml(listFont)}&quot;,serif;font-size:${listFontSize}pt">${escapeHtml(label)}&nbsp;${escapeHtml(item.text || "")}</p>`;
        });
      } else if (node.hangingList?.listId) {
        const list = node.hangingList;
        const count = (hangingCounters[list.listId] ?? 0) + 1;
        hangingCounters[list.listId] = count;
        const indent = Math.min(3, Math.max(0.5, Number(list.indentCm) || 0.65));
        const hanging = Math.min(indent, Math.max(0.2, Number(list.hangingCm) || 0.6));
        const marker = formatHangingMarker(list.format, count);
        const label = list.format === "bullet" ? marker : `${marker}.`;
        output += `<p class="hanging-item" style="margin:${paragraph.beforePt}pt 0 ${paragraph.afterPt}pt ${indent}cm;padding-left:${hanging}cm;text-indent:-${hanging}cm;text-align:${paragraphAlignment};line-height:${paragraph.lineSpacing}">${escapeHtml(label)}&nbsp;${escapeHtml(node.title || "")}</p>`;
      } else output += `<div class="body-paragraph">${renderedContent(node.content, typography)}</div>`;
    } else if (node.type === "codeBlock") {
      const fontSize = Math.min(14, Math.max(7, Number(node.codeFontSizePt) || 9));
      const codeLanguage = resolveCodeLanguage(node.codeLanguage, node.content);
      const theme = getCodeTheme(node.codeTheme);
      output += `<section class="print-code-block" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;margin:10pt 0 14pt;border-top:1px solid ${theme.border};border-right:1px solid ${theme.border};border-bottom:1px solid ${theme.border};border-left:3px solid #64748b;border-radius:3pt;overflow:hidden;break-inside:auto;background:${theme.background}"><div style="-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:4pt 8pt;border-bottom:1px solid ${theme.border};background:${theme.header};color:${theme.label};font:8pt Arial,sans-serif;text-transform:uppercase">${escapeHtml(codeLanguage)}</div><pre style="-webkit-print-color-adjust:exact;print-color-adjust:exact;margin:0;padding:8pt 10pt;background:${theme.background};color:${theme.foreground};font-family:Consolas,'Courier New',monospace;font-size:${fontSize}pt;line-height:1.3;white-space:pre-wrap;overflow-wrap:anywhere;tab-size:4">${highlightCodeHtml(node.content || " ", codeLanguage, node.codeTheme)}</pre></section>`;
    } else if (node.type === "image") {
      const label = `${labels[node.id] ?? "Gambar 1.1"}${node.caption ? ` ${node.caption}` : ""}`;
      const widthPct = Math.min(100, Math.max(20, Number(node.widthPct) || 80));
      const alignment = ["left", "right"].includes(node.alignment) ? node.alignment : "center";
      output += `<figure id="${escapeHtml(node.id)}" style="text-align:${alignment}"><div class="image-wrap">${node.asset?.dataUrl ? `<img src="${escapeHtml(node.asset.dataUrl)}" alt="${escapeHtml(node.altText || node.caption || node.title || "Gambar")}" style="width:${widthPct}%;margin:${alignment === "center" ? "0 auto" : alignment === "right" ? "0 0 0 auto" : "0 auto 0 0"}">` : ""}</div><figcaption><strong>${escapeHtml(labels[node.id] ?? "Gambar 1.1")}</strong>${node.caption ? ` ${escapeHtml(node.caption)}` : ""}</figcaption></figure>`;
    } else if (node.type === "table") {
      const rows = node.tableData?.rows ?? [["", ""], ["", ""]];
      const label = labels[node.id] ?? "Tabel 1.1";
      const hasHeaderRow = Boolean(node.tableData?.hasHeaderRow);
      const header = hasHeaderRow && rows.length ? `<thead><tr>${rows[0].map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead>` : "";
      const bodyRows = rows.slice(hasHeaderRow ? 1 : 0);
      output += `<figure id="${escapeHtml(node.id)}"><figcaption><strong>${escapeHtml(label)}</strong>${node.caption ? ` ${escapeHtml(node.caption)}` : ""}</figcaption><table>${header}<tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></figure>`;
    } else if (node.type === "tableOfContents") {
      output += `<section class="print-toc"><h1 class="chapter">${escapeHtml(node.title || "DAFTAR ISI")}</h1><ol>${tocHeadings.map((entry) => `<li class="toc-level-${entry.type === "chapter" ? 1 : entry.type === "section" ? 2 : 3}"><a href="#${escapeHtml(entry.id)}"><span class="toc-entry-text">${escapeHtml(entry.text)}</span><span class="toc-entry-leader" aria-hidden="true"></span><span class="toc-entry-page">${escapeHtml(entry.pageNumber || "—")}</span></a></li>`).join("")}</ol></section>`;
    } else if (node.type === "listOfFigures" || node.type === "listOfTables") {
      const isFigures = node.type === "listOfFigures";
      const title = node.title || (isFigures ? "DAFTAR GAMBAR" : "DAFTAR TABEL");
      const entries = mediaEntries[node.type] ?? [];
      if (entries.length) output += `<section class="print-media-list"><h1 class="chapter">${escapeHtml(title)}</h1><ol>${entries.map((entry) => `<li><a href="#${escapeHtml(entry.id)}"><span class="toc-entry-text">${escapeHtml(`${entry.label}${entry.caption ? ` ${entry.caption}` : ""}`)}</span><span class="toc-entry-leader" aria-hidden="true"></span><span class="toc-entry-page">${escapeHtml(previewPageMap[entry.id] || "—")}</span></a></li>`).join("")}</ol></section>`;
    } else if (node.type === "pageBreak") {
      output += '<div class="manual-page-break"></div>';
    }
    if (node.children?.length) output += renderNodes(node.children, labels, typography, numbering, pageRules, tocHeadings, mediaEntries, hangingCounters, paragraph);
  }
  return output;
}

function printHtml(documentData, previewPageMap = {}) {
  const labels = getMediaLabels(documentData.sections);
  const mediaEntries = { listOfFigures: getMediaEntries(documentData.sections, "image", labels), listOfTables: getMediaEntries(documentData.sections, "table", labels) };
  const citationNumbers = getCitationNumberMap(documentData.sections);
  const tocHeadings = collectHeadings(documentData.sections, getHeadingLabels(documentData.sections)).map((entry) => ({ ...entry, pageNumber: previewPageMap[entry.id] }));
  const usedReferences = getUsedReferences(documentData.sections, documentData.references, documentData.citationStyle);
  const citationYearSuffixes = getAuthorDateYearSuffixMap(usedReferences);
  if (usedReferences.length) tocHeadings.push({ id: "generated-bibliography", type: "chapter", text: "DAFTAR PUSTAKA" });
  const { widthCm, heightCm } = documentData.paper;
  const margin = documentData.margins;
  const type = { ...documentData.typography, outlineStyles: documentData.outlineStyles, frontMatterProfile: documentData.frontMatterProfile, documentTitle: documentData.title, references: usedReferences, citationStyle: documentData.citationStyle, citationNumbers };
  const paragraph = documentData.paragraph;
  const paragraphAlignment = ["left", "center", "right"].includes(paragraph.alignment) ? paragraph.alignment : "justify";
  const pageRules = [];
  const body = renderNodes(documentData.sections, labels, type, { chapter: 0, section: 0, subsection: 0, pageNumbering: documentData.pageNumbering }, pageRules, tocHeadings, mediaEntries, {}, paragraph);
  const bibliography = usedReferences.length ? `<section class="print-bibliography"><h1 id="generated-bibliography" class="chapter">DAFTAR PUSTAKA</h1>${usedReferences.map((reference) => `<p id="${escapeHtml(getReferenceAnchorId(reference.id))}">${formatReferenceParts(reference, documentData.citationStyle, citationNumbers[reference.id], citationYearSuffixes[reference.id] ?? "").map((part) => {
    const text = part.italics ? `<em>${escapeHtml(part.text)}</em>` : escapeHtml(part.text);
    return part.href ? `<a href="${escapeHtml(part.href)}">${text}</a>` : text;
  }).join("")}</p>`).join("")}</section>` : "";
  const pageStyle = documentData.pageNumbering?.style === "roman-lower" ? "lower-roman" : documentData.pageNumbering?.style === "roman-upper" ? "upper-roman" : "decimal";
  const pageCounter = Math.max(1, Math.floor(Number(documentData.pageNumbering?.startAt) || 1));
  const pageNumberContent = documentData.pageNumbering?.show === false ? "none" : `counter(page,${pageStyle})`;
  const fallbackPageNumberStyle = documentData.pageNumbering?.show === false ? "display:none" : `counter-reset:page ${pageCounter}`;
  const pageMargin = `${margin.topCm}cm ${margin.rightCm}cm ${margin.bottomCm}cm ${margin.leftCm}cm`;
  const namedPageRules = pageRules.map(({ name, numbering }) => {
    const style = numbering?.style === "roman-lower" ? "lower-roman" : numbering?.style === "roman-upper" ? "upper-roman" : "decimal";
    const content = numbering?.show === false ? "none" : `counter(page,${style})`;
    return `@page ${name}{size:${widthCm}cm ${heightCm}cm;margin:${pageMargin};@bottom-right{content:${content};font-family:"${escapeHtml(type.fontFamily)}",serif;font-size:${type.captionPt}pt}}`;
  }).join("\n");
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${escapeHtml(documentData.title || "Dokumen DocCraft")}</title><style>
@page{size:${widthCm}cm ${heightCm}cm;margin:${pageMargin};@bottom-right{content:${pageNumberContent};font-family:"${escapeHtml(type.fontFamily)}",serif;font-size:${type.captionPt}pt}}
@page :first{counter-reset:page ${pageCounter}}
${namedPageRules}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:"${escapeHtml(type.fontFamily)}",serif;font-size:${type.bodyPt}pt;font-weight:${type.bodyBold ? "bold" : "normal"};font-style:${type.bodyItalic ? "italic" : "normal"};color:#000;line-height:${paragraph.lineSpacing}}.print-code-block,.print-code-block *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
 .page-number{position:fixed;bottom:-${Math.max(1, margin.bottomCm * 0.7)}cm;right:0;font-size:${type.captionPt}pt;text-align:right}.page-number:after{content:counter(page,${pageStyle})}@supports(page:dcPageTest){.page-number{display:none}}.manual-page-break{break-before:page;page-break-before:always;height:0}
h1,h2,h3{font-family:inherit;break-after:avoid}h1{font-size:${type.heading1Pt}pt;font-weight:bold;text-align:center;margin:14pt 0 8pt}h2{font-size:${type.heading2Pt}pt;font-weight:bold;text-align:left;margin:12pt 0 7pt}h3{font-size:${type.heading3Pt}pt;font-weight:normal;font-style:italic;text-align:left;margin:11pt 0 6pt}.chapter--new-page{break-before:page}.chapter-print{page-break-inside:auto}
.body-paragraph{text-indent:${getParagraphTextIndentCm(paragraph)}cm;margin:${paragraph.beforePt}pt ${paragraph.rightIndentCm}cm ${paragraph.afterPt}pt ${paragraph.leftIndentCm}cm;text-align:${paragraphAlignment};line-height:${paragraph.lineSpacing};${paragraph.keepLinesTogether ? "break-inside:avoid;" : ""}${paragraph.keepWithNext ? "break-after:avoid;" : ""}${paragraph.pageBreakBefore ? "break-before:page;page-break-before:always;" : ""}${paragraph.widowControl === false ? "orphans:1;widows:1;" : "orphans:2;widows:2;"}}.body-paragraph>p,.body-paragraph>div,.body-paragraph>blockquote{margin:${paragraph.beforePt}pt ${paragraph.rightIndentCm}cm ${paragraph.afterPt}pt ${paragraph.leftIndentCm}cm;text-indent:${getParagraphTextIndentCm(paragraph)}cm;line-height:${paragraph.lineSpacing}}.body-paragraph ul,.body-paragraph ol{margin-block:0;padding-left:24pt;text-indent:0}.body-paragraph li:has(>ol:only-child),.body-paragraph li:has(>ul:only-child){list-style:none}.body-paragraph li:has(>ol:only-child)>ol,.body-paragraph li:has(>ul:only-child)>ul{margin-left:-1.25em;padding-left:1.25em}
.print-title-page{height:${Math.max(10, heightCm - margin.topCm - margin.bottomCm)}cm;min-height:0;display:flex;flex-direction:column;justify-content:space-between;align-items:center;text-align:center;break-after:page;page-break-after:always;padding:0}.print-title-page p{margin:3pt 0}.print-title-page .cover-institution{font-weight:bold}.print-title-page .cover-title{font-weight:bold;font-size:${type.heading1Pt}pt;margin:1cm auto}.print-abstract{break-before:page;break-after:page;page-break-before:always;page-break-after:always}.print-abstract h1{text-align:center}.print-abstract .body-paragraph{text-indent:0}.print-abstract .body-paragraph>p,.print-abstract .body-paragraph>div,.print-abstract .body-paragraph>blockquote{text-indent:0}.print-front-matter{break-before:page;break-after:page;page-break-before:always;page-break-after:always;min-height:20cm}.print-front-matter h1{text-align:center}.front-matter-content{white-space:pre-wrap;text-indent:${paragraph.firstLineIndentCm}cm;font-size:${type.bodyPt}pt;line-height:${paragraph.lineSpacing};text-align:${paragraphAlignment}}.abstract-keywords{margin-top:12pt}figure{margin:12pt auto;text-align:center;break-inside:avoid}.print-toc{break-after:page}.print-toc ol{list-style:none;padding:0}.print-toc li,.print-media-list li{margin:0 0 5pt;line-height:1.25}.print-toc li a,.print-media-list li a{display:flex;align-items:baseline;gap:5pt;color:inherit;text-decoration:none}.toc-entry-text{flex:0 1 auto}.toc-entry-leader{flex:1;min-width:12pt;border-bottom:1px dotted #475569}.toc-entry-page{min-width:1.2em;text-align:right}.print-toc .toc-level-2{padding-left:.6cm}.print-toc .toc-level-3{padding-left:1.2cm}.print-media-list{break-after:page}.print-media-list ol{list-style:none;padding:0}.print-bibliography{break-before:page}.print-bibliography p{margin:0 0 12pt 1.27cm;text-indent:-1.27cm;line-height:${paragraph.lineSpacing};orphans:2;widows:2}figure img{display:block;width:auto;max-width:100%;max-height:17cm;margin:0 auto;object-fit:contain}figcaption{font-size:${type.captionPt}pt;text-align:center;margin:4pt 0 7pt}table{width:100%;border-collapse:collapse;font-size:${type.bodyPt}pt}td,th{border:0.5pt solid #475569;padding:4pt 6pt;text-align:left}th{font-weight:bold;background:#e2e8f0}
.cover-logo{display:block;width:auto;max-width:4cm;height:auto;max-height:4cm;margin:0 auto}.cover-logo-placeholder{box-sizing:border-box;width:4cm;height:4cm;margin:1cm auto;border:1px dashed #cbd5e1}.dc-inline-math{white-space:normal;font-style:normal}.front-matter-template{min-height:20cm;break-inside:avoid;font-size:${type.bodyPt}pt;line-height:${paragraph.lineSpacing}}.fm-title{text-align:center;font-size:${type.heading1Pt}pt;margin:0 0 18pt;font-weight:bold}.fm-center{text-align:center;margin:5pt 0;text-indent:0}.fm-institution{margin:0 0 5pt}.fm-lead{margin-top:12pt}.fm-info{width:78%;margin:8pt auto 16pt}.fm-info p{display:grid;grid-template-columns:5.3cm 1fr;margin:0 0 4pt;text-indent:0}.fm-sublead{margin-top:12pt}.fm-date{text-align:right;margin:14pt 0 8pt}.fm-signers{display:grid;grid-template-columns:1fr 1fr;gap:22pt;text-align:center;margin:12pt auto 18pt}.fm-signers--1{grid-template-columns:1fr}.fm-signers p{margin:0;text-indent:0}.fm-signature-space{height:1.35cm}.fm-preface-body{line-height:${paragraph.lineSpacing};text-align:${paragraphAlignment};text-indent:${getParagraphTextIndentCm(paragraph)}cm}.fm-preface-body p{margin:${paragraph.beforePt}pt 0 ${paragraph.afterPt}pt;text-indent:${getParagraphTextIndentCm(paragraph)}cm}
@media screen{body{width:${widthCm}cm;margin:16mm auto;padding:10mm;background:white;box-shadow:0 3px 18px #94a3b8}.chapter--new-page{margin-top:0}}
</style></head><body><main>${body}${bibliography}<div class="page-number" style="${fallbackPageNumberStyle}"></div></main><script>window.addEventListener('load',async()=>{try{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})))}catch{}setTimeout(()=>{window.focus();window.print()},250)});</script></body></html>`;
}

export async function exportDocumentToPdf(documentData) {
  if (typeof window === "undefined") throw new Error("Ekspor PDF harus dijalankan di browser.");
  const printWindow = window.open("", "_blank");
  if (!printWindow) throw new Error("Jendela cetak diblokir browser. Izinkan pop-up untuk localhost, lalu coba lagi.");
  printWindow.document.open();
  const previewPageMap = {};
  document.querySelectorAll("[data-preview-node-id]").forEach((anchor) => {
    const nodeId = anchor.getAttribute("data-preview-node-id");
    const page = anchor.closest("[data-preview-page]");
    if (nodeId && page && previewPageMap[nodeId] == null) previewPageMap[nodeId] = page.getAttribute("data-preview-number");
  });
  printWindow.document.write(printHtml(documentData, previewPageMap));
  printWindow.document.close();
}
