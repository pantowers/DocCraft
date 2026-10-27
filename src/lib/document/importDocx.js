import JSZip from "jszip";
import { createDocumentNode, createEmptyDocument, PAPER_PRESETS } from "./schema";

const TWIPS_PER_CM = 1440 / 2.54;

function localName(node) { return node?.localName ?? node?.nodeName?.split(":").pop(); }
function children(node, name) { return Array.from(node?.children ?? []).filter((child) => localName(child) === name); }
function firstChild(node, name) { return children(node, name)[0] ?? null; }
function descendants(node, name) { return Array.from(node?.getElementsByTagName("*") ?? []).filter((child) => localName(child) === name); }
function attribute(node, name) { return Array.from(node?.attributes ?? []).find((item) => item.localName === name)?.value ?? ""; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }

function parseXml(source, label) {
  const parsed = new DOMParser().parseFromString(source, "application/xml");
  if (parsed.querySelector("parsererror")) throw new Error(`Bagian ${label} pada dokumen Word tidak dapat dibaca.`);
  return parsed;
}

function runHtml(run) {
  const properties = firstChild(run, "rPr");
  let text = "";
  for (const child of Array.from(run.children ?? [])) {
    const name = localName(child);
    if (name === "t" || name === "delText") text += escapeHtml(child.textContent ?? "");
    else if (name === "br" || name === "cr") text += "<br>";
    else if (name === "tab") text += "&emsp;";
  }
  if (!text) return "";
  const enabled = (name) => {
    const property = firstChild(properties, name);
    return Boolean(property) && !["0", "false", "off", "none"].includes(attribute(property, "val").toLowerCase());
  };
  if (enabled("b") || enabled("bCs")) text = `<strong>${text}</strong>`;
  if (enabled("i") || enabled("iCs")) text = `<em>${text}</em>`;
  if (enabled("u")) text = `<u>${text}</u>`;
  if (enabled("strike") || enabled("dstrike")) text = `<s>${text}</s>`;
  const vertical = attribute(firstChild(properties, "vertAlign"), "val");
  if (vertical === "superscript") text = `<sup>${text}</sup>`;
  if (vertical === "subscript") text = `<sub>${text}</sub>`;
  return text;
}

function paragraphHtml(paragraph, relationships) {
  const content = [];
  const walk = (node) => {
    for (const child of Array.from(node.children ?? [])) {
      const name = localName(child);
      if (name === "r") content.push(runHtml(child));
      else if (name === "hyperlink") {
        const href = relationships.get(attribute(child, "id"))?.target ?? "";
        const start = content.length;
        walk(child);
        const label = content.splice(start).join("");
        content.push(/^(https?:\/\/|mailto:)/i.test(href) ? `<a href="${escapeHtml(href)}">${label}</a>` : label);
      } else if (name === "sdt" || name === "sdtContent") walk(child);
    }
  };
  walk(paragraph);
  return content.join("");
}

function headingLevel(paragraph, styles) {
  const properties = firstChild(paragraph, "pPr");
  const outlineNode = firstChild(properties, "outlineLvl");
  const outline = outlineNode ? Number(attribute(outlineNode, "val")) : -1;
  if (Number.isInteger(outline) && outline >= 0 && outline <= 2) return outline + 1;
  const styleId = attribute(firstChild(properties, "pStyle"), "val").toLowerCase().replace(/[\s_-]/g, "");
  const styleName = (styles.get(styleId) ?? "").toLowerCase().replace(/[\s_-]/g, "");
  const match = `${styleId} ${styleName}`.match(/(?:heading|judul|tajuk)([1-3])/i);
  return match ? Number(match[1]) : 0;
}

function makeNumberingMap(xml) {
  const result = new Map();
  if (!xml) return result;
  const parsed = parseXml(xml, "penomoran");
  const levels = new Map();
  descendants(parsed, "abstractNum").forEach((abstract) => {
    const id = attribute(abstract, "abstractNumId");
    levels.set(id, new Map(descendants(abstract, "lvl").map((level) => [attribute(level, "ilvl"), attribute(firstChild(level, "numFmt"), "val")])));
  });
  descendants(parsed, "num").forEach((number) => {
    const id = attribute(number, "numId");
    const abstractId = attribute(firstChild(number, "abstractNumId"), "val");
    result.set(id, levels.get(abstractId) ?? new Map());
  });
  return result;
}

