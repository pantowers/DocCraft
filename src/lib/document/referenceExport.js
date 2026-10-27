function cleanLine(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function escapeBibTeX(value) {
  return cleanLine(value)
    .replace(/[\\{}%#$&_]/g, (character) => character === "\\" ? "\\textbackslash{}" : `\\${character}`)
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function bibTeXKey(reference, used) {
  const firstAuthor = String(reference.authors ?? "").split(";")[0]?.trim() ?? "source";
  const surname = firstAuthor.includes(",") ? firstAuthor.split(",")[0] : firstAuthor.split(/\s+/).at(-1);
  const base = `${surname}-${reference.year || "nd"}-${String(reference.title ?? "").split(/\s+/)[0]}`
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "doccraft-reference";
  let key = base;
  let suffix = 2;
  while (used.has(key)) key = `${base}-${suffix++}`;
  used.add(key);
  return key;
}

function bibTeXType(sourceType) {
  return ({ journal: "article", conference: "inproceedings", chapter: "incollection", website: "online", thesis: "thesis", report: "techreport", book: "book" })[sourceType] ?? "misc";
}

export function formatReferencesAsBibTeX(references) {
  const usedKeys = new Set();
  return (references ?? []).map((reference) => {
    const type = bibTeXType(reference.sourceType);
    const fields = [
      ["author", String(reference.authors ?? "").split(";").map((name) => name.trim()).filter(Boolean).join(" and ")],
      ["year", reference.year],
      ["title", reference.title],
      ["journal", reference.sourceType === "journal" ? reference.journal || reference.source : ""],
      ["booktitle", ["conference", "chapter"].includes(reference.sourceType) ? reference.containerTitle || reference.source : ""],
      ["editor", ["conference", "chapter"].includes(reference.sourceType) ? String(reference.editor ?? "").split(";").map((name) => name.trim()).filter(Boolean).join(" and ") : ""],
      ["volume", reference.volume],
      ["number", reference.issue],
      ["pages", reference.pages],
      ["publisher", ["book", "conference", "chapter"].includes(reference.sourceType) ? reference.publisher || (reference.sourceType === "book" ? reference.source : "") : ""],
      ["organization", reference.sourceType === "website" ? reference.siteName || reference.source : ""],
      ["school", ["thesis", "report"].includes(reference.sourceType) ? reference.institution || reference.source : ""],
      ["doi", reference.doi],
      ["url", reference.url],
    ].filter(([, value]) => cleanLine(value));
    const body = fields.map(([name, value]) => `  ${name} = {${escapeBibTeX(value)}}`).join(",\n");
    return `@${type}{${bibTeXKey(reference, usedKeys)},\n${body}\n}`;
  }).join("\n\n");
}

function risTag(tag, value) {
  const cleanValue = cleanLine(value);
  return cleanValue ? `${tag}  - ${cleanValue}` : "";
}

function risType(sourceType) {
  return ({ journal: "JOUR", conference: "CONF", chapter: "CHAP", website: "ELEC", thesis: "THES", report: "RPRT", book: "BOOK" })[sourceType] ?? "GEN";
}

export function formatReferencesAsRIS(references) {
  return (references ?? []).map((reference) => {
    const lines = [risTag("TY", risType(reference.sourceType))];
    String(reference.authors ?? "").split(";").map((name) => name.trim()).filter(Boolean).forEach((author) => lines.push(risTag("AU", author)));
    lines.push(risTag("TI", reference.title), risTag("PY", reference.year));
    if (reference.sourceType === "journal") lines.push(risTag("JO", reference.journal || reference.source));
    else if (reference.sourceType === "conference" || reference.sourceType === "chapter") {
      lines.push(risTag("T2", reference.containerTitle || reference.source));
      String(reference.editor ?? "").split(";").map((name) => name.trim()).filter(Boolean).forEach((editor) => lines.push(risTag("ED", editor)));
      lines.push(risTag("PB", reference.publisher));
    }
    else if (reference.sourceType === "website") lines.push(risTag("T2", reference.siteName || reference.source));
    else if (["thesis", "report"].includes(reference.sourceType)) lines.push(risTag("PB", reference.institution || reference.source));
    else lines.push(risTag("PB", reference.publisher || reference.source));
    lines.push(risTag("VL", reference.volume), risTag("IS", reference.issue));
    const pages = String(reference.pages ?? "").trim().split(/\s*(?:–|—|--|-)\s*/);
    if (pages[0]) lines.push(risTag("SP", pages[0]));
    if (pages[1]) lines.push(risTag("EP", pages[1]));
    lines.push(risTag("DO", reference.doi), risTag("UR", reference.url), "ER  -");
    return lines.filter(Boolean).join("\r\n");
  }).join("\r\n\r\n");
}
