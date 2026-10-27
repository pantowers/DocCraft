/** Helpers for configurable author–date and numeric citation formats. */
export const CITATION_STYLES = {
  "author-date": "APA 7 (penulis–tahun)",
  "numeric-bracket": "IEEE (angka [1])",
  "numeric-paren": "Vancouver (angka (1))",
};

export const REFERENCE_TYPES = {
  book: "Buku",
  journal: "Artikel jurnal",
  conference: "Makalah konferensi",
  chapter: "Bab dalam buku",
  website: "Laman web",
  thesis: "Skripsi atau tesis",
  report: "Laporan",
};

export function getCitationNumberMap(sections) {
  const result = {};
  let next = 1;
  function visit(nodes) {
    for (const node of nodes ?? []) {
      if (["paragraph", "abstract"].includes(node.type)) {
        for (const match of String(node.content ?? "").matchAll(/data-reference-id=["']([^"']+)["']/gi)) {
          if (!result[match[1]]) result[match[1]] = next++;
        }
      }
      visit(node.children);
    }
  }
  visit(sections);
  return result;
}

export function getReferenceAuthorLabel(reference, mode = "parenthetical") {
  const authors = String(reference?.authors ?? "").split(";").map((name) => name.trim()).filter(Boolean);
  const surnames = authors.map((name) => name.includes(",") ? name.split(",")[0].trim() : name.trim().split(/\s+/).at(-1));
  if (!surnames.length) return "Tanpa penulis";
  if (surnames.length === 1) return surnames[0];
  if (surnames.length === 2) return mode === "narrative" ? `${surnames[0]} dan ${surnames[1]}` : `${surnames[0]} & ${surnames[1]}`;
  return `${surnames[0]} et al.`;
}

export function getAuthorDateYearSuffixMap(references = []) {
  const groups = new Map();
  for (const reference of references) {
    const authors = String(reference?.authors ?? "").trim().toLocaleLowerCase("id-ID");
    const year = String(reference?.year ?? "").trim();
    if (!authors || !year) continue;
    const key = `${authors}\u0000${year}`;
    groups.set(key, [...(groups.get(key) ?? []), reference]);
  }
  const suffixes = {};
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((left, right) => String(left.title ?? "").localeCompare(String(right.title ?? ""), "id", { sensitivity: "base", numeric: true }));
    group.forEach((reference, index) => {
      let value = index + 1;
      let suffix = "";
      while (value > 0) {
        value -= 1;
        suffix = String.fromCharCode(97 + value % 26) + suffix;
        value = Math.floor(value / 26);
      }
      suffixes[reference.id] = suffix;
    });
  }
  return suffixes;
}

export function getReferenceAnchorId(referenceId) {
  const encoded = encodeURIComponent(String(referenceId ?? "")).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `doccraft-reference-${encoded}`;
}

export function formatInTextCitation(reference, style = "author-date", citationNumber = 1, options = {}) {
  const mode = options.mode === "narrative" ? "narrative" : "parenthetical";
  const locator = String(options.locator ?? "").trim();
  const suffix = locator ? `, ${locator}` : "";
  const author = getReferenceAuthorLabel(reference, mode);
  const year = `${reference?.year || "t.t."}${options.yearSuffix ?? options.yearSuffixMap?.[reference?.id] ?? ""}`;
  if (style === "numeric-bracket") {
    const number = `[${citationNumber}${suffix}]`;
    return mode === "narrative" ? `${author} ${number}` : number;
  }
  if (style === "numeric-paren") {
    const number = `(${citationNumber}${suffix})`;
    return mode === "narrative" ? `${author} ${number}` : number;
  }
  return mode === "narrative" ? `${author} (${year}${suffix})` : `(${author}, ${year}${suffix})`;
}

