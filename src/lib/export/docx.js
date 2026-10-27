import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  FrameAnchorType,
  FrameWrap,
  HeadingLevel,
  HorizontalPositionAlign,
  ImageRun,
  InternalHyperlink,
  LineRuleType,
  NumberFormat,
  PageBreak,
  Packer,
  Paragraph,
  ShadingType,
  SimpleField,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
  VerticalPositionAlign,
} from "docx";
import JSZip from "jszip";
import { getHeadingLabel, getMediaEntries, getMediaLabels } from "@/lib/document/numbering";
import { formatInTextCitation, formatReferenceParts, getAuthorDateYearSuffixMap, getCitationNumberMap, getUsedReferences, renderCitationHtml } from "@/lib/document/references";
import { sanitizeEditorHtml } from "@/lib/document/sanitizeHtml";
import { formatHangingMarker } from "@/lib/document/hanging";
import { codeTokenColor, getCodeTheme, resolveCodeLanguage, tokenizeCodeLine } from "@/lib/document/codeHighlight";
import { getOutlineStyle, getOutlineTextFormat } from "@/lib/document/paragraphFormat";
import { FRONT_MATTER_PROFILE_DEFAULTS, getFrontMatterModel, renderFrontMatterModelHtml } from "@/lib/document/frontMatterTemplates";
import { renderMathNotationHtml } from "@/lib/document/mathNotation";

const TWIPS_PER_CM = 1440 / 2.54;

function cmToTwips(value) { return Math.round((Number(value) || 0) * TWIPS_PER_CM); }
function ptToTwips(value) { return Math.round((Number(value) || 0) * 20); }

function paragraphLayout(style = {}, defaults = {}) {
  const indent = {
    left: cmToTwips(style.leftIndentCm),
    right: cmToTwips(style.rightIndentCm),
  };
  const special = Number(style.specialIndentCm ?? style.firstLineIndentCm) || 0;
  if (style.specialIndentType === "hanging" && special > 0) indent.hanging = cmToTwips(special);
  else if (style.specialIndentType !== "none" && special > 0) indent.firstLine = cmToTwips(special);
  return {
    alignment: ({ left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED })[style.alignment] ?? defaults.alignment ?? AlignmentType.JUSTIFIED,
    indent,
    spacing: {
      before: ptToTwips(style.beforePt),
      after: ptToTwips(style.afterPt),
      line: Math.round(240 * (Number(style.lineSpacing) || 1)),
      lineRule: LineRuleType.AUTO,
    },
    keepNext: Boolean(style.keepWithNext ?? defaults.keepNext),
    keepLines: Boolean(style.keepLinesTogether),
    widowControl: Boolean(style.widowControl ?? defaults.widowControl ?? true),
    pageBreakBefore: Boolean(style.pageBreakBefore),
  };
}

function sanitizeXmlText(value) {
  return [...String(value ?? "")].filter((character) => {
    const code = character.codePointAt(0);
    return code === 0x09 || code === 0x0a || code === 0x0d
      || (code >= 0x20 && code <= 0xd7ff)
      || (code >= 0xe000 && code <= 0xfffd)
      || (code >= 0x10000 && code <= 0x10ffff);
  }).join("");
}

function sanitizeDocumentXmlValues(value) {
  if (typeof value === "string") return sanitizeXmlText(value);
  if (Array.isArray(value)) return value.map(sanitizeDocumentXmlValues);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeDocumentXmlValues(entry)]));
}

async function validateDocxArchive(blob) {
  const archive = await JSZip.loadAsync(blob);
  const requiredParts = ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels"];
  const missingParts = requiredParts.filter((part) => !archive.file(part));
  if (missingParts.length) throw new Error(`Paket Word tidak lengkap: ${missingParts.join(", ")}.`);
  for (const name of Object.keys(archive.files).filter((entry) => !archive.files[entry].dir && /\.xml$|\.rels$/i.test(entry))) {
    const xml = await archive.file(name).async("string");
    const parsed = new DOMParser().parseFromString(xml, "application/xml");
    if (parsed.querySelector("parsererror")) throw new Error(`Bagian XML Word tidak valid: ${name}.`);
    if (name.startsWith("word/") && /\.xml$/i.test(name)) {
      const paragraphs = parsed.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "p");
      for (const paragraph of paragraphs) {
        if ([...paragraph.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim())) {
          throw new Error(`Struktur paragraf pada ${name} tidak valid untuk Word.`);
        }
      }
    }
  }
}

function mediaCaption(node, labels) {
  const label = labels[node.id] ?? (node.type === "image" ? "Gambar 1.1" : "Tabel 1.1");
  return `${label}${node.caption ? ` ${node.caption}` : ""}`;
}