function listMarker(paragraph, formats, counters) {
  const numProperties = firstChild(firstChild(paragraph, "pPr"), "numPr");
  if (!numProperties) return "";
  const numId = attribute(firstChild(numProperties, "numId"), "val");
  const level = attribute(firstChild(numProperties, "ilvl"), "val") || "0";
  const format = formats.get(numId)?.get(level) ?? "decimal";
  if (format === "bullet") return "• ";
  const key = `${numId}:${level}`;
  const count = (counters.get(key) ?? 0) + 1;
  counters.set(key, count);
  for (const existing of counters.keys()) if (existing.startsWith(`${numId}:`) && existing !== key && Number(existing.split(":")[1]) > Number(level)) counters.delete(existing);
  if (format === "lowerLetter") return `${String.fromCharCode(96 + ((count - 1) % 26) + 1)}. `;
  if (format === "upperLetter") return `${String.fromCharCode(64 + ((count - 1) % 26) + 1)}. `;
  return `${count}. `;
}

function dataTarget(target) {
  const parts = [];
  for (const segment of String(target).replace(/^\//, "").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/").startsWith("word/") ? parts.join("/") : `word/${parts.join("/")}`;
}

function imageMimeType(path) {
  const ext = path.split(".").pop().toLowerCase();
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml" })[ext] ?? "image/png";
}

function addAtCurrentLevel(document, stack, node) {
  const parent = stack.at(-1);
  if (parent) parent.children.push(node);
  else document.sections.push(node);
}

function appendHeading(document, stack, level, title) {
  const type = level === 1 ? "chapter" : level === 2 ? "section" : "subsection";
  const node = createDocumentNode(type, { title: title.trim(), children: [] });
  if (level === 1) {
    document.sections.push(node);
    stack.splice(0, stack.length, node);
  } else if (level === 2) {
    if (!stack.length) {
      const chapter = createDocumentNode("chapter", { title: document.title, children: [] });
      document.sections.push(chapter);
      stack.push(chapter);
    }
    stack.splice(1);
    stack[0].children.push(node);
    stack.push(node);
  } else {
    if (!stack.length) {
      const chapter = createDocumentNode("chapter", { title: document.title, children: [] });
      document.sections.push(chapter);
      stack.push(chapter);
    }
    if (stack.length < 2) {
      const section = createDocumentNode("section", { title: "Bagian", children: [] });
      stack[0].children.push(section);
      stack.push(section);
    }
    stack.splice(2);
    stack[1].children.push(node);
    stack.push(node);
  }
}

function applyPageSetup(document, body) {
  const sectionProperties = descendants(body, "sectPr").at(-1);
  const size = firstChild(sectionProperties, "pgSz");
  const margins = firstChild(sectionProperties, "pgMar");
  const widthCm = Number(attribute(size, "w")) / TWIPS_PER_CM;
  const heightCm = Number(attribute(size, "h")) / TWIPS_PER_CM;
  if (widthCm >= 10 && widthCm <= 60 && heightCm >= 10 && heightCm <= 80) {
    const preset = Object.entries(PAPER_PRESETS).find(([, paper]) => Math.abs(paper.widthCm - widthCm) < 0.15 && Math.abs(paper.heightCm - heightCm) < 0.15);
    document.paper = preset ? { size: preset[0], ...preset[1] } : { size: "Custom", widthCm: Number(widthCm.toFixed(2)), heightCm: Number(heightCm.toFixed(2)) };
  }
  for (const side of ["top", "right", "bottom", "left"]) {
    const value = Number(attribute(margins, side)) / TWIPS_PER_CM;
    const key = `${side}Cm`;
    if (Number.isFinite(value) && value >= 0 && value <= 15) document.margins[key] = Number(value.toFixed(2));
  }
}

function enabled(properties, name) {
  const element = firstChild(properties, name);
  if (!element) return undefined;
  return !["0", "false", "off", "none"].includes(attribute(element, "val").toLowerCase());
}

function numericAttribute(element, name) {
  const raw = attribute(element, name);
  if (raw === "" || raw == null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function headingStyleFromXml(style, document) {
  const paragraph = firstChild(style, "pPr");
  const run = firstChild(style, "rPr");
  const result = {};
  const font = firstChild(run, "rFonts");
  const fontName = attribute(font, "ascii") || attribute(font, "hAnsi") || attribute(font, "cs");
  if (fontName && fontName.length <= 80) result.fontFamily = fontName;
  const size = numericAttribute(firstChild(run, "sz"), "val");
  if (size !== undefined && size / 2 >= 6 && size / 2 <= 36) result.fontSizePt = size / 2;
  const bold = enabled(run, "b");
  const italic = enabled(run, "i");
  if (bold !== undefined) result.bold = bold;
  if (italic !== undefined) result.italic = italic;

  const alignment = attribute(firstChild(paragraph, "jc"), "val");
  if (["left", "center", "right", "both"].includes(alignment)) result.alignment = alignment === "both" ? "justify" : alignment;
  const indent = firstChild(paragraph, "ind");
  for (const side of ["left", "right"]) {
    const twips = numericAttribute(indent, side);
    if (twips !== undefined && twips >= 0 && twips <= 7200) result[`${side}IndentCm`] = Number((twips / TWIPS_PER_CM).toFixed(2));
  }
  const hanging = numericAttribute(indent, "hanging");
  const firstLine = numericAttribute(indent, "firstLine");
  if (Number.isFinite(hanging) && hanging > 0 && hanging <= 3600) {
    result.specialIndentType = "hanging";
    result.specialIndentCm = Number((hanging / TWIPS_PER_CM).toFixed(2));
  } else if (Number.isFinite(firstLine) && firstLine > 0 && firstLine <= 3600) {
    result.specialIndentType = "firstLine";
    result.specialIndentCm = Number((firstLine / TWIPS_PER_CM).toFixed(2));
  }
  const spacing = firstChild(paragraph, "spacing");
  const before = numericAttribute(spacing, "before");
  const after = numericAttribute(spacing, "after");
  if (before !== undefined && before >= 0 && before <= 2400) result.beforePt = before / 20;
  if (after !== undefined && after >= 0 && after <= 2400) result.afterPt = after / 20;
  const line = numericAttribute(spacing, "line");
  const lineRule = attribute(spacing, "lineRule");
  if (line > 0 && (lineRule === "auto" || !lineRule)) result.lineSpacing = Number(Math.max(0.5, Math.min(3, line / 240)).toFixed(2));
  else if (line > 0 && lineRule === "exact") result.lineSpacing = Number(Math.max(0.5, Math.min(3, (line / 20) / (Number(document.typography.bodyPt) || 12))).toFixed(2));
  for (const [property, field] of [["widowControl", "widowControl"], ["keepLines", "keepLinesTogether"], ["keepNext", "keepWithNext"], ["pageBreakBefore", "pageBreakBefore"]]) {
    const value = enabled(paragraph, property);
    if (value !== undefined) result[field] = value;
  }
  return result;
}

function extractHeadingStyles(stylesXml, document) {
  const result = {};
  const paragraphStyles = new Map();
  for (const style of descendants(stylesXml, "style")) {
    if (attribute(style, "type") !== "paragraph") continue;
    const styleId = attribute(style, "styleId");
    if (styleId) paragraphStyles.set(styleId, style);
  }
  const resolved = new Map();
  function resolveStyle(styleId, seen = new Set()) {
    if (!styleId || seen.has(styleId)) return {};
    if (resolved.has(styleId)) return resolved.get(styleId);
    const style = paragraphStyles.get(styleId);
    if (!style) return {};
    const nextSeen = new Set(seen);
    nextSeen.add(styleId);
    const parentId = attribute(firstChild(style, "basedOn"), "val");
    const value = { ...resolveStyle(parentId, nextSeen), ...headingStyleFromXml(style, document) };
    resolved.set(styleId, value);
    return value;
  }
  for (const style of paragraphStyles.values()) {
    const styleId = attribute(style, "styleId").toLowerCase().replace(/[\s_-]/g, "");
    const styleName = attribute(firstChild(style, "name"), "val").toLowerCase().replace(/[\s_-]/g, "");
    const match = `${styleId} ${styleName}`.match(/(?:heading|judul|tajuk)([1-3])/);
    if (!match) continue;
    const type = ({ 1: "chapter", 2: "section", 3: "subsection" })[match[1]];
    result[type] = { ...(result[type] ?? {}), ...resolveStyle(attribute(style, "styleId")) };
  }
  return result;
}

/** Read page, font, and paragraph defaults from a Word document for preset review. */
export async function formatPresetFromDocxFile(file) {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") throw new Error("Impor Word harus dijalankan di browser.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Ukuran dokumen Word maksimal 25 MB.");
  const zip = await JSZip.loadAsync(file);
  const inflatedSize = Object.values(zip.files).reduce((total, entry) => total + (entry.dir ? 0 : Number(entry._data?.uncompressedSize ?? 0)), 0);
  if (inflatedSize > 150 * 1024 * 1024) throw new Error("Isi dokumen Word setelah dibuka melebihi batas aman 150 MB.");
  const documentEntry = zip.file("word/document.xml");
  if (!documentEntry) throw new Error("Isi utama dokumen Word tidak ditemukan.");
  const documentXml = parseXml(await documentEntry.async("string"), "utama");
  const body = descendants(documentXml, "body")[0];
  if (!body) throw new Error("Struktur dokumen Word tidak dikenali.");
  const document = createEmptyDocument();
  applyPageSetup(document, body);
  const styleEntry = zip.file("word/styles.xml");
  let outlineStyles = {};
  if (styleEntry) {
    const stylesXml = parseXml(await styleEntry.async("string"), "gaya teks");
    outlineStyles = extractHeadingStyles(stylesXml, document);
    const defaults = descendants(stylesXml, "docDefaults")[0];
    const defaultRun = firstChild(firstChild(defaults, "rPrDefault"), "rPr");
    const normal = descendants(stylesXml, "style").find((style) => attribute(style, "type") === "paragraph" && attribute(style, "default") === "1" && /normal/i.test(attribute(firstChild(style, "name"), "val")));
    const normalRun = firstChild(normal, "rPr");
    const normalParagraph = firstChild(normal, "pPr");
    const runProps = normalRun ?? defaultRun;
    const font = firstChild(runProps, "rFonts");
    const fontName = attribute(font, "ascii") || attribute(font, "hAnsi") || attribute(font, "cs");
    if (fontName && fontName.length <= 80) document.typography.fontFamily = fontName;
    const fontSize = Number(attribute(firstChild(runProps, "sz"), "val")) / 2;
    if (fontSize >= 6 && fontSize <= 36) document.typography.bodyPt = fontSize;
    const bodyBold = enabled(runProps, "b");
    const bodyItalic = enabled(runProps, "i");
    if (bodyBold !== undefined) document.typography.bodyBold = bodyBold;
    if (bodyItalic !== undefined) document.typography.bodyItalic = bodyItalic;
    const paragraphProps = normalParagraph ?? firstChild(firstChild(defaults, "pPrDefault"), "pPr");
    const indent = firstChild(paragraphProps, "ind");
    for (const side of ["left", "right"]) {
      const twips = numericAttribute(indent, side);
      if (twips !== undefined && twips >= 0 && twips <= 2880) document.paragraph[`${side}IndentCm`] = Number((twips / TWIPS_PER_CM).toFixed(2));
    }
    const hangingIndent = numericAttribute(indent, "hanging");
    const firstLineIndent = numericAttribute(indent, "firstLine");
    if (hangingIndent > 0 && hangingIndent <= 2880) {
      document.paragraph.specialIndentType = "hanging";
      document.paragraph.specialIndentCm = Number((hangingIndent / TWIPS_PER_CM).toFixed(2));
    } else if (firstLineIndent !== undefined && firstLineIndent >= 0 && firstLineIndent <= 2880) {
      document.paragraph.specialIndentType = firstLineIndent ? "firstLine" : "none";
      document.paragraph.specialIndentCm = Number((firstLineIndent / TWIPS_PER_CM).toFixed(2));
      document.paragraph.firstLineIndentCm = document.paragraph.specialIndentCm;
    }
    const spacing = firstChild(paragraphProps, "spacing");
    const before = numericAttribute(spacing, "before");
    const after = numericAttribute(spacing, "after");
    if (before !== undefined && before >= 0 && before <= 2400) document.paragraph.beforePt = before / 20;
    if (after !== undefined && after >= 0 && after <= 2400) document.paragraph.afterPt = after / 20;
    const line = numericAttribute(spacing, "line");
    const lineRule = attribute(spacing, "lineRule");
    if (line > 0 && (lineRule === "auto" || !lineRule)) document.paragraph.lineSpacing = Number(Math.max(0.5, Math.min(3, line / 240)).toFixed(2));
    const alignment = attribute(firstChild(paragraphProps, "jc"), "val");
    if (["left", "center", "right", "both"].includes(alignment)) document.paragraph.alignment = alignment === "both" ? "justify" : alignment;
    for (const [property, field] of [["widowControl", "widowControl"], ["keepLines", "keepLinesTogether"], ["keepNext", "keepWithNext"], ["pageBreakBefore", "pageBreakBefore"]]) {
      const value = enabled(paragraphProps, property);
      if (value !== undefined) document.paragraph[field] = value;
    }
  }
  return {
    sourceName: file.name,
    sourceType: "DOCX",
    paper: document.paper,
    margins: document.margins,
    typography: document.typography,
    paragraph: document.paragraph,
    outlineStyles,
    extractionNote: "Ukuran halaman dan pengaturan default Word dibaca. Gaya khusus pada setiap bagian tetap perlu dicocokkan dengan pedoman kampus.",
  };
}

/** Import the editable content and page setup from a Word .docx file. */
export async function documentFromDocxFile(file, folderId = null) {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") throw new Error("Impor Word harus dijalankan di browser.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Ukuran dokumen Word maksimal 25 MB.");
  const zip = await JSZip.loadAsync(file);
  const inflatedSize = Object.values(zip.files).reduce((total, entry) => total + (entry.dir ? 0 : Number(entry._data?.uncompressedSize ?? 0)), 0);
  if (inflatedSize > 150 * 1024 * 1024) throw new Error("Isi dokumen Word setelah dibuka melebihi batas aman 150 MB.");
  const documentEntry = zip.file("word/document.xml");
  if (!documentEntry) throw new Error("Isi utama dokumen Word tidak ditemukan.");
  const xml = parseXml(await documentEntry.async("string"), "utama");
  const body = descendants(xml, "body")[0];
  if (!body) throw new Error("Struktur dokumen Word tidak dikenali.");

  const title = String(file.name ?? "Dokumen Word").replace(/\.docx$/i, "").trim() || "Dokumen Word";
  const document = { ...createEmptyDocument(), title, folderId, sections: [] };
  applyPageSetup(document, body);

  const styleEntry = zip.file("word/styles.xml");
  const styles = new Map();
  if (styleEntry) {
    const styleXml = parseXml(await styleEntry.async("string"), "gaya teks");
    descendants(styleXml, "style").forEach((style) => styles.set(attribute(style, "styleId").toLowerCase().replace(/[\s_-]/g, ""), attribute(firstChild(style, "name"), "val")));
  }
  const relationshipEntry = zip.file("word/_rels/document.xml.rels");
  const relationships = new Map();
  if (relationshipEntry) {
    const relXml = parseXml(await relationshipEntry.async("string"), "relasi media");
    descendants(relXml, "Relationship").forEach((rel) => relationships.set(attribute(rel, "Id"), { target: attribute(rel, "Target"), external: attribute(rel, "TargetMode") === "External" }));
  }
  const numberingEntry = zip.file("word/numbering.xml");
  const formats = numberingEntry ? makeNumberingMap(await numberingEntry.async("string")) : new Map();
  const listCounters = new Map();
  const stack = [];
  let skippedImages = 0;

  for (const block of Array.from(body.children ?? [])) {
    const name = localName(block);
    if (name === "p") {
      const html = paragraphHtml(block, relationships);
      const plainText = descendants(block, "t").map((part) => part.textContent ?? "").join("").trim();
      const level = headingLevel(block, styles);
      if (level && plainText) appendHeading(document, stack, level, plainText);
      else if (html.trim()) {
        const marker = listMarker(block, formats, listCounters);
        addAtCurrentLevel(document, stack, createDocumentNode("paragraph", { title: "Paragraf", content: `${marker ? escapeHtml(marker) : ""}${html}` }));
      }
      for (const blip of descendants(block, "blip")) {
        const relationId = attribute(blip, "embed");
        const relationship = relationships.get(relationId);
        if (!relationship || relationship.external) continue;
        const path = dataTarget(relationship.target);
        const entry = zip.file(path);
        if (!entry || entry._data?.uncompressedSize > 5 * 1024 * 1024) { skippedImages += 1; continue; }
        const docProperties = descendants(block, "docPr")[0];
        const nameText = attribute(docProperties, "name") || `Gambar ${document.sections.length + 1}`;
        const altText = attribute(docProperties, "descr") || attribute(docProperties, "title") || "";
        const dataUrl = `data:${imageMimeType(path)};base64,${await entry.async("base64")}`;
        addAtCurrentLevel(document, stack, createDocumentNode("image", { title: nameText, caption: "", altText, asset: { name: path.split("/").pop(), mimeType: imageMimeType(path), dataUrl } }));
      }
    } else if (name === "tbl") {
      const rows = children(block, "tr").map((row) => children(row, "tc").map((cell) => children(cell, "p").map((paragraph) => descendants(paragraph, "t").map((part) => part.textContent ?? "").join("")).filter(Boolean).join(" ")));
      if (rows.length) {
        const hasHeaderRow = Boolean(firstChild(firstChild(children(block, "tr")[0], "trPr"), "tblHeader"));
        addAtCurrentLevel(document, stack, createDocumentNode("table", { title: "Tabel impor", caption: "", tableData: { rows, hasHeaderRow } }));
      }
    }
  }

  if (skippedImages) document.importWarning = `${skippedImages} gambar berukuran lebih dari 5 MB atau tidak dapat ditemukan dan dilewati.`;
  return document;
}
