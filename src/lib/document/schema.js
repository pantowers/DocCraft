export const PAPER_PRESETS = {
  A4: { widthCm: 21, heightCm: 29.7 },
  Letter: { widthCm: 21.59, heightCm: 27.94 },
  Legal: { widthCm: 21.59, heightCm: 35.56 },
  Folio: { widthCm: 21.5, heightCm: 33 },
};

export const DOCUMENT_PRESETS = {
  "Skripsi 4-4-3-3": { paper: "A4", margins: { topCm: 4, leftCm: 4, bottomCm: 3, rightCm: 3 } },
  Makalah: { paper: "A4", margins: { topCm: 3, leftCm: 3, bottomCm: 3, rightCm: 3 } },
  Jurnal: { paper: "A4", margins: { topCm: 2.5, leftCm: 2.5, bottomCm: 2.5, rightCm: 2.5 } },
  Custom: null,
};

export const NODE_TYPES = ["chapter", "section", "subsection", "paragraph", "codeBlock", "image", "table", "pageBreak", "tableOfContents", "listOfFigures", "listOfTables", "titlePage", "abstract", "frontMatter"];
export const CONTAINER_NODE_TYPES = ["chapter", "section", "subsection"];

export function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `doc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Create the initial serializable shape for a DocCraft document. */
export function createEmptyDocument(id = createId(), title = "Dokumen Tanpa Judul") {
  return {
    id,
    title,
    folderId: null,
    documentKind: "general",
    preset: "Skripsi 4-4-3-3",
    paper: { size: "A4", ...PAPER_PRESETS.A4 },
    margins: { topCm: 4, leftCm: 4, bottomCm: 3, rightCm: 3 },
    typography: {
      fontFamily: "Times New Roman",
      heading1Pt: 14,
      heading2Pt: 12,
      heading3Pt: 12,
      bodyPt: 12,
      bodyBold: false,
      bodyItalic: false,
      captionPt: 10,
    },
    outlineStyles: {},
    frontMatterProfile: { ...FRONT_MATTER_PROFILE_DEFAULTS },
    paragraph: {
      firstLineIndentCm: 1,
      specialIndentType: "firstLine",
      widowControl: true,
      leftIndentCm: 0,
      rightIndentCm: 0,
      lineSpacing: 1.5,
      alignment: "justify",
      beforePt: 0,
      afterPt: 0,
    },
    pageNumbering: { show: true, style: "arabic", startAt: 1, restart: false },
    citationStyle: "author-date",
    references: [],
    sections: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function createDocumentNode(type, values = {}) {
  if (!NODE_TYPES.includes(type)) throw new Error(`Unknown document node type: ${type}`);
  const node = {
    id: values.id ?? createId(),
    type,
    title: values.title ?? "",
    content: values.content ?? "",
  };

  if (CONTAINER_NODE_TYPES.includes(type)) node.children = values.children ?? [];
  if (type === "chapter") {
    node.pageNumbering = values.pageNumbering ?? null;
  }
  if (type === "image" || type === "table") {
    node.caption = values.caption ?? "";
    node.asset = values.asset ?? null;
  }
  if (type === "tableOfContents") node.title = values.title ?? "DAFTAR ISI";
  if (type === "codeBlock") {
    node.title = values.title ?? "Blok kode";
    node.codeLanguage = values.codeLanguage ?? "auto";
    node.codeFontSizePt = values.codeFontSizePt ?? 9;
    node.codeTheme = values.codeTheme ?? "dark";
  }
  if (type === "listOfFigures") node.title = values.title ?? "DAFTAR GAMBAR";
  if (type === "listOfTables") node.title = values.title ?? "DAFTAR TABEL";
  if (type === "titlePage") {
    node.title = values.title ?? "HALAMAN JUDUL";
    node.coverData = values.coverData ?? {};
  }
  if (type === "abstract") {
    node.title = values.title ?? "ABSTRAK";
    node.keywords = values.keywords ?? "";
    node.minWords = values.minWords ?? null;
    node.maxWords = values.maxWords ?? null;
  }
  if (type === "frontMatter") {
    node.title = values.title ?? "KATA PENGANTAR";
    node.frontMatterTemplate = values.frontMatterTemplate ?? null;
    node.frontMatterData = values.frontMatterData ?? {};
  }

  return { ...node, ...values, id: node.id, type };
}

export function createThesisFrontMatter() {
  return createThesisFrontMatterNodes().map(({ type, ...values }) => createDocumentNode(type, values));
}
import { createThesisFrontMatterNodes, FRONT_MATTER_PROFILE_DEFAULTS } from "@/lib/document/frontMatterTemplates";

