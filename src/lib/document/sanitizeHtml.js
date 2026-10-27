/** Keep saved rich text limited to the inline/block formatting supported by DocCraft. */
export function sanitizeEditorHtml(html) {
  if (typeof window === "undefined") return "";
  const parsed = new DOMParser().parseFromString(String(html ?? ""), "text/html");
  const allowed = new Set(["P", "DIV", "H2", "BR", "B", "STRONG", "I", "EM", "U", "S", "SUP", "SUB", "UL", "OL", "LI", "A", "SPAN", "BLOCKQUOTE"]);
  const clean = (parent) => {
    [...parent.childNodes].forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!allowed.has(child.tagName)) {
          clean(child);
          child.replaceWith(...child.childNodes);
          return;
        }
        [...child.attributes].forEach((attribute) => {
          const isListType = child.tagName === "OL" && ["type", "start"].includes(attribute.name);
          const isListIndent = ["OL", "UL"].includes(child.tagName) && ["data-dc-indent-cm", "data-dc-hanging-cm"].includes(attribute.name);
          const isListStyle = (["OL", "UL", "LI"].includes(child.tagName)) && attribute.name === "style";
          const isCitationId = child.tagName === "SPAN" && attribute.name === "data-reference-id";
          const isCitationMode = child.tagName === "SPAN" && attribute.name === "data-citation-mode";
          const isCitationLocator = child.tagName === "SPAN" && attribute.name === "data-citation-locator";
          const isCitationGroup = child.tagName === "SPAN" && attribute.name === "data-citation-group";
          const isTextStyle = child.tagName === "SPAN" && attribute.name === "style";
          const isMathClass = child.tagName === "SPAN" && attribute.name === "class" && child.getAttribute("class") === "dc-inline-math";
          const isMathSource = child.tagName === "SPAN" && attribute.name === "data-dc-math-source" && child.getAttribute(attribute.name).length <= 500;
          const isMathContentEditable = child.tagName === "SPAN" && child.classList.contains("dc-inline-math") && attribute.name === "contenteditable" && child.getAttribute(attribute.name) === "false";
          const isAlignment = ["P", "DIV", "H2"].includes(child.tagName) && attribute.name === "align" && ["left", "center", "right", "justify"].includes(child.getAttribute("align"));
          if ((child.tagName !== "A" || attribute.name !== "href") && !isCitationId && !isCitationMode && !isCitationLocator && !isCitationGroup && !isTextStyle && !isMathClass && !isMathSource && !isMathContentEditable && !isListType && !isListIndent && !isListStyle && !isAlignment) child.removeAttribute(attribute.name);
        });
        if (child.tagName === "OL") {
          if (!["1", "a", "A"].includes(child.getAttribute("type"))) child.removeAttribute("type");
          const start = Number(child.getAttribute("start"));
          if (!Number.isInteger(start) || start < 1 || start > 1000) child.removeAttribute("start");
        }
        if (["OL", "UL"].includes(child.tagName)) {
          for (const name of ["data-dc-indent-cm", "data-dc-hanging-cm"]) {
            const value = Number(child.getAttribute(name));
            if (!Number.isFinite(value) || value < 0.2 || value > 3) child.removeAttribute(name);
            else child.setAttribute(name, String(value));
          }
          const padding = child.style.paddingInlineStart;
          child.removeAttribute("style");
          if (/^(?:0?\.\d+|[1-2](?:\.\d+)?|3(?:\.0+)?)cm$/.test(padding)) child.style.paddingInlineStart = padding;
        }
        if (child.tagName === "SPAN" && child.hasAttribute("style")) {
          const originalStyle = child.style;
          const fontFamily = originalStyle.fontFamily.replace(/[\"']/g, "").trim();
          const allowedFonts = ["Times New Roman", "Arial", "Calibri", "Cambria"];
          const fontSize = originalStyle.fontSize.trim().toLowerCase();
          const safeSize = /^(?:[6-9]|[1-2]\d|3[0-6])(?:\.\d{1,2})?pt$/.test(fontSize) && Number.parseFloat(fontSize) <= 36;
          child.removeAttribute("style");
          if (allowedFonts.some((font) => fontFamily.toLowerCase() === font.toLowerCase())) child.style.fontFamily = allowedFonts.find((font) => font.toLowerCase() === fontFamily.toLowerCase());
          if (safeSize) child.style.fontSize = `${Number.parseFloat(fontSize)}pt`;
          if (!child.style.fontFamily && !child.style.fontSize) child.removeAttribute("style");
        }
        if (child.tagName === "LI") {
          const margin = child.style.marginInlineStart;
          const padding = child.style.paddingInlineStart;
          child.removeAttribute("style");
          if (/^-(?:0?\.\d+|[1-2](?:\.\d+)?)cm$/.test(margin)) child.style.marginInlineStart = margin;
          if (/^(?:0?\.\d+|[1-2](?:\.\d+)?)cm$/.test(padding)) child.style.paddingInlineStart = padding;
        }
        if (child.tagName === "SPAN" && child.hasAttribute("data-citation-mode") && !["parenthetical", "narrative"].includes(child.getAttribute("data-citation-mode"))) child.removeAttribute("data-citation-mode");
        if (child.tagName === "SPAN" && child.hasAttribute("data-citation-locator")) child.setAttribute("data-citation-locator", child.getAttribute("data-citation-locator").slice(0, 120));
        if (child.tagName === "SPAN" && child.hasAttribute("data-citation-group") && !/^[A-Za-z0-9_-]{1,100}$/.test(child.getAttribute("data-citation-group"))) child.removeAttribute("data-citation-group");
        if (child.tagName === "A") {
          const href = child.getAttribute("href") ?? "";
          const isReferenceAnchor = /^#doccraft-reference-[A-Za-z0-9_%.-]+$/.test(href);
          if (!/^(https?:|mailto:)/i.test(href) && !isReferenceAnchor) child.removeAttribute("href");
          child.setAttribute("rel", "noopener noreferrer");
        }
        if (child.tagName === "SPAN" && !child.hasAttribute("data-reference-id") && !child.hasAttribute("data-citation-group") && !child.hasAttribute("style") && !child.classList.contains("dc-inline-math")) {
          child.replaceWith(...child.childNodes);
          return;
        }
        clean(child);
      } else if (child.nodeType !== Node.TEXT_NODE) child.remove();
    });
  };
  clean(parsed.body);
  return parsed.body.innerHTML;
}