function headingLabel(node, number) {
  return getHeadingLabel(node, number);
}

function runOptions(format, typography) {
  return {
    font: format.fontFamily || typography.fontFamily,
    size: Math.round((Number(format.fontSizePt) || typography.bodyPt) * 2),
    language: { value: "id-ID" },
    bold: Boolean(format.bold),
    italics: Boolean(format.italics),
    underline: format.underline ? {} : undefined,
    strike: Boolean(format.strike),
    superScript: Boolean(format.superScript),
    subScript: Boolean(format.subScript),
    color: "000000",
  };
}

function inlineRuns(node, format, typography, references = new Map()) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ? [new TextRun({ text: node.nodeValue, ...runOptions(format, typography) })] : [];
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const tag = node.tagName.toLowerCase();
  if (tag === "span" && node.hasAttribute("data-reference-id")) {
    const reference = references.get(node.getAttribute("data-reference-id"));
    const inCitationGroup = Boolean(node.parentElement?.closest("[data-citation-group]"));
    const citationText = reference
      ? inCitationGroup ? node.textContent ?? "" : formatInTextCitation(reference, reference.citationStyle, reference.citationNumber, { mode: node.getAttribute("data-citation-mode"), locator: node.getAttribute("data-citation-locator"), yearSuffix: reference.yearSuffix })
      : node.textContent ?? "";
    const run = new TextRun({ text: citationText, ...runOptions(format, typography) });
    return reference?.bookmarkName ? [new InternalHyperlink({ anchor: reference.bookmarkName, children: [run] })] : [run];
  }
  if (tag === "a") {
    const href = node.getAttribute("href") ?? "";
    if (/^(https?:\/\/|mailto:)/i.test(href)) {
      return [new ExternalHyperlink({ link: href, children: [...node.childNodes].flatMap((child) => inlineRuns(child, { ...format, underline: true }, typography, references)) })];
    }
  }
  const next = {
    bold: format.bold || ["b", "strong"].includes(tag),
    italics: format.italics || ["i", "em"].includes(tag),
    fontFamily: node.tagName === "SPAN" ? node.style.fontFamily.replace(/[\"']/g, "").trim() || format.fontFamily : format.fontFamily,
    fontSizePt: node.tagName === "SPAN" ? Number.parseFloat(node.style.fontSize) || format.fontSizePt : format.fontSizePt,
    underline: format.underline || tag === "u" || tag === "a",
    strike: format.strike || tag === "s" || tag === "del",
    superScript: format.superScript || tag === "sup",
    subScript: format.subScript || tag === "sub",
  };
  if (tag === "br") return [new TextRun({ text: "", break: 1, ...runOptions(next, typography) })];
  return [...node.childNodes].flatMap((child) => inlineRuns(child, next, typography, references));
}

function contentParagraphs(html, documentData, options = {}, citationNumbers = {}, referenceBookmarkNames = {}, yearSuffixes = {}) {
  const sanitized = renderMathNotationHtml(renderCitationHtml(sanitizeEditorHtml(html ?? ""), documentData.references ?? [], documentData.citationStyle, citationNumbers, yearSuffixes));
  const parsed = new DOMParser().parseFromString(sanitized, "text/html");
  const typography = documentData.typography;
  const references = new Map((documentData.references ?? []).map((reference) => [reference.id, { ...reference, citationStyle: documentData.citationStyle, citationNumber: citationNumbers[reference.id] ?? 1, yearSuffix: yearSuffixes[reference.id] ?? "", bookmarkName: referenceBookmarkNames[reference.id] }]));
  const paragraphStyle = documentData.paragraph;
  const paragraphAlignment = ({ left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT })[paragraphStyle.alignment] ?? AlignmentType.JUSTIFIED;
  const common = {
    ...paragraphLayout(paragraphStyle, { alignment: paragraphAlignment }),
    alignment: options.alignment ?? paragraphAlignment,
    widowControl: Boolean(paragraphStyle.widowControl ?? true),
    indent: options.noIndent ? undefined : paragraphLayout(paragraphStyle).indent,
    spacing: paragraphLayout(paragraphStyle).spacing,
    keepNext: options.noIndent ? false : Boolean(paragraphStyle.keepWithNext),
    keepLines: options.noIndent ? false : Boolean(paragraphStyle.keepLinesTogether),
    pageBreakBefore: options.noIndent ? false : Boolean(paragraphStyle.pageBreakBefore),
  };
  const blocks = [];
  let inline = [];
  const flushInline = () => {
    if (!inline.length) return;
    blocks.push(new Paragraph({ ...common, children: inline }));
    inline = [];
  };

  function consume(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.nodeValue?.trim()) return;
      inline.push(...inlineRuns(node, { bold: Boolean(typography.bodyBold), italics: Boolean(typography.bodyItalic) }, typography, references));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();
    if (tag === "div" && [...node.children].some((child) => ["p", "h2", "div"].includes(child.tagName.toLowerCase()))) {
      [...node.childNodes].forEach(consume);
      return;
    }
    if (["p", "div", "blockquote", "h2"].includes(tag)) {
      flushInline();
      const runs = [...node.childNodes].flatMap((child) => inlineRuns(child, { bold: Boolean(typography.bodyBold), italics: Boolean(typography.bodyItalic) }, typography, references));
      const alignment = ({ left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED })[node.getAttribute("align")]
        ?? (tag === "h2" ? AlignmentType.CENTER : options.alignment ?? paragraphAlignment);
      blocks.push(new Paragraph({ ...common, alignment, indent: options.noIndent || tag === "h2" ? undefined : tag === "blockquote" ? { left: cmToTwips(1) } : common.indent, keepNext: tag === "h2" || common.keepNext, children: runs.length ? runs : [new TextRun({ text: "", ...runOptions({}, typography) })] }));
      return;
    }
    if (tag === "ul" || tag === "ol") {
      flushInline();
      const alphaMarker = (value, listType) => {
          let remaining = value;
          let label = "";
          while (remaining > 0) {
            remaining -= 1;
            label = String.fromCharCode(97 + (remaining % 26)) + label;
            remaining = Math.floor(remaining / 26);
          }
          return listType === "A" ? label.toUpperCase() : label;
      };
      const appendList = (list, depth = 0) => {
        const listTag = list.tagName.toLowerCase();
        const listType = list.getAttribute("type");
        const start = Math.max(1, Number(list.getAttribute("start")) || 1);
        let listIndex = 0;
        [...list.children].filter((child) => child.tagName.toLowerCase() === "li").forEach((item) => {
          const nestedLists = [...item.children].filter((child) => ["ol", "ul"].includes(child.tagName.toLowerCase()));
          const inlineChildren = [...item.childNodes].filter((child) => !(child.nodeType === Node.ELEMENT_NODE && ["ol", "ul"].includes(child.tagName.toLowerCase())));
          const itemText = inlineChildren.map((child) => child.textContent ?? "").join("").trim();
          if (itemText) {
            listIndex += 1;
            const markerValue = start + listIndex - 1;
            const marker = listTag === "ul" ? "• " : `${listType === "a" || listType === "A" ? alphaMarker(markerValue, listType) : markerValue}. `;
            const baseIndent = Number(list.getAttribute("data-dc-indent-cm")) || 0.65;
            const hanging = Math.min(baseIndent, Number(list.getAttribute("data-dc-hanging-cm")) || 0.6);
            const leftIndent = baseIndent + depth * 0.65;
            blocks.push(new Paragraph({ ...common, indent: { left: cmToTwips(leftIndent), hanging: cmToTwips(hanging) }, children: [new TextRun({ text: marker, ...runOptions({}, typography) }), ...inlineChildren.flatMap((child) => inlineRuns(child, {}, typography, references))] }));
          }
          nestedLists.forEach((nested) => appendList(nested, depth + (itemText ? 1 : 0)));
        });
      };
      appendList(node);
      return;
    }
    inline.push(...inlineRuns(node, {}, typography, references));
  }

  [...parsed.body.childNodes].forEach(consume);
  flushInline();
  return blocks.length ? blocks : [new Paragraph({ ...common, children: [new TextRun({ text: "", ...runOptions({}, typography) })] })];
}

