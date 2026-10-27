import { createDocumentNode, createEmptyDocument } from "./schema";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function inlineMarkdown(value) {
  let html = escapeHtml(value.trim());
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/gi, '<a href="$2">$1</a>');
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/__(.+?)__/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>").replace(/_(.+?)_/g, "<em>$1</em>");
  html = html.replace(/~~(.+?)~~/g, "<s>$1</s>");
  return html;
}

function headingNode(type, title) {
  return createDocumentNode(type, { title, children: [] });
}

function addParagraph(parent, content) {
  if (!content.trim()) return;
  parent.push(createDocumentNode("paragraph", { title: "Paragraf", content }));
}

/** Import plain text or Markdown into a new DocCraft document outline. */
export function documentFromTextFile(fileName, text, folderId = null) {
  const title = String(fileName || "Dokumen impor").replace(/\.(txt|md|markdown)$/i, "").trim() || "Dokumen impor";
  const document = { ...createEmptyDocument(), title, folderId, sections: [] };
  const lines = String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const stack = [];
  let paragraphLines = [];
  let listItems = [];

  const currentContent = () => stack.at(-1)?.children ?? document.sections;
  const flushParagraph = () => {
    addParagraph(currentContent(), paragraphLines.map((line) => inlineMarkdown(line)).join(" "));
    paragraphLines = [];
  };
  const flushList = () => {
    if (listItems.length) addParagraph(currentContent(), `<ul>${listItems.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };
  const flushBlocks = () => { flushParagraph(); flushList(); };

  for (const line of lines) {
    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushBlocks();
      const level = heading[1].length;
      const type = level === 1 ? "chapter" : level === 2 ? "section" : "subsection";
      const node = headingNode(type, heading[2].trim());
      if (level === 1) {
        document.sections.push(node);
        stack.splice(0, stack.length, node);
      } else if (level === 2) {
        if (!stack.length) {
          const chapter = headingNode("chapter", title);
          document.sections.push(chapter);
          stack.push(chapter);
        }
        stack.splice(1);
        stack[0].children.push(node);
        stack.push(node);
      } else {
        if (!stack.length) {
          const chapter = headingNode("chapter", title);
          document.sections.push(chapter);
          stack.push(chapter);
        }
        if (stack.length === 1) {
          const section = headingNode("section", "Bagian");
          stack[0].children.push(section);
          stack.push(section);
        }
        stack.splice(2);
        stack[1].children.push(node);
        stack.push(node);
      }
      continue;
    }

    if (!line.trim()) { flushBlocks(); continue; }
    const listItem = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+)$/);
    if (listItem) {
      flushParagraph();
      listItems.push(listItem[1]);
      continue;
    }
    flushList();
    paragraphLines.push(line.trim());
  }
  flushBlocks();
  return document;
}
