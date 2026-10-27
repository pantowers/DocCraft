function first(record, ...tags) {
  for (const tag of tags) {
    const value = record[tag]?.find((item) => item.trim());
    if (value) return value.trim();
  }
  return "";
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function mapRecord(record) {
  const title = clean(first(record, "TI", "T1"));
  if (!title) return null;
  const kind = first(record, "TY").toUpperCase();
  const url = clean(first(record, "UR", "L1"));
  const isJournal = kind === "JOUR";
  const isConference = ["CONF", "CPAPER", "INPR"].includes(kind);
  const isChapter = ["CHAP", "ECHAP"].includes(kind);
  const isThesis = ["THES", "DISS"].includes(kind);
  const isReport = ["RPRT", "REPORT"].includes(kind);
  const isWebsite = ["ELEC", "WEB", "WEBPAGE", "ONLINE"].includes(kind) || (kind === "GEN" && Boolean(url));
  const sourceType = isJournal ? "journal" : isConference ? "conference" : isChapter ? "chapter" : isThesis ? "thesis" : isReport ? "report" : isWebsite ? "website" : "book";
  const authorNames = (record.AU?.length ? record.AU : record.A1 ?? []).map(clean).filter(Boolean);
  if (!authorNames.length) authorNames.push(...(record.ED ?? record.A2 ?? []).map((name) => `${clean(name)} (Ed.)`).filter(Boolean));
  const yearText = first(record, "PY", "Y1", "DA");
  const year = yearText.match(/\d{4}/)?.[0] ?? "t.t.";
  const startPage = first(record, "SP");
  const endPage = first(record, "EP");
  const pages = startPage && endPage ? `${startPage}–${endPage}` : first(record, "PG") || startPage || endPage;
  const reference = {
    sourceType,
    authors: authorNames.join("; ") || "Tanpa penulis",
    year,
    title,
    source: "",
    volume: clean(first(record, "VL")),
    issue: clean(first(record, "IS")),
    pages: clean(pages),
    institution: "",
    doi: clean(first(record, "DO")),
    url,
  };
  if (sourceType === "journal") {
    reference.journal = clean(first(record, "JO", "JF", "JA", "T2"));
    reference.source = reference.journal;
  } else if (sourceType === "conference" || sourceType === "chapter") {
    reference.containerTitle = clean(first(record, "T2", "BT", "JO"));
    reference.source = reference.containerTitle;
    reference.publisher = clean(first(record, "PB", "CY"));
    reference.editor = (record.ED ?? []).map(clean).filter(Boolean).join("; ");
  } else if (sourceType === "website") {
    reference.siteName = clean(first(record, "T2", "JO", "PB", "CY"));
    reference.source = reference.siteName;
  } else if (sourceType === "thesis" || sourceType === "report") {
    reference.institution = clean(first(record, "PB", "IN", "AD", "CY"));
    reference.source = reference.institution;
  } else {
    reference.publisher = clean(first(record, "PB", "CY"));
    reference.source = reference.publisher;
  }
  return reference;
}

export function parseRIS(sourceText) {
  const records = [];
  let current = null;
  let skipped = 0;
  for (const line of String(sourceText ?? "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9]{2})\s+-\s?(.*)$/i);
    if (!match) {
      if (current && line.trim() && current.lastTag) {
        const values = current.fields[current.lastTag];
        values[values.length - 1] = `${values.at(-1)} ${line.trim()}`.trim();
      }
      continue;
    }
    const tag = match[1].toUpperCase();
    const value = match[2].trim();
    if (tag === "TY") {
      if (current) records.push(current.fields);
      current = { fields: { TY: [value] }, lastTag: "TY" };
      continue;
    }
    if (!current) continue;
    if (tag === "ER") {
      records.push(current.fields);
      current = null;
      continue;
    }
    (current.fields[tag] ??= []).push(value);
    current.lastTag = tag;
  }
  if (current) records.push(current.fields);
  const references = records.map(mapRecord).filter((reference) => {
    if (reference) return true;
    skipped += 1;
    return false;
  });
  return { references, skipped };
}