export function getReferenceUrl(reference) {
  const doi = String(reference?.doi ?? "").trim();
  const url = String(reference?.url ?? "").trim();
  if (doi) return `https://doi.org/${doi.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "")}`;
  if (!url) return "";
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const parsed = new URL(normalized);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function initials(name) {
  return String(name ?? "").split(/[\s.]+/).filter(Boolean).map((part) => `${part[0].toLocaleUpperCase("id-ID")}.`).join(" ");
}

function formatAPAName(name) {
  const parts = String(name ?? "").trim().split(",");
  if (parts.length < 2) return parts[0] ?? "";
  const surname = parts.shift().trim();
  const givenNames = parts.join(" ").trim();
  return `${surname}, ${initials(givenNames)}`.trim();
}

function formatAPAAuthors(reference) {
  const names = String(reference?.authors ?? "").split(";").map(formatAPAName).filter(Boolean);
  if (!names.length) return "Penulis tidak diketahui";
  if (names.length > 20) return `${names.slice(0, 19).join(", ")}, … ${names.at(-1)}`;
  if (names.length === 2) return `${names[0]}, & ${names[1]}`;
  if (names.length > 2) return `${names.slice(0, -1).join(", ")}, & ${names.at(-1)}`;
  return names[0];
}

function apaAuthorLead(authors) {
  return `${authors}${String(authors).endsWith(".") ? "" : "."}`;
}

function formatIEEEAuthor(name) {
  const parts = String(name ?? "").trim().split(",");
  const surname = parts.length > 1 ? parts.shift().trim() : parts.pop()?.trim() ?? "";
  return `${initials(parts.join(" "))} ${surname}`.trim();
}

function formatVancouverAuthor(name) {
  const parts = String(name ?? "").trim().split(",");
  const surname = parts.length > 1 ? parts.shift().trim() : parts.pop()?.trim() ?? "";
  return `${surname} ${initials(parts.join(" ")).replaceAll(".", "")}`.trim();
}

function doiIdentifier(reference) {
  return String(reference?.doi ?? "").trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "");
}

function formatNumberedReference(reference, style, number) {
  const authorNames = String(reference?.authors ?? "").split(";").map((name) => name.trim()).filter(Boolean);
  const authors = authorNames.length
    ? authorNames.map(style === "numeric-bracket" ? formatIEEEAuthor : formatVancouverAuthor).join(", ")
    : "Penulis tidak diketahui";
  const title = String(reference?.title ?? "").trim();
  const type = reference?.sourceType ?? "book";
  const year = String(reference?.year ?? "t.t.").trim() || "t.t.";
  const source = String(reference?.source ?? "").trim();
  const journal = String(reference?.journal || (type === "journal" ? source : "")).trim();
  const containerTitle = String(reference?.containerTitle || (["conference", "chapter"].includes(type) ? source : "")).trim();
  const editors = formatAPAAuthors({ authors: reference?.editor ?? "" });
  const publisher = String(reference?.publisher || (type === "book" ? source : "")).trim();
  const siteName = String(reference?.siteName || (type === "website" ? source : "")).trim();
  const institution = String(reference?.institution || source).trim();
  const volume = String(reference?.volume ?? "").trim();
  const issue = String(reference?.issue ?? "").trim();
  const pages = String(reference?.pages ?? "").trim();
  const doi = doiIdentifier(reference);
  const url = getReferenceUrl(reference);
  if (style === "numeric-bracket") {
    const parts = [`[${number ?? 1}] ${authors},`];
    if (type === "journal") {
      if (title) parts.push(`“${title},”`);
      if (journal) parts.push(`${journal},`);
      if (volume) parts.push(`vol. ${volume}${issue ? `, no. ${issue}` : ""},`);
      else if (issue) parts.push(`no. ${issue},`);
      if (pages) parts.push(`pp. ${pages},`);
      parts.push(`${year}.`);
    } else if (type === "conference" || type === "chapter") {
      if (title) parts.push(`“${title},”`);
      if (containerTitle) parts.push(`in ${editors !== "Penulis tidak diketahui" ? `${editors} (ed.), ` : ""}${containerTitle},`);
      if (pages) parts.push(`pp. ${pages},`);
      if (publisher) parts.push(`${publisher},`);
      parts.push(`${year}.`);
    } else if (type === "website") {
      if (title) parts.push(`“${title},”`);
      if (siteName) parts.push(`${siteName}.`);
      if (url) parts.push(`[Online]. Available: ${url}.`);
      else parts.push(`${year}.`);
    } else if (type === "thesis" || type === "report") {
      if (title) parts.push(`“${title},”`);
      parts.push(`${type === "thesis" ? "thesis" : "report"}${institution ? `, ${institution}` : ""}, ${year}.`);
    } else {
      if (title) parts.push(`${title}.`);
      if (publisher) parts.push(`${publisher},`);
      parts.push(`${year}.`);
    }
    if (doi) parts.push(`doi: ${doi.replace(/^https?:\/\/doi\.org\//i, "")}.`);
    return parts.join(" ").replace(/\s+\./g, ".");
  }

  const parts = [`(${number ?? 1}) ${authors}.`];
  if (title) parts.push(`${title}.`);
  if (type === "journal") {
    if (journal) parts.push(`${journal}.`);
    parts.push(`${year}${volume ? `;${volume}${issue ? `(${issue})` : ""}` : ""}${pages ? `:${pages}` : ""}.`);
  } else if (type === "conference" || type === "chapter") {
    if (containerTitle) parts.push(`In ${editors !== "Penulis tidak diketahui" ? `${editors} (Ed.), ` : ""}${containerTitle}${pages ? ` (pp. ${pages})` : ""}.`);
    if (publisher) parts.push(`${publisher}.`);
    parts.push(`${year}.`);
  } else if (type === "website") {
    parts.push(`${siteName ? `${siteName}. ` : ""}${year}. [Internet].${url ? ` Available from: ${url}.` : ""}`);
  } else if (type === "thesis" || type === "report") {
    parts.push(`${institution ? `${institution}; ` : ""}${year}.`);
  } else {
    parts.push(`${publisher ? `${publisher}; ` : ""}${year}.`);
  }
  if (doi) parts.push(`doi: ${doi.replace(/^https?:\/\/doi\.org\//i, "")}.`);
  return parts.join(" ").replace(/\s+\./g, ".");
}

