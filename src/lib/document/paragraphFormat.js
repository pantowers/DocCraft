export const OUTLINE_STYLE_DEFAULTS = {
  chapter: { alignment: "center", leftIndentCm: 0, rightIndentCm: 0, specialIndentType: "none", specialIndentCm: 0, beforePt: 14, afterPt: 8, lineSpacing: 1, widowControl: true, keepWithNext: true, keepLinesTogether: true, pageBreakBefore: false },
  section: { alignment: "left", leftIndentCm: 0, rightIndentCm: 0, specialIndentType: "none", specialIndentCm: 0, beforePt: 12, afterPt: 7, lineSpacing: 1, widowControl: true, keepWithNext: true, keepLinesTogether: true, pageBreakBefore: false },
  subsection: { alignment: "left", leftIndentCm: 0, rightIndentCm: 0, specialIndentType: "none", specialIndentCm: 0, beforePt: 11, afterPt: 6, lineSpacing: 1, widowControl: true, keepWithNext: true, keepLinesTogether: true, pageBreakBefore: false },
};

export function getOutlineStyle(document, type) {
  return { ...(OUTLINE_STYLE_DEFAULTS[type] ?? {}), ...(document?.outlineStyles?.[type] ?? {}) };
}

export function getOutlineTextFormat(document, type) {
  const style = getOutlineStyle(document, type);
  const level = type === "chapter" ? 1 : type === "section" ? 2 : 3;
  const typography = document?.typography ?? {};
  return {
    fontFamily: style.fontFamily || typography.fontFamily || "Times New Roman",
    fontSizePt: Number(style.fontSizePt) > 0 ? Number(style.fontSizePt) : Number(typography[`heading${level}Pt`]) || 12,
    bold: style.bold ?? type !== "subsection",
    italic: style.italic ?? type === "subsection",
  };
}

export function getParagraphTextIndentCm(style) {
  const amount = Number(style?.specialIndentCm ?? style?.firstLineIndentCm) || 0;
  if (style?.specialIndentType === "hanging") return -amount;
  if (style?.specialIndentType === "none") return 0;
  return amount;
}

