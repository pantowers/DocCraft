function skipWhitespace(source, position) {
  while (position < source.length && /\s/.test(source[position])) position += 1;
  return position;
}

function readBalanced(source, position, open, close) {
  let depth = 1;
  let value = "";
  position += 1;
  while (position < source.length && depth > 0) {
    const character = source[position];
    if (character === "\\" && position + 1 < source.length) {
      value += character + source[position + 1];
      position += 2;
      continue;
    }
    if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return { value, position: position + 1 };
    }
    if (depth > 0) value += character;
    position += 1;
  }
  return { value, position };
}

function readQuoted(source, position) {
  let value = "";
  position += 1;
  while (position < source.length) {
    const character = source[position];
    if (character === "\\" && position + 1 < source.length) {
      value += character + source[position + 1];
      position += 2;
      continue;
    }
    if (character === '"') return { value, position: position + 1 };
    value += character;
    position += 1;
  }
  return { value, position };
}

function readValue(source, position, closing, macros) {
  const values = [];
  let cursor = position;
  while (cursor < source.length) {
    cursor = skipWhitespace(source, cursor);
    let atom;
    if (source[cursor] === "{") atom = readBalanced(source, cursor, "{", "}");
    else if (source[cursor] === '"') atom = readQuoted(source, cursor);
    else {
      let end = cursor;
      while (end < source.length && source[end] !== "," && source[end] !== "#" && source[end] !== closing) end += 1;
      const raw = source.slice(cursor, end).trim();
      atom = { value: macros.get(raw.toLowerCase()) ?? raw, position: end };
    }
    values.push(atom.value);
    cursor = skipWhitespace(source, atom.position);
    if (source[cursor] !== "#") break;
    cursor += 1;
  }
  return { value: values.join(""), position: cursor };
}

function cleanBibTeXText(value) {
  return String(value ?? "")
    .replace(/\\([&%$#_{}])/g, "$1")
    .replace(/\\textendash\b/g, "–")
    .replace(/\\textemdash\b/g, "—")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/~/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitAuthors(value) {
  const names = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "{") depth += 1;
    else if (value[index] === "}") depth = Math.max(0, depth - 1);
    if (depth === 0 && /^\s+and\s+/i.test(value.slice(index))) {
      names.push(value.slice(start, index));
      const separator = value.slice(index).match(/^\s+and\s+/i)[0];
      index += separator.length - 1;
      start = index + 1;
    }
  }
  names.push(value.slice(start));
  return names.map(cleanBibTeXText).filter(Boolean).join("; ");
}

function mapEntry(type, fields) {
  const title = cleanBibTeXText(fields.title);
  if (!title) return null;
  const rawType = type.toLowerCase();
  const isJournalArticle = rawType === "article";
  const isConferencePaper = ["inproceedings", "conference"].includes(rawType);
  const isBookChapter = ["incollection", "inbook"].includes(rawType);
  const isThesis = ["phdthesis", "mastersthesis", "thesis"].includes(rawType);
  const isReport = ["techreport", "report"].includes(rawType);
  const isWebsite = ["online", "www", "webpage"].includes(rawType) || (rawType === "misc" && Boolean(fields.url));
  const sourceType = isJournalArticle ? "journal" : isConferencePaper ? "conference" : isBookChapter ? "chapter" : isThesis ? "thesis" : isReport ? "report" : isWebsite ? "website" : "book";
  const authors = splitAuthors(fields.author || fields.editor || "") || "Tanpa penulis";
  const yearMatch = String(fields.year || fields.date || "").match(/\d{4}/);
  const year = yearMatch?.[0] ?? "t.t.";
  const url = cleanBibTeXText(fields.url);
  const doi = cleanBibTeXText(fields.doi);
  const reference = {
    sourceType,
    authors,
    year,
    title,
    source: "",
    volume: cleanBibTeXText(fields.volume),
    issue: cleanBibTeXText(fields.number),
    pages: cleanBibTeXText(fields.pages).replace(/--/g, "–"),
    institution: "",
    doi,
    url,
  };
  if (sourceType === "journal") {
    reference.journal = cleanBibTeXText(fields.journal || fields.booktitle);
    reference.source = reference.journal;
  } else if (sourceType === "conference" || sourceType === "chapter") {
    reference.containerTitle = cleanBibTeXText(fields.booktitle || fields.titlebook);
    reference.source = reference.containerTitle;
    reference.publisher = cleanBibTeXText(fields.publisher || fields.organization);
    reference.editor = splitAuthors(fields.editor || "");
  } else if (sourceType === "website") {
    reference.siteName = cleanBibTeXText(fields.organization || fields.publisher || fields.journal);
    reference.source = reference.siteName;
  } else if (sourceType === "thesis" || sourceType === "report") {
    reference.institution = cleanBibTeXText(fields.school || fields.institution || fields.organization || fields.publisher);
    reference.source = reference.institution;
  } else {
    reference.publisher = cleanBibTeXText(fields.publisher || fields.organization);
    reference.source = reference.publisher;
  }
  return reference;
}

export function parseBibTeX(sourceText) {
  const source = String(sourceText ?? "");
  const references = [];
  const macros = new Map();
  let cursor = 0;
  let skipped = 0;
  while (cursor < source.length) {
    const marker = source.indexOf("@", cursor);
    if (marker < 0) break;
    let position = marker + 1;
    while (/[a-z]/i.test(source[position] ?? "")) position += 1;
    const type = source.slice(marker + 1, position).toLowerCase();
    position = skipWhitespace(source, position);
    const open = source[position];
    const closing = open === "{" ? "}" : open === "(" ? ")" : "";
    if (!closing) { cursor = marker + 1; continue; }
    if (["comment", "preamble"].includes(type)) {
      cursor = readBalanced(source, position, open, closing).position;
      continue;
    }
    position += 1;
    if (type !== "string") {
      position = skipWhitespace(source, position);
      while (position < source.length && source[position] !== "," && source[position] !== closing) position += 1;
      if (source[position] === closing) {
        cursor = position + 1;
        continue;
      }
      position += 1;
    }
    const fields = {};
    while (position < source.length) {
      position = skipWhitespace(source, position);
      while (source[position] === ",") position = skipWhitespace(source, position + 1);
      if (source[position] === closing || position >= source.length) { position += 1; break; }
      const fieldStart = position;
      while (position < source.length && /[\w-]/.test(source[position])) position += 1;
      const fieldName = source.slice(fieldStart, position).toLowerCase();
      position = skipWhitespace(source, position);
      if (!fieldName || source[position] !== "=") {
        while (position < source.length && source[position] !== "," && source[position] !== closing) position += 1;
        continue;
      }
      const value = readValue(source, skipWhitespace(source, position + 1), closing, macros);
      fields[fieldName] = value.value;
      position = value.position;
      if (type === "string") macros.set(fieldName, value.value);
      if (source[position] === ",") position += 1;
    }
    cursor = position;
    if (["comment", "preamble", "string"].includes(type)) continue;
    const reference = mapEntry(type, fields);
    if (reference) references.push(reference);
    else skipped += 1;
  }
  return { references, skipped };
}