export function formatReferenceEntry(reference, style = "author-date", citationNumber = null, yearSuffix = "") {
  const authors = formatAPAAuthors(reference);
  const year = `${String(reference?.year ?? "t.t.").trim() || "t.t."}${yearSuffix}`;
  const title = String(reference?.title ?? "").trim();
  const type = reference?.sourceType ?? "book";
  const source = String(reference?.source ?? "").trim();
  const publisher = String(reference?.publisher || (type === "book" ? source : "")).trim();
  const journal = String(reference?.journal || (type === "journal" ? source : "")).trim();
  const containerTitle = String(reference?.containerTitle || (["conference", "chapter"].includes(type) ? source : "")).trim();
  const editors = formatAPAAuthors({ authors: reference?.editor ?? "" });
  const siteName = String(reference?.siteName || (type === "website" ? source : "")).trim();
  const volume = String(reference?.volume ?? "").trim();
  const issue = String(reference?.issue ?? "").trim();
  const pages = String(reference?.pages ?? "").trim();
  const link = getReferenceUrl(reference);
  if (style === "numeric-bracket" || style === "numeric-paren") return formatNumberedReference(reference, style, citationNumber);
  let entry;
  if (type === "journal") {
    const volumeIssue = volume ? `${volume}${issue ? `(${issue})` : ""}` : "";
    const journalDetails = [journal, volumeIssue, pages].filter(Boolean).join(", ");
    entry = [`${apaAuthorLead(authors)} (${year}).`, title ? `${title}.` : "", journalDetails ? `${journalDetails}.` : "", link].filter(Boolean).join(" ");
  } else if (type === "conference" || type === "chapter") {
    const containerDetails = [containerTitle ? `In ${editors !== "Penulis tidak diketahui" ? `${editors} (Ed.), ` : ""}${containerTitle}${pages ? ` (pp. ${pages})` : ""}.` : "", publisher ? `${publisher}.` : ""].filter(Boolean).join(" ");
    entry = [`${apaAuthorLead(authors)} (${year}).`, title ? `${title}.` : "", containerDetails, link].filter(Boolean).join(" ");
  } else if (type === "website") {
    entry = [`${apaAuthorLead(authors)} (${year}).`, title ? `${title}.` : "", siteName ? `${siteName}.` : "", link].filter(Boolean).join(" ");
  } else if (type === "thesis" || type === "report") {
    const institution = String(reference?.institution || source).trim();
    const label = type === "thesis" ? "Skripsi atau tesis" : "Laporan";
    entry = [`${apaAuthorLead(authors)} (${year}).`, title ? `${title} [${label}].` : `[${label}].`, institution ? `${institution}.` : "", link].filter(Boolean).join(" ");
  } else {
    entry = [`${apaAuthorLead(authors)} (${year}).`, title ? `${title}.` : "", publisher ? `${publisher}.` : "", link].filter(Boolean).join(" ");
  }
  entry = entry.replace(/\.\s+(https?:\/\/)/, " $1");
  return entry;
}

