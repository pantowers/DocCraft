import { CONTAINER_NODE_TYPES, NODE_TYPES } from "./schema";

const requiredDocumentKeys = ["id", "title", "paper", "margins", "typography", "paragraph", "sections"];

export function validateDocument(document) {
  const errors = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return { valid: false, errors: ["Dokumen harus berupa object."] };
  }

  for (const key of requiredDocumentKeys) {
    if (!(key in document)) errors.push(`Properti wajib tidak ditemukan: ${key}.`);
  }
  if (typeof document.id !== "string" || !document.id.trim()) errors.push("id dokumen harus berupa teks yang tidak kosong.");
  if (typeof document.title !== "string") errors.push("title dokumen harus berupa teks.");
  if (document.documentKind !== undefined && !["general", "skripsi", "makalah", "laporan", "jurnal"].includes(document.documentKind)) errors.push("documentKind tidak dikenal.");
  if (document.citationStyle !== undefined && !["author-date", "numeric-bracket", "numeric-paren"].includes(document.citationStyle)) errors.push("citationStyle tidak dikenal.");
  if (!Array.isArray(document.sections)) errors.push("sections harus berupa array.");
  if (document.references !== undefined && !Array.isArray(document.references)) errors.push("references harus berupa array.");
  if (Array.isArray(document.references)) {
    const referenceIds = new Set();
    document.references.forEach((reference, index) => {
      if (!reference || typeof reference !== "object" || Array.isArray(reference)) { errors.push(`references[${index}] harus berupa object.`); return; }
      for (const key of ["id", "authors", "year", "title"]) if (typeof reference[key] !== "string" || !reference[key].trim()) errors.push(`references[${index}].${key} harus berupa teks yang tidak kosong.`);
      if (reference.sourceType !== undefined && !["book", "journal", "conference", "chapter", "website", "thesis", "report"].includes(reference.sourceType)) errors.push(`references[${index}].sourceType tidak dikenal.`);
      if (referenceIds.has(reference.id)) errors.push(`ID sumber duplikat: ${reference.id}.`);
      referenceIds.add(reference.id);
    });
  }

  const ids = new Set();
  if (Array.isArray(document.sections)) validateNodes(document.sections, ids, errors, "sections");

  for (const side of ["topCm", "leftCm", "bottomCm", "rightCm"]) {
    if (!Number.isFinite(document.margins?.[side]) || document.margins[side] < 0) {
      errors.push(`Margin ${side} harus berupa angka nol atau lebih.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateNodes(nodes, ids, errors, path) {
  nodes.forEach((node, index) => {
    const nodePath = `${path}[${index}]`;
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      errors.push(`${nodePath} harus berupa object.`);
      return;
    }
    if (!NODE_TYPES.includes(node.type)) errors.push(`${nodePath}.type tidak dikenal.`);
    if (typeof node.id !== "string" || !node.id.trim()) errors.push(`${nodePath}.id harus berupa teks yang tidak kosong.`);
    else if (ids.has(node.id)) errors.push(`ID node duplikat: ${node.id}.`);
    else ids.add(node.id);
    if (node.type === "abstract") {
      for (const key of ["minWords", "maxWords"]) {
        if (node[key] !== undefined && node[key] !== null && (!Number.isInteger(node[key]) || node[key] < 1)) errors.push(`${nodePath}.${key} harus berupa bilangan bulat positif atau null.`);
      }
    }

    if (CONTAINER_NODE_TYPES.includes(node.type)) {
      if (!Array.isArray(node.children)) errors.push(`${nodePath}.children harus berupa array.`);
      else validateNodes(node.children, ids, errors, `${nodePath}.children`);
    } else if (node.children !== undefined && !Array.isArray(node.children)) {
      errors.push(`${nodePath}.children harus berupa array jika disediakan.`);
    }
  });
}