async function imageAsPng(dataUrl, maxWidth) {
  const image = new window.Image();
  image.src = dataUrl;
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("Gambar tidak dapat dibuka untuk ekspor.")); });
  const ratio = Math.min(1, maxWidth / image.naturalWidth, 700 / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const canvas = window.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas gambar tidak dapat dibuat.");
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Gambar gagal disiapkan untuk Word.");
  return { data: new Uint8Array(await blob.arrayBuffer()), width, height };
}

function pageNumberFormat(style) {
  if (style === "roman-lower") return NumberFormat.LOWER_ROMAN;
  if (style === "roman-upper") return NumberFormat.UPPER_ROMAN;
  return NumberFormat.DECIMAL;
}

function createSection(children, documentData, chapter) {
  const numbering = chapter?.pageNumbering ?? documentData.pageNumbering;
  const format = numbering.style ?? "arabic";
  const page = documentData.paper;
  const margins = documentData.margins;
  const showPageNumber = numbering.show !== false;
  const properties = {
    page: {
      size: { width: cmToTwips(page.widthCm), height: cmToTwips(page.heightCm) },
      margin: {
        top: cmToTwips(margins.topCm), right: cmToTwips(margins.rightCm),
        bottom: cmToTwips(margins.bottomCm), left: cmToTwips(margins.leftCm),
      },
      pageNumbers: {
        formatType: pageNumberFormat(format),
        ...(numbering.restart ? { start: numbering.startAt ?? 1 } : {}),
      },
    },
  };
  return {
    properties,
    children,
    ...(showPageNumber ? { footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new SimpleField("PAGE", "1")] })] }) } } : {}),
  };
}