export function formatReferenceParts(reference, style = "author-date", citationNumber = null, yearSuffix = "") {
  const entry = formatReferenceEntry(reference, style, citationNumber, yearSuffix);
  const type = reference?.sourceType ?? "book";
  const authors = formatAPAAuthors(reference);
  const year = `${String(reference?.year ?? "t.t.").trim() || "t.t."}${yearSuffix}`;
  const lead = `${apaAuthorLead(authors)} (${year}).`;
  const startAt = entry.indexOf(lead) + lead.length;
  const candidates = [];
  const addCandidate = (value, from, italics = true) => {
    if (!value) return;
    const index = entry.indexOf(value, Math.max(0, from));
    if (index >= 0) candidates.push({ start: index, end: index + value.length, italics });
  };
  const title = String(reference?.title ?? "").trim();
  if (type === "journal") {
    const journal = String(reference?.journal || reference?.source || "").trim();
    addCandidate(journal, Math.max(startAt, entry.indexOf(title, startAt) + title.length));
    const volume = String(reference?.volume ?? "").trim();
    const journalPosition = journal ? entry.indexOf(journal, startAt) + journal.length : startAt;
    addCandidate(volume, journalPosition);
  } else if (type === "conference" || type === "chapter") {
    addCandidate(title, Math.max(startAt, entry.indexOf(lead) + lead.length), false);
    addCandidate(String(reference?.containerTitle || reference?.source || "").trim(), entry.indexOf(title, startAt) + title.length, style === "author-date");
  } else {
    const italicTitle = style === "author-date" || type === "book" || (style === "numeric-paren" && ["thesis", "report"].includes(type));
    addCandidate(title, Math.max(startAt, entry.indexOf(lead) + lead.length), italicTitle);
  }

  const link = getReferenceUrl(reference);
  const linkStart = link ? entry.lastIndexOf(link) : -1;
  if (linkStart >= 0) candidates.push({ start: linkStart, end: linkStart + link.length, italics: false, href: link });
  else if (link && reference?.doi) {
    const doi = doiIdentifier(reference);
    const doiStart = doi ? entry.lastIndexOf(doi) : -1;
    if (doiStart >= 0) candidates.push({ start: doiStart, end: doiStart + doi.length, italics: false, href: link });
  }

  candidates.sort((left, right) => left.start - right.start);
  const parts = [];
  let cursor = 0;
  for (const candidate of candidates) {
    if (candidate.start < cursor) continue;
    if (candidate.start > cursor) parts.push({ text: entry.slice(cursor, candidate.start), italics: false });
    parts.push({ text: entry.slice(candidate.start, candidate.end), italics: candidate.italics, ...(candidate.href ? { href: candidate.href } : {}) });
    cursor = candidate.end;
  }
  if (cursor < entry.length) parts.push({ text: entry.slice(cursor), italics: false });
  return parts.length ? parts : [{ text: entry, italics: false }];
}

