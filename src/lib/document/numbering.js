/** Number media in reading order, resetting the sequence for each chapter. */
export function numberMedia(nodes) {
  const counters = { image: {}, table: {} };
  return nodes.map((node) => {
    if (node.type !== "image" && node.type !== "table") return node;
    const kind = node.type;
    const chapter = String(node.chapter ?? 1);
    counters[kind][chapter] = (counters[kind][chapter] ?? 0) + 1;
    const label = kind === "image" ? "Gambar" : "Tabel";
    return { ...node, number: `${label} ${chapter}.${counters[kind][chapter]}` };
  });
}

/** Return live image/table labels based on chapter order and document reading order. */
export function getMediaLabels(sections) {
  const labels = {};
  const counters = { image: 0, table: 0 };
  let chapterNumber = 0;

  function visit(nodes) {
    for (const node of nodes ?? []) {
      if (node.type === "chapter") {
        chapterNumber += 1;
        counters.image = 0;
        counters.table = 0;
      }
      if (node.type === "image" || node.type === "table") {
        counters[node.type] += 1;
        const label = node.type === "image" ? "Gambar" : "Tabel";
        labels[node.id] = `${label} ${chapterNumber || 1}.${counters[node.type]}`;
      }
      visit(node.children);
    }
  }

  visit(sections);
  return labels;
}

/** Return captioned media in reading order for automatic figure/table lists. */
export function getMediaEntries(sections, type, labels = getMediaLabels(sections)) {
  const entries = [];
  function visit(nodes) {
    for (const node of nodes ?? []) {
      if (node.type === type) entries.push({ id: node.id, label: labels[node.id], caption: node.caption || "" });
      visit(node.children);
    }
  }
  visit(sections);
  return entries;
}

function roman(number) {
  const values = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let result = "";
  let remaining = number;
  values.forEach(([value, symbol]) => { while (remaining >= value) { result += symbol; remaining -= value; } });
  return result || "I";
}

export function getEditableHeadingTitle(node) {
  const title = String(node?.title ?? "");
  if (node?.type === "chapter") return title.replace(/^BAB\s+(?:[IVXLCDM]+|\d+)\s*/i, "").replace(/^[IVXLCDM]+\s*[.:-]\s*/i, "").trim();
  if (node?.type === "section" || node?.type === "subsection") return title.replace(/^\d+(?:\.\d+)*\s*/, "").trim();
  return title;
}

export function getHeadingLabel(node, number) {
  const title = getEditableHeadingTitle(node);
  if (node.type === "chapter") return node.plainHeading ? title : `BAB ${roman(number)}${title ? ` ${title}` : ""}`;
  if (node.plainHeading) return title;
  return `${number} ${title || (node.type === "section" ? "Sub-bab" : "Anak sub-bab")}`;
}

/** Build display labels for chapter, section, and subsection nodes in reading order. */
export function getHeadingLabels(sections) {
  const labels = {};
  let chapter = 0;
  let section = 0;
  let subsection = 0;

  function visit(nodes) {
    for (const node of nodes ?? []) {
      if (node.type === "chapter") {
        chapter += 1;
        section = 0;
        subsection = 0;
        labels[node.id] = getHeadingLabel(node, chapter);
      } else if (node.type === "section") {
        section += 1;
        subsection = 0;
        labels[node.id] = getHeadingLabel(node, `${chapter || 1}.${section}`);
      } else if (node.type === "subsection") {
        subsection += 1;
        labels[node.id] = getHeadingLabel(node, `${chapter || 1}.${section || 1}.${subsection}`);
      }
      visit(node.children);
    }
  }

  visit(sections);
  return labels;
}