function imageType(mimeType) {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/bmp") return "bmp";
  return "png";
}

function tableElement(node, typography) {
  const rows = node.tableData?.rows?.length ? node.tableData.rows : [["", ""], ["", ""]];
  const hasHeaderRow = Boolean(node.tableData?.hasHeaderRow);
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const border = { style: BorderStyle.SINGLE, size: 4, color: "64748B" };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: Array.from({ length: columnCount }, () => Math.floor(9000 / columnCount)),
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: rows.map((row, rowIndex) => {
      const isHeader = hasHeaderRow && rowIndex === 0;
      return new TableRow({
        cantSplit: true,
        tableHeader: isHeader,
        children: Array.from({ length: columnCount }, (_, index) => new TableCell({
          ...(isHeader ? { shading: { fill: "E2E8F0", type: ShadingType.CLEAR } } : {}),
          children: [new Paragraph({ children: [new TextRun({ text: String(row[index] ?? ""), font: typography.fontFamily, size: typography.bodyPt * 2, bold: isHeader })] })],
        })),
      });
    }),
  });
}

function filename(title) {
  return `${String(title || "Dokumen DocCraft").replace(/[<>:"/\\|?*]+/g, "-").trim().slice(0, 100) || "Dokumen DocCraft"}.docx`;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = "none";
  window.document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function exportDocumentToDocx(documentData) {
  if (typeof window === "undefined") throw new Error("Ekspor Word harus dijalankan di browser.");
  documentData = sanitizeDocumentXmlValues(documentData);
  const labels = getMediaLabels(documentData.sections);
  const citationNumbers = getCitationNumberMap(documentData.sections);
  const usedReferences = getUsedReferences(documentData.sections, documentData.references, documentData.citationStyle);
  const yearSuffixes = getAuthorDateYearSuffixMap(usedReferences);
  const referenceBookmarkNames = Object.fromEntries(usedReferences.map((reference, index) => [reference.id, `doccraft_ref_${index + 1}`]));
  const mediaEntries = { listOfFigures: getMediaEntries(documentData.sections, "image", labels), listOfTables: getMediaEntries(documentData.sections, "table", labels) };
  const mediaBookmarkNames = Object.fromEntries([...mediaEntries.listOfFigures, ...mediaEntries.listOfTables].map((entry, index) => [entry.id, `doccraft_media_${index + 1}`]));
  const maxImageWidth = Math.max(100, cmToTwips(documentData.paper.widthCm - documentData.margins.leftCm - documentData.margins.rightCm) / TWIPS_PER_CM * 96 / 2.54);
  const chunks = [];
  let current = { chapter: null, children: [] };
  let chapterNumber = 0;
  let sectionNumber = 0;
  let subsectionNumber = 0;
  const hangingCounters = {};

  async function appendNode(node) {
    if (node.type === "titlePage") {
      if (current.children.length) current.children.push(new Paragraph({ children: [new PageBreak()] }));
      const cover = { ...FRONT_MATTER_PROFILE_DEFAULTS, ...(documentData.frontMatterProfile ?? {}), ...(node.coverData ?? {}) };
      const coverLines = [cover.institution, cover.faculty, cover.department, cover.concentration].filter(Boolean);
      coverLines.forEach((line, index) => current.children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: line, font: documentData.typography.fontFamily, size: documentData.typography.bodyPt * 2, bold: index === 0 })] })));
      current.children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 900, after: 300 }, keepNext: true, children: [new TextRun({ text: cover.workType || "TUGAS AKHIR", font: documentData.typography.fontFamily, size: documentData.typography.heading1Pt * 2, bold: true })] }));
      current.children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 900 }, keepNext: true, children: [new TextRun({ text: cover.thesisTitle || documentData.title || "JUDUL KARYA TULIS", font: documentData.typography.fontFamily, size: documentData.typography.heading1Pt * 2, bold: true })] }));
      if (cover.logoDataUrl) {
        const logoWidth = Math.min(maxImageWidth, Math.round((documentData.paper.widthCm - documentData.margins.leftCm - documentData.margins.rightCm) * 96 / 2.54 * 4 / 13));
        const logo = await imageAsPng(cover.logoDataUrl, logoWidth);
        current.children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new ImageRun({ type: "png", data: logo.data, transformation: { width: logo.width, height: logo.height }, altText: { title: "Logo kampus", description: cover.institution || "Logo institusi" } })] }));
      } else current.children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: 240 }, children: [new TextRun({ text: "TEMPAT LOGO KAMPUS", font: documentData.typography.fontFamily, size: documentData.typography.bodyPt * 2, color: "64748B" })] }));
      if (cover.author || cover.studentId) current.children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1800 }, children: [new TextRun({ text: `NIM: ${cover.studentId}`, font: documentData.typography.fontFamily, size: documentData.typography.bodyPt * 2 }), new TextRun({ text: `Nama: ${cover.author}`, font: documentData.typography.fontFamily, size: documentData.typography.bodyPt * 2, break: 1 })] }));
      const bottomCoverLines = [cover.programLevel, cover.institution, cover.city, cover.year].filter(Boolean);
      current.children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 900 }, children: bottomCoverLines.map((line, index) => new TextRun({ text: line, font: documentData.typography.fontFamily, size: documentData.typography.bodyPt * 2, break: index ? 1 : undefined })) }));
    } else if (node.type === "abstract") {
      if (node.content?.trim() || node.keywords?.trim()) {
        if (current.children.length) current.children.push(new Paragraph({ children: [new PageBreak()] }));
        current.children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 280 }, keepNext: true, children: [new TextRun({ text: node.title || "ABSTRAK", font: documentData.typography.fontFamily, size: documentData.typography.heading1Pt * 2, bold: true })] }));
        if (node.content?.trim()) current.children.push(...contentParagraphs(node.content, documentData, { noIndent: true }, citationNumbers, referenceBookmarkNames, yearSuffixes));
        if (node.keywords?.trim()) current.children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { before: 160 }, children: [new TextRun({ text: "Kata kunci: ", font: documentData.typography.fontFamily, size: documentData.typography.bodyPt * 2, bold: true }), new TextRun({ text: node.keywords, font: documentData.typography.fontFamily, size: documentData.typography.bodyPt * 2 })] }));
        if (documentData.documentKind === "jurnal") current.children.push(new Paragraph({ children: [new PageBreak()] }));
      }
    } else if (node.type === "frontMatter") {
      if (current.children.length) current.children.push(new Paragraph({ children: [new PageBreak()] }));
      if (node.frontMatterTemplate) {
        const model = getFrontMatterModel(node, documentData.frontMatterProfile, documentData.title);
        if (node.frontMatterTemplate === "preface") {
          current.children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 360 }, keepNext: true, children: [new TextRun({ text: model.title, font: documentData.typography.fontFamily, size: documentData.typography.heading1Pt * 2, bold: true })] }));
          current.children.push(...contentParagraphs(model.body, documentData, { noIndent: true }, citationNumbers, referenceBookmarkNames, yearSuffixes));
          current.children.push(new Paragraph({
            alignment: AlignmentType.RIGHT,
            frame: {
              type: "alignment",
              alignment: { x: HorizontalPositionAlign.RIGHT, y: VerticalPositionAlign.BOTTOM },
              anchor: { horizontal: FrameAnchorType.MARGIN, vertical: FrameAnchorType.MARGIN },
              width: cmToTwips(8), height: cmToTwips(5.5), wrap: FrameWrap.NONE,
            },
            children: [
              new TextRun({ text: `${model.signature.city}, ${model.signature.date}`, font: documentData.typography.fontFamily, size: documentData.typography.bodyPt * 2 }),
              new TextRun({ text: "Penulis,", font: documentData.typography.fontFamily, size: documentData.typography.bodyPt * 2, break: 1 }),
              new TextRun({ text: model.signature.name, font: documentData.typography.fontFamily, size: documentData.typography.bodyPt * 2, bold: true, underline: {}, break: 3 }),
            ],
          }));
        } else current.children.push(...contentParagraphs(renderFrontMatterModelHtml(model), documentData, { noIndent: true }, citationNumbers, referenceBookmarkNames, yearSuffixes));
      } else {
        current.children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 360 }, keepNext: true, children: [new TextRun({ text: node.title || "HALAMAN AWAL", font: documentData.typography.fontFamily, size: documentData.typography.heading1Pt * 2, bold: true })] }));
        if (node.content) current.children.push(...contentParagraphs(node.content.replace(/\n/g, "<br>"), documentData, { noIndent: true }, citationNumbers, referenceBookmarkNames, yearSuffixes));
      }
    } else if (node.type === "chapter") {
      chapterNumber += 1;
      sectionNumber = 0;
      subsectionNumber = 0;
      const text = headingLabel(node, chapterNumber);
      if (node.plainHeading || node.pageStart === false) {
        const headingStyle = getOutlineStyle(documentData, "chapter");
        const textFormat = getOutlineTextFormat(documentData, "chapter");
        current.children.push(new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text, font: textFormat.fontFamily, size: textFormat.fontSizePt * 2, bold: textFormat.bold, italics: textFormat.italic })],
          ...paragraphLayout(headingStyle, { keepNext: true }),
        }));
      } else {
        if (current.children.length) chunks.push(current);
        current = { chapter: node, children: [] };
      const textFormat = getOutlineTextFormat(documentData, "chapter");
      const chapterLines = text.match(/^(BAB\s+[IVXLCDM]+)\s+([\s\S]+)$/i);
      const chapterHeadingRuns = chapterLines
        ? [
          new TextRun({ text: chapterLines[1], font: textFormat.fontFamily, size: textFormat.fontSizePt * 2, bold: textFormat.bold, italics: textFormat.italic }),
          new TextRun({ text: chapterLines[2], font: textFormat.fontFamily, size: textFormat.fontSizePt * 2, bold: textFormat.bold, italics: textFormat.italic, break: 1 }),
        ]
        : [new TextRun({ text, font: textFormat.fontFamily, size: textFormat.fontSizePt * 2, bold: textFormat.bold, italics: textFormat.italic })];
      current.children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: chapterHeadingRuns,
        ...paragraphLayout({ ...getOutlineStyle(documentData, "chapter"), pageBreakBefore: node.pageStart === false ? getOutlineStyle(documentData, "chapter").pageBreakBefore : false }, { keepNext: true }),
      }));
      }
    } else if (node.type === "section" || node.type === "subsection") {
      if (node.type === "section") { sectionNumber += 1; subsectionNumber = 0; }
      else subsectionNumber += 1;
      const number = node.type === "section" ? `${chapterNumber || 1}.${sectionNumber}` : `${chapterNumber || 1}.${sectionNumber || 1}.${subsectionNumber}`;
      const level = node.type === "section" ? 2 : 3;
      const title = headingLabel(node, number);
      const headingStyle = getOutlineStyle(documentData, node.type);
      const textFormat = getOutlineTextFormat(documentData, node.type);
      current.children.push(new Paragraph({
        heading: level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        children: [new TextRun({ text: title, font: textFormat.fontFamily, size: textFormat.fontSizePt * 2, bold: textFormat.bold, italics: textFormat.italic })],
        ...paragraphLayout(headingStyle, { keepNext: true }),
      }));
    } else if (node.type === "paragraph") {
      if (node.hangingItems?.length && node.hangingSettings) {
        if (node.content?.trim()) current.children.push(...contentParagraphs(node.content, documentData, {}, citationNumbers, referenceBookmarkNames, yearSuffixes));
        const list = node.hangingSettings;
        const indent = Math.min(3, Math.max(0.5, Number(list.indentCm) || 0.65));
        const hanging = Math.min(indent, Math.max(0.2, Number(list.hangingCm) || 0.6));
        const listFont = list.fontFamily || documentData.typography.fontFamily;
        const listFontSize = Math.max(6, Number(list.fontSizePt) || documentData.typography.bodyPt);
        const listAlignment = ({ left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED })[list.alignment] ?? AlignmentType.JUSTIFIED;
        const listLineSpacing = Number(list.lineSpacing) || documentData.paragraph.lineSpacing;
        const listBeforePt = Number.isFinite(Number(list.beforePt)) ? Number(list.beforePt) : documentData.paragraph.beforePt;
        const listAfterPt = Number.isFinite(Number(list.afterPt)) ? Number(list.afterPt) : documentData.paragraph.afterPt;
        node.hangingItems.forEach((item, index) => {
          const marker = formatHangingMarker(list.format, index + 1);
          current.children.push(new Paragraph({
            alignment: listAlignment,
            widowControl: true,
            indent: { left: cmToTwips(indent), hanging: cmToTwips(hanging) },
            spacing: { before: index === 0 ? ptToTwips(listBeforePt) : 0, after: index === node.hangingItems.length - 1 ? ptToTwips(listAfterPt) : 0, line: Math.round(240 * listLineSpacing), lineRule: LineRuleType.AUTO },
            children: [new TextRun({ text: list.format === "bullet" ? `${marker}  ` : `${marker}.  `, font: listFont, size: listFontSize * 2 }), new TextRun({ text: item.text || "", font: listFont, size: listFontSize * 2 })],
          }));
        });
      } else if (node.hangingList?.listId) {
        const list = node.hangingList;
        const count = (hangingCounters[list.listId] ?? 0) + 1;
        hangingCounters[list.listId] = count;
        const indent = Math.min(3, Math.max(0.5, Number(list.indentCm) || 0.65));
        const hanging = Math.min(indent, Math.max(0.2, Number(list.hangingCm) || 0.6));
        const marker = formatHangingMarker(list.format, count);
        current.children.push(new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          widowControl: true,
          indent: { left: cmToTwips(indent), hanging: cmToTwips(hanging) },
          spacing: { before: ptToTwips(documentData.paragraph.beforePt), after: ptToTwips(documentData.paragraph.afterPt), line: Math.round(240 * documentData.paragraph.lineSpacing), lineRule: LineRuleType.AUTO },
          children: [new TextRun({ text: list.format === "bullet" ? `${marker}  ` : `${marker}.  `, font: documentData.typography.fontFamily, size: documentData.typography.bodyPt * 2 }), new TextRun({ text: node.title || "", font: documentData.typography.fontFamily, size: documentData.typography.bodyPt * 2 })],
        }));
      } else current.children.push(...contentParagraphs(node.content, documentData, {}, citationNumbers, referenceBookmarkNames, yearSuffixes));
    } else if (node.type === "codeBlock") {
      const codeFontSize = Math.min(14, Math.max(7, Number(node.codeFontSizePt) || 9));
      const codeLanguage = resolveCodeLanguage(node.codeLanguage, node.content);
      const codeTheme = getCodeTheme(node.codeTheme);
      current.children.push(new Paragraph({
        keepNext: true,
        spacing: { before: 160, after: 0, line: 240, lineRule: LineRuleType.AUTO },
        shading: { fill: codeTheme.header.slice(1).toUpperCase(), type: ShadingType.CLEAR },
        indent: { left: 120, right: 120 },
        children: [new TextRun({ text: codeLanguage.toUpperCase(), font: "Arial", size: 16, color: codeTheme.label.slice(1).toUpperCase(), noProof: true })],
      }));
      const codeLines = String(node.content ?? "").split("\n");
      codeLines.forEach((line, index) => {
        let lineStart = true;
        const codeRuns = tokenizeCodeLine(line, codeLanguage).map(({ text, kind }) => {
          const expanded = text.replace(/\t/g, "\u00A0\u00A0\u00A0\u00A0");
          const preserved = lineStart ? expanded.replace(/^ +/, (spaces) => "\u00A0".repeat(spaces.length)) : expanded;
          if (preserved.trim()) lineStart = false;
          return new TextRun({ text: preserved, font: "Consolas", size: codeFontSize * 2, color: codeTokenColor(kind, node.codeTheme).slice(1).toUpperCase(), noProof: true });
        });
        current.children.push(new Paragraph({
          keepLines: true,
          spacing: { before: index === 0 ? 80 : 0, after: 0, line: Math.round(240 * 1.3), lineRule: LineRuleType.AUTO },
          shading: { fill: codeTheme.background.slice(1).toUpperCase(), type: ShadingType.CLEAR },
          indent: { left: 120, right: 120 },
          children: codeRuns.length ? codeRuns : [new TextRun({ text: " ", font: "Consolas", size: codeFontSize * 2 })],
        }));
      });
      current.children.push(new Paragraph({ text: "", spacing: { after: 100 } }));
    } else if (node.type === "image") {
      if (node.asset?.dataUrl) {
        const widthPct = Math.min(100, Math.max(20, Number(node.widthPct) || 80));
        const image = await imageAsPng(node.asset.dataUrl, maxImageWidth * widthPct / 100);
        const alignment = node.alignment === "left" ? AlignmentType.LEFT : node.alignment === "right" ? AlignmentType.RIGHT : AlignmentType.CENTER;
        current.children.push(new Paragraph({ alignment, spacing: { before: 120, after: 40 }, keepNext: true, children: [new ImageRun({ type: "png", data: image.data, transformation: { width: image.width, height: image.height }, altText: { title: node.title || "Gambar", description: node.altText || node.caption || "Gambar dokumen" } })] }));
      }
      current.children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 180 }, children: [new Bookmark({ id: mediaBookmarkNames[node.id], children: [new TextRun({ text: mediaCaption(node, labels), font: documentData.typography.fontFamily, size: documentData.typography.captionPt * 2 })] })] }));
    } else if (node.type === "table") {
      current.children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 160, after: 80 }, keepNext: true, children: [new Bookmark({ id: mediaBookmarkNames[node.id], children: [new TextRun({ text: mediaCaption(node, labels), font: documentData.typography.fontFamily, size: documentData.typography.captionPt * 2 })] })] }));
      current.children.push(tableElement(node, documentData.typography));
      current.children.push(new Paragraph({ text: "", spacing: { after: 120 } }));
    } else if (node.type === "pageBreak") {
      const onlyChapterHeading = current.chapter && current.children.length === 1;
      if (!onlyChapterHeading) current.children.push(new Paragraph({ children: [new PageBreak()] }));
    } else if (node.type === "tableOfContents") {
      if (current.children.length) current.children.push(new Paragraph({ children: [new PageBreak()] }));
      current.children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 320 }, keepNext: true, children: [new TextRun({ text: node.title || "DAFTAR ISI", font: documentData.typography.fontFamily, size: documentData.typography.heading1Pt * 2, bold: true })] }));
      current.children.push(new TableOfContents("Daftar Isi", { headingStyleRange: "1-3", hyperlink: true }));
    } else if (node.type === "listOfFigures" || node.type === "listOfTables") {
      const isFigures = node.type === "listOfFigures";
      const title = node.title || (isFigures ? "DAFTAR GAMBAR" : "DAFTAR TABEL");
      const entries = mediaEntries[node.type] ?? [];
      if (entries.length) {
        if (current.children.length) current.children.push(new Paragraph({ children: [new PageBreak()] }));
        current.children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { before: 240, after: 320 }, keepNext: true, children: [new TextRun({ text: title, font: documentData.typography.fontFamily, size: documentData.typography.heading1Pt * 2, bold: true })] }));
        entries.forEach((entry) => current.children.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 100 }, children: [new TextRun({ text: `${entry.label}${entry.caption ? ` ${entry.caption}` : ""}`, font: documentData.typography.fontFamily, size: documentData.typography.bodyPt * 2 }), new TextRun({ text: "    " }), new SimpleField(`PAGEREF ${mediaBookmarkNames[entry.id]} \\h`, "…")] })));
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) await appendNode(child);
    }
  }

  for (const node of documentData.sections) await appendNode(node);
  if (usedReferences.length) {
    current.children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { before: 360, after: 300 }, children: [new TextRun({ text: "DAFTAR PUSTAKA", font: documentData.typography.fontFamily, size: documentData.typography.heading1Pt * 2, bold: true })] }));
    usedReferences.forEach((reference) => {
      const referenceRuns = formatReferenceParts(reference, documentData.citationStyle, citationNumbers[reference.id], yearSuffixes[reference.id] ?? "").map((part) => {
      const run = new TextRun({ text: part.text, font: documentData.typography.fontFamily, size: documentData.typography.bodyPt * 2, italics: part.italics, color: part.href ? "0563C1" : "000000", underline: part.href ? {} : undefined });
      return part.href ? new ExternalHyperlink({ link: part.href, children: [run] }) : run;
      });
      current.children.push(new Paragraph({ alignment: AlignmentType.LEFT, widowControl: true, indent: { left: cmToTwips(1.27), hanging: cmToTwips(1.27) }, spacing: { after: ptToTwips(12), line: Math.round(240 * documentData.paragraph.lineSpacing), lineRule: LineRuleType.AUTO }, children: [new Bookmark({ id: referenceBookmarkNames[reference.id], children: referenceRuns })] }));
    });
  }
  if (current.children.length) chunks.push(current);
  if (!chunks.length) chunks.push({ chapter: null, children: [new Paragraph({ text: "" })] });

  const sections = chunks.map((chunk) => createSection(chunk.children, documentData, chunk.chapter));
  const file = new Document({
    title: documentData.title || "Dokumen DocCraft",
    creator: "DocCraft",
    features: { updateFields: true },
    styles: { default: { document: { run: { font: documentData.typography.fontFamily, size: documentData.typography.bodyPt * 2, bold: Boolean(documentData.typography.bodyBold), italics: Boolean(documentData.typography.bodyItalic), language: { value: "id-ID" } } } } },
    sections,
  });
  const blob = await Packer.toBlob(file);
  await validateDocxArchive(blob);
  downloadBlob(blob, filename(documentData.title));
}