export function getUsedReferences(sections, references, style = "author-date") {
  const usedIds = new Set();
  function visit(nodes) {
    for (const node of nodes ?? []) {
      if (["paragraph", "abstract"].includes(node.type)) {
        for (const match of String(node.content ?? "").matchAll(/data-reference-id=["']([^"']+)["']/gi)) usedIds.add(match[1]);
      }
      visit(node.children);
    }
  }
  visit(sections);
  const used = (references ?? []).filter((reference) => usedIds.has(reference.id));
  if (style === "numeric-bracket" || style === "numeric-paren") {
    const numbers = getCitationNumberMap(sections);
    return used.sort((left, right) => (numbers[left.id] ?? Number.MAX_SAFE_INTEGER) - (numbers[right.id] ?? Number.MAX_SAFE_INTEGER));
  }
  return used.sort((left, right) => {
    const authorOrder = String(left.authors ?? "").localeCompare(String(right.authors ?? ""), "id", { sensitivity: "base" });
    if (authorOrder) return authorOrder;
    const yearOrder = String(left.year ?? "").localeCompare(String(right.year ?? ""), "id", { numeric: true, sensitivity: "base" });
    if (yearOrder) return yearOrder;
    return String(left.title ?? "").localeCompare(String(right.title ?? ""), "id", { sensitivity: "base", numeric: true });
  });
}

export function renderCitationHtml(html, references, style = "author-date", citationNumbers = {}, providedYearSuffixMap = null) {
  if (typeof DOMParser === "undefined") return String(html ?? "");
  const byId = new Map((references ?? []).map((reference) => [reference.id, reference]));
  const yearSuffixMap = providedYearSuffixMap ?? getAuthorDateYearSuffixMap(references);
  const parsed = new DOMParser().parseFromString(String(html ?? ""), "text/html");
  parsed.querySelectorAll("span[data-citation-group]").forEach((group) => {
    const mode = group.getAttribute("data-citation-mode") === "narrative" ? "narrative" : "parenthetical";
    const locator = group.getAttribute("data-citation-locator") ?? "";
    const citations = [...group.querySelectorAll("[data-reference-id]")].map((citation) => {
      const reference = byId.get(citation.getAttribute("data-reference-id"));
      if (!reference) return { citation, reference: null, text: citation.textContent ?? "" };
      const formatted = formatInTextCitation(reference, style, citationNumbers[reference.id] ?? 1, { mode, locator, yearSuffixMap });
      const text = mode === "narrative"
        ? formatted
        : style === "numeric-bracket" ? formatted.slice(1, -1)
          : style === "numeric-paren" ? formatted.slice(1, -1)
            : formatted.slice(1, -1);
      citation.textContent = text;
      return { citation, reference, text };
    });
    if (!citations.length) return;
    const separator = mode === "narrative" ? "; " : style === "author-date" ? "; " : ", ";
    const opening = mode === "narrative" ? "" : style === "numeric-bracket" ? "[" : "(";
    const closing = mode === "narrative" ? "" : style === "numeric-bracket" ? "]" : ")";
    const content = [parsed.createTextNode(opening)];
    citations.forEach(({ citation, reference }, index) => {
      if (index) content.push(parsed.createTextNode(separator));
      if (reference) {
        const link = parsed.createElement("a");
        link.setAttribute("href", `#${getReferenceAnchorId(reference.id)}`);
        link.append(citation);
        content.push(link);
      } else content.push(citation);
    });
    content.push(parsed.createTextNode(closing));
    group.replaceChildren(...content);
  });
  parsed.querySelectorAll("[data-reference-id]").forEach((citation) => {
    if (citation.closest("[data-citation-group]")) return;
    const reference = byId.get(citation.getAttribute("data-reference-id"));
    if (!reference) return;
    citation.textContent = formatInTextCitation(reference, style, citationNumbers[reference.id] ?? 1, { mode: citation.getAttribute("data-citation-mode"), locator: citation.getAttribute("data-citation-locator"), yearSuffixMap });
    const href = `#${getReferenceAnchorId(reference.id)}`;
    const existingLink = citation.closest("a");
    if (existingLink) existingLink.setAttribute("href", href);
    else {
      const link = parsed.createElement("a");
      link.setAttribute("href", href);
      citation.replaceWith(link);
      link.append(citation);
    }
  });
  return parsed.body.innerHTML;
}
