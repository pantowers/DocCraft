"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AlignLeft, Bold, Check, Code2, GripVertical, Image as ImageIcon, Indent, Italic, Link2, List, ListOrdered, Outdent, Plus, Quote, Strikethrough, Subscript, Superscript, Table2, Trash2, Underline } from "lucide-react";
import { createId, PAPER_PRESETS } from "@/lib/document/schema";
import { parseBibTeX } from "@/lib/document/bibtex";
import { parseRIS } from "@/lib/document/ris";
import { formatReferencesAsBibTeX, formatReferencesAsRIS } from "@/lib/document/referenceExport";
import { getReferenceIdentityKeys } from "@/lib/document/referenceIdentity";
import { CITATION_STYLES, formatInTextCitation, formatReferenceParts, getAuthorDateYearSuffixMap, getCitationNumberMap, getUsedReferences, REFERENCE_TYPES, renderCitationHtml } from "@/lib/document/references";
import { getEditableHeadingTitle, getHeadingLabels, getMediaLabels } from "@/lib/document/numbering";
import { sanitizeEditorHtml } from "@/lib/document/sanitizeHtml";
import { formatHangingMarker } from "@/lib/document/hanging";
import { codeTokenColor, getCodeTheme, resolveCodeLanguage, tokenizeCodeLine } from "@/lib/document/codeHighlight";
import { getWritingGuidance } from "@/lib/document/writingGuidance";
import { getOutlineStyle, getParagraphTextIndentCm } from "@/lib/document/paragraphFormat";
import { FRONT_MATTER_PROFILE_DEFAULTS, FRONT_MATTER_TEMPLATE_FIELDS } from "@/lib/document/frontMatterTemplates";
import { formatPresetFromDocxFile } from "@/lib/document/importDocx";
import { formatPresetFromPdfFile } from "@/lib/document/importPdfFormat";
import { findNode, useDocumentStore } from "@/store/useDocumentStore";

const fonts = ["Times New Roman", "Arial", "Calibri", "Cambria"];
const EMPTY_REFERENCE_DRAFT = { sourceType: "book", authors: "", year: "", title: "", source: "", publisher: "", editor: "", volume: "", issue: "", pages: "", institution: "", doi: "", url: "" };
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
function applyHangingStyles(editor) {
  editor?.querySelectorAll("ol[data-dc-hanging-cm], ul[data-dc-hanging-cm]").forEach((list) => {
    const hanging = Math.min(2, Math.max(0.2, Number(list.getAttribute("data-dc-hanging-cm")) || 0.6));
    [...list.children].filter((child) => child.tagName === "LI").forEach((item) => {
      item.style.marginInlineStart = `-${hanging}cm`;
      item.style.paddingInlineStart = `${hanging}cm`;
    });
  });
}

function HighlightedCodeEditor({ value, language, theme = "dark", onChange }) {
  const textareaRef = useRef(null);
  const highlightRef = useRef(null);
  const syncScroll = () => {
    if (!textareaRef.current || !highlightRef.current) return;
    highlightRef.current.scrollTop = textareaRef.current.scrollTop;
    highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
  };
  function insertIndent(event) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const field = event.currentTarget;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    onChange(`${field.value.slice(0, start)}    ${field.value.slice(end)}`);
    requestAnimationFrame(() => { field.selectionStart = field.selectionEnd = start + 4; });
  }
  const lines = String(value ?? "").split("\n");
  const activeLanguage = resolveCodeLanguage(language, value);
  const themeColors = getCodeTheme(theme);
  return <div className={`code-block-editor__shell code-block-editor__shell--${theme}`}>
    <pre ref={highlightRef} className="code-block-editor__highlight" aria-hidden="true" style={{ color: themeColors.foreground }}><code>{lines.map((line, lineIndex) => <span className="code-block-editor__line" key={`line-${lineIndex}`}>{lineIndex ? "\n" : ""}{tokenizeCodeLine(line, activeLanguage).map((token, tokenIndex) => <span key={`${lineIndex}-${tokenIndex}`} style={{ color: codeTokenColor(token.kind, theme) }}>{token.text}</span>)}</span>)}</code></pre>
    <textarea ref={textareaRef} id="code-block-content" className="code-block-editor__textarea" style={{ caretColor: themeColors.foreground }} spellCheck="false" autoCapitalize="off" autoCorrect="off" value={value ?? ""} onChange={(event) => onChange(event.target.value)} onKeyDown={insertIndent} onScroll={syncScroll} placeholder={'function main() {\n  console.log("Hello, world!");\n}'} aria-label="Kode sumber" />
  </div>;
}
const toolbar = [
  ["bold", "Tebal", Bold], ["italic", "Miring", Italic], ["underline", "Garis bawah", Underline],
  ["strikeThrough", "Coret", Strikethrough], ["insertUnorderedList", "Daftar poin", List],
  ["insertOrderedList", "Daftar bernomor", ListOrdered], ["outdent", "Kurangi indentasi", Outdent],
  ["indent", "Tambah indentasi", Indent], ["superscript", "Pangkat atas", Superscript],
  ["subscript", "Pangkat bawah", Subscript],
];

function RichTextEditor({ node, onChange, onSplit, onPasteImage, onAddHanging, hangingItems = [], onUpdateHangingItems, onUpdateHangingSettings, documentSettings, references = [], usedReferences = [], citationStyle = "author-date", citationNumbers = {}, citationYearSuffixes = {} }) {
  const editorRef = useRef(null);
  const savedTextSelectionRef = useRef(null);
  const draggedHangingItemRef = useRef(null);
  const [inlineFontFamily, setInlineFontFamily] = useState(documentSettings.typography.fontFamily);
  const [inlineFontSize, setInlineFontSize] = useState(String(documentSettings.typography.bodyPt));
  const [inlineFormatNotice, setInlineFormatNotice] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const [citationOpen, setCitationOpen] = useState(false);
  const [citationMode, setCitationMode] = useState("parenthetical");
  const [citationLocator, setCitationLocator] = useState("");
  const [citationReferenceIds, setCitationReferenceIds] = useState([]);
  const [hangingOpen, setHangingOpen] = useState(false);
  const [hangingText, setHangingText] = useState("");
  const [listFormat, setListFormat] = useState("decimal");
  const [listIndentCm, setListIndentCm] = useState("0.65");
  const [listHangingCm, setListHangingCm] = useState("0.6");
  const [listFontFamily, setListFontFamily] = useState(documentSettings.typography.fontFamily);
  const [listFontSizePt, setListFontSizePt] = useState(String(documentSettings.typography.bodyPt));
  const [listAlignment, setListAlignment] = useState(documentSettings.paragraph.alignment ?? "justify");
  const [listLineSpacing, setListLineSpacing] = useState(String(documentSettings.paragraph.lineSpacing));
  const [listBeforePt, setListBeforePt] = useState(String(documentSettings.paragraph.beforePt));
  const [listAfterPt, setListAfterPt] = useState(String(documentSettings.paragraph.afterPt));

  // Keep these editable controls synchronized when selection changes to a different saved paragraph.
  useEffect(() => {
    const list = node.hangingSettings ?? {};
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate editable controls from the selected saved paragraph.
    setListFormat(list.format ?? "decimal");
    setListIndentCm(String(list.indentCm ?? 0.65));
    setListHangingCm(String(list.hangingCm ?? 0.6));
    setListFontFamily(list.fontFamily ?? documentSettings.typography.fontFamily);
    setListFontSizePt(String(list.fontSizePt ?? documentSettings.typography.bodyPt));
    setListAlignment(list.alignment ?? documentSettings.paragraph.alignment ?? "justify");
    setListLineSpacing(String(list.lineSpacing ?? documentSettings.paragraph.lineSpacing));
    setListBeforePt(String(list.beforePt ?? documentSettings.paragraph.beforePt));
    setListAfterPt(String(list.afterPt ?? documentSettings.paragraph.afterPt));
  }, [node.id, node.hangingSettings, documentSettings.typography.fontFamily, documentSettings.typography.bodyPt, documentSettings.paragraph.alignment, documentSettings.paragraph.lineSpacing, documentSettings.paragraph.beforePt, documentSettings.paragraph.afterPt]);

  // Existing hanging items should reveal their editor when another paragraph is selected.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reveal persisted hanging items on selection.
    if (hangingItems.length) setHangingOpen(true);
  }, [node.id, hangingItems.length]);

  useEffect(() => {
    if (editorRef.current) {
      const keepFocus = window.document.activeElement === editorRef.current;
      editorRef.current.innerHTML = renderCitationHtml(sanitizeEditorHtml(node.content || ""), references, citationStyle, citationNumbers, citationYearSuffixes);
      if (keepFocus) {
        editorRef.current.focus();
        const range = window.document.createRange();
        const walker = window.document.createTreeWalker(editorRef.current, NodeFilter.SHOW_TEXT);
        const firstText = walker.nextNode();
        if (firstText) range.setStart(firstText, 0);
        else {
          range.selectNodeContents(editorRef.current);
          range.collapse(true);
        }
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    // Only load content when switching nodes; tracking each edit would reset the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  useEffect(() => {
    if (editorRef.current && window.document.activeElement !== editorRef.current) editorRef.current.innerHTML = renderCitationHtml(sanitizeEditorHtml(node.content || ""), references, citationStyle, citationNumbers, citationYearSuffixes);
  }, [references, node.content, citationStyle, citationNumbers, citationYearSuffixes]);

  function runCommand(command) {
    editorRef.current?.focus();
    window.document.execCommand(command, false);
    onChange(sanitizeEditorHtml(editorRef.current?.innerHTML ?? ""));
  }

  function rememberTextSelection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editorRef.current?.contains(selection.anchorNode) || !editorRef.current?.contains(selection.focusNode)) return;
    savedTextSelectionRef.current = selection.getRangeAt(0).cloneRange();
  }

  function applyInlineTextStyle(property, value) {
    const editor = editorRef.current;
    const range = savedTextSelectionRef.current;
    if (!editor || !range || range.collapsed || !editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
      setInlineFormatNotice("Blok teks yang ingin diubah terlebih dahulu.");
      editor?.focus();
      return;
    }
    const blockFor = (node) => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest("p, div, blockquote") ?? editor;
    if (blockFor(range.startContainer) !== blockFor(range.endContainer)) {
      setInlineFormatNotice("Pilih teks dalam satu paragraf untuk mengubah font.");
      return;
    }
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const selected = selection.getRangeAt(0);
    const wrapper = window.document.createElement("span");
    wrapper.style[property] = property === "fontSize" ? `${value}pt` : value;
    wrapper.append(selected.extractContents());
    selected.insertNode(wrapper);
    selected.selectNodeContents(wrapper);
    selection.removeAllRanges();
    selection.addRange(selected);
    savedTextSelectionRef.current = selected.cloneRange();
    setInlineFormatNotice("");
    onChange(sanitizeEditorHtml(editor.innerHTML));
  }

  function insertLink() {
    const url = linkUrl.trim();
    if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) return;
    editorRef.current?.focus();
    window.document.execCommand("createLink", false, url);
    onChange(sanitizeEditorHtml(editorRef.current?.innerHTML ?? ""));
    setLinkOpen(false);
  }

  function insertCitation(selectedIds) {
    const ids = (Array.isArray(selectedIds) ? selectedIds : [selectedIds]).filter(Boolean);
    const selectedReferences = references.filter((item) => ids.includes(item.id));
    if (!selectedReferences.length) return;
    if (citationStyle === "author-date") selectedReferences.sort((left, right) => String(left.authors ?? "").localeCompare(String(right.authors ?? ""), "id", { sensitivity: "base" }) || String(left.year ?? "").localeCompare(String(right.year ?? ""), "id", { numeric: true }) || String(left.title ?? "").localeCompare(String(right.title ?? ""), "id", { sensitivity: "base" }));
    else selectedReferences.sort((left, right) => (citationNumbers[left.id] ?? Number.MAX_SAFE_INTEGER) - (citationNumbers[right.id] ?? Number.MAX_SAFE_INTEGER));
    const referencesAfterInsert = new Map([...usedReferences, ...selectedReferences].map((referenceItem) => [referenceItem.id, referenceItem]));
    const suffixesAfterInsert = getAuthorDateYearSuffixMap([...referencesAfterInsert.values()]);
    const escapedLocator = escapeHtml(citationLocator.trim().slice(0, 120));
    const citationHtml = selectedReferences.length === 1
      ? `<span data-reference-id="${escapeHtml(selectedReferences[0].id)}" data-citation-mode="${citationMode}" data-citation-locator="${escapedLocator}">${escapeHtml(formatInTextCitation(selectedReferences[0], citationStyle, citationNumbers[selectedReferences[0].id] ?? 1, { mode: citationMode, locator: citationLocator, yearSuffixMap: suffixesAfterInsert }))}</span>&nbsp;`
      : `<span data-citation-group="${createId()}" data-citation-mode="${citationMode}" data-citation-locator="${escapedLocator}">${selectedReferences.map((reference) => `<span data-reference-id="${escapeHtml(reference.id)}"></span>`).join("")}</span>&nbsp;`;
    editorRef.current?.focus();
    window.document.execCommand("insertHTML", false, citationHtml);
    if (selectedReferences.length > 1 && editorRef.current) {
      editorRef.current.innerHTML = renderCitationHtml(editorRef.current.innerHTML, references, citationStyle, citationNumbers, suffixesAfterInsert);
    }
    onChange(sanitizeEditorHtml(editorRef.current?.innerHTML ?? ""));
    setCitationOpen(false);
    setCitationMode("parenthetical");
    setCitationLocator("");
    setCitationReferenceIds([]);
  }

  function addHangingList() {
    const content = hangingText.trim();
    if (!content) return;
    const indent = Math.min(3, Math.max(0.5, Number(listIndentCm) || 0.65));
    const hanging = Math.min(indent, Math.max(0.2, Number(listHangingCm) || 0.6));
    onAddHanging?.(content, { format: listFormat, indentCm: indent, hangingCm: hanging, fontFamily: listFontFamily, fontSizePt: Number(listFontSizePt), alignment: listAlignment, lineSpacing: Number(listLineSpacing), beforePt: Number(listBeforePt), afterPt: Number(listAfterPt) });
    setHangingText("");
  }

  function toggleHangingSettings() {
    setHangingOpen((open) => !open);
  }

  function reorderHangingItem(targetId) {
    const draggedId = draggedHangingItemRef.current;
    draggedHangingItemRef.current = null;
    if (!draggedId || draggedId === targetId) return;
    const reordered = [...hangingItems];
    const fromIndex = reordered.findIndex((item) => item.id === draggedId);
    const toIndex = reordered.findIndex((item) => item.id === targetId);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    onUpdateHangingItems?.(reordered);
  }

  return (
    <div className="rich-editor">
      <div className="rich-editor__toolbar" role="toolbar" aria-label="Format paragraf">
        <select aria-label="Jenis font teks terpilih" title="Jenis font teks terpilih" value={inlineFontFamily} onMouseDown={rememberTextSelection} onFocus={rememberTextSelection} onChange={(event) => { setInlineFontFamily(event.target.value); applyInlineTextStyle("fontFamily", event.target.value); }}><option>Times New Roman</option><option>Arial</option><option>Calibri</option><option>Cambria</option></select>
        <select aria-label="Ukuran font teks terpilih" title="Ukuran font teks terpilih" value={inlineFontSize} onMouseDown={rememberTextSelection} onFocus={rememberTextSelection} onChange={(event) => { setInlineFontSize(event.target.value); applyInlineTextStyle("fontSize", event.target.value); }}>{[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36].map((size) => <option key={size} value={size}>{size} pt</option>)}</select>
        {toolbar.map(([command, label, Icon]) => <button key={command} type="button" title={label} aria-label={label} onMouseDown={(event) => { rememberTextSelection(); event.preventDefault(); }} onClick={() => runCommand(command)}><Icon size={16} /></button>)}
        <span className="rich-editor__divider" />
        <button type="button" title="Sisipkan tautan" aria-label="Sisipkan tautan" onClick={() => setLinkOpen(!linkOpen)}><Link2 size={16} /></button>
        <button type="button" title="Sisipkan sitasi" aria-label="Sisipkan sitasi" disabled={!references.length} onMouseDown={(event) => event.preventDefault()} onClick={() => setCitationOpen(!citationOpen)}><Quote size={16} /></button>
        {citationOpen ? <div className="rich-editor__citation-form"><select aria-label="Bentuk sitasi" value={citationMode} onChange={(event) => setCitationMode(event.target.value)}><option value="parenthetical">Dalam kurung</option><option value="narrative">Naratif</option></select><input aria-label="Halaman atau lokator sitasi" value={citationLocator} maxLength={120} onChange={(event) => setCitationLocator(event.target.value)} placeholder="Halaman, mis. hlm. 24" /><div className="rich-editor__citation-select" role="group" aria-label="Pilih satu atau beberapa sumber">{references.map((reference) => <label key={reference.id}><input type="checkbox" checked={citationReferenceIds.includes(reference.id)} onChange={(event) => setCitationReferenceIds((current) => event.target.checked ? [...current, reference.id] : current.filter((id) => id !== reference.id))} />{formatInTextCitation(reference, citationStyle, citationNumbers[reference.id] ?? 1, { mode: citationMode, yearSuffixMap: citationYearSuffixes })} · {reference.title}</label>)}</div><button type="button" disabled={!citationReferenceIds.length} onClick={() => insertCitation(citationReferenceIds)}>Sisipkan sitasi</button><button type="button" onClick={() => { setCitationOpen(false); setCitationReferenceIds([]); }}>Tutup</button></div> : null}
        {linkOpen ? <span className="rich-editor__link-form"><input aria-label="URL tautan" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") insertLink(); }} /><button type="button" onClick={insertLink}>Sisipkan</button></span> : null}
      </div>
      <div
        ref={editorRef}
        className="rich-editor__surface"
        contentEditable
        suppressContentEditableWarning
        lang="id"
        spellCheck={true}
        role="textbox"
        aria-multiline="true"
        aria-label="Isi paragraf"
        data-placeholder="Tulis isi bagian di sini… Tekan Enter untuk membuat paragraf baru."
        onMouseUp={rememberTextSelection}
        onKeyUp={rememberTextSelection}
        style={{
          fontFamily: `"${documentSettings.typography.fontFamily}", serif`,
          fontSize: `${documentSettings.typography.bodyPt}pt`,
          fontWeight: documentSettings.typography.bodyBold ? 700 : 400,
          fontStyle: documentSettings.typography.bodyItalic ? "italic" : "normal",
          textIndent: `${getParagraphTextIndentCm(documentSettings.paragraph)}cm`,
          textAlign: documentSettings.paragraph.alignment ?? "justify",
          lineHeight: documentSettings.paragraph.lineSpacing,
          "--dc-first-indent": `${getParagraphTextIndentCm(documentSettings.paragraph)}cm`,
          "--dc-left-indent": `${documentSettings.paragraph.leftIndentCm}cm`,
          "--dc-right-indent": `${documentSettings.paragraph.rightIndentCm}cm`,
          "--dc-before-spacing": `${documentSettings.paragraph.beforePt}pt`,
          "--dc-after-spacing": `${documentSettings.paragraph.afterPt}pt`,
        }}
        onInput={() => { applyHangingStyles(editorRef.current); rememberTextSelection(); onChange(sanitizeEditorHtml(editorRef.current?.innerHTML ?? "")); }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          if (event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            const editor = editorRef.current;
            const selection = window.getSelection();
            if (!editor || !selection?.rangeCount) return;
            const range = selection.getRangeAt(0);
            if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return;
            range.deleteContents();
            const lineBreak = window.document.createElement("br");
            range.insertNode(lineBreak);
            range.setStartAfter(lineBreak);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            onChange(sanitizeEditorHtml(editor.innerHTML));
            return;
          }
          if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
          event.preventDefault();
          const editor = editorRef.current;
          const selection = window.getSelection();
          if (!editor || !selection?.rangeCount) return;
          const range = selection.getRangeAt(0);
          if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return;
          range.deleteContents();
          range.collapse(true);
          const beforeRange = window.document.createRange();
          beforeRange.selectNodeContents(editor);
          beforeRange.setEnd(range.startContainer, range.startOffset);
          const before = window.document.createElement("div");
          before.append(beforeRange.cloneContents());
          const afterRange = window.document.createRange();
          afterRange.selectNodeContents(editor);
          afterRange.setStart(range.startContainer, range.startOffset);
          const after = window.document.createElement("div");
          after.append(afterRange.extractContents());
          onSplit(sanitizeEditorHtml(before.innerHTML), sanitizeEditorHtml(after.innerHTML));
        }}
        onBlur={(event) => { if (event.relatedTarget?.closest?.(".rich-editor__toolbar")) return; if (editorRef.current) editorRef.current.innerHTML = sanitizeEditorHtml(renderCitationHtml(editorRef.current.innerHTML, references, citationStyle, citationNumbers, citationYearSuffixes)); }}
        onPaste={(event) => {
          const imageFile = Array.from(event.clipboardData.items)
            .find((item) => item.type.startsWith("image/"))?.getAsFile();
          if (imageFile) {
            event.preventDefault();
            onPasteImage(imageFile);
            return;
          }
          event.preventDefault();
          const pastedHtml = sanitizeEditorHtml(event.clipboardData.getData("text/html"));
          if (pastedHtml) window.document.execCommand("insertHTML", false, pastedHtml);
          else window.document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
          onChange(sanitizeEditorHtml(editorRef.current?.innerHTML ?? ""));
        }}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.items).some((item) => item.type.startsWith("image/"))) event.preventDefault();
        }}
        onDrop={(event) => {
          const imageFile = Array.from(event.dataTransfer.files).find((file) => file.type.startsWith("image/"));
          if (imageFile) {
            event.preventDefault();
            onPasteImage(imageFile);
          }
        }}
      />
      {inlineFormatNotice ? <p className="content-editor__helper" role="status">{inlineFormatNotice}</p> : null}
      <section className="rich-editor__hanging-section" aria-label="Pengaturan hanging">
        <div className="rich-editor__hanging-heading">
            <div><strong>Hanging</strong><small>Item tersimpan di paragraf ini, terpisah dari outline</small></div>
          <button type="button" className="rich-editor__hanging-add" aria-expanded={hangingOpen} onClick={toggleHangingSettings}><Plus size={15} /> Tambah hanging</button>
        </div>
        {hangingOpen ? <div className="rich-editor__hanging-form" role="group" aria-label="Pengaturan hanging indent">
          {hangingItems.length ? <div className="rich-editor__hanging-items" aria-label="Daftar item hanging">{hangingItems.map((item, index) => <div className="rich-editor__hanging-item" key={item.id} draggable onDragStart={(event) => { draggedHangingItemRef.current = item.id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); reorderHangingItem(item.id); }} onDragEnd={() => { draggedHangingItemRef.current = null; }}><span className="rich-editor__hanging-grip" title="Seret untuk mengubah urutan"><GripVertical size={15} /></span><span className="rich-editor__hanging-number">{formatHangingMarker(listFormat, index + 1)}{listFormat === "bullet" ? "" : "."}</span><input aria-label={`Teks hanging ${index + 1}`} value={item.text} onChange={(event) => onUpdateHangingItems?.(hangingItems.map((current) => current.id === item.id ? { ...current, text: event.target.value } : current))} /><button type="button" aria-label={`Hapus hanging ${index + 1}`} onClick={() => onUpdateHangingItems?.(hangingItems.filter((current) => current.id !== item.id))}><Trash2 size={14} /></button></div>)}</div> : null}
          <label className="rich-editor__hanging-text-label">Isi hanging<textarea rows={3} value={hangingText} onChange={(event) => setHangingText(event.target.value)} placeholder="Tulis isi item hanging di sini…" /></label>
          <label>Format penomoran<select value={listFormat} onChange={(event) => { const format = event.target.value; setListFormat(format); onUpdateHangingSettings?.({ format }); }}><option value="decimal">Angka (1, 2, 3)</option><option value="lower-alpha">Huruf kecil (a, b, c)</option><option value="upper-alpha">Huruf besar (A, B, C)</option><option value="bullet">Titik (•)</option></select></label>
          <label>Jarak teks dari margin (cm)<input type="number" min="0.5" max="3" step="0.05" value={listIndentCm} onChange={(event) => { const indentCm = event.target.value; setListIndentCm(indentCm); if (Number(indentCm) >= 0.5) onUpdateHangingSettings?.({ indentCm: Number(indentCm) }); }} /></label>
          <label>Jarak hanging (cm)<input type="number" min="0.2" max="2" step="0.05" value={listHangingCm} onChange={(event) => { const hangingCm = event.target.value; setListHangingCm(hangingCm); if (Number(hangingCm) >= 0.2) onUpdateHangingSettings?.({ hangingCm: Number(hangingCm) }); }} /></label>
          <div className="rich-editor__hanging-format-heading"><strong>Format isi hanging</strong><small>Pengaturan ini berdiri sendiri dan tidak mengubah format paragraf utama.</small></div>
          <label>Jenis huruf<select value={listFontFamily} onChange={(event) => { setListFontFamily(event.target.value); onUpdateHangingSettings?.({ fontFamily: event.target.value }); }}>{fonts.map((font) => <option key={font} value={font}>{font}</option>)}</select></label>
          <label>Ukuran huruf (pt)<input type="number" min="6" max="36" step="0.5" value={listFontSizePt} onChange={(event) => { const value = event.target.value; setListFontSizePt(value); if (Number(value) >= 6 && Number(value) <= 36) onUpdateHangingSettings?.({ fontSizePt: Number(value) }); }} /></label>
          <label>Perataan<select value={listAlignment} onChange={(event) => { setListAlignment(event.target.value); onUpdateHangingSettings?.({ alignment: event.target.value }); }}><option value="justify">Rata kiri-kanan</option><option value="left">Rata kiri</option><option value="center">Tengah</option><option value="right">Rata kanan</option></select></label>
          <label>Jarak baris<input type="number" min="1" max="3" step="0.1" value={listLineSpacing} onChange={(event) => { const value = event.target.value; setListLineSpacing(value); if (Number(value) >= 1 && Number(value) <= 3) onUpdateHangingSettings?.({ lineSpacing: Number(value) }); }} /></label>
          <label>Jarak sebelum (pt)<input type="number" min="0" max="72" step="1" value={listBeforePt} onChange={(event) => { const value = event.target.value; setListBeforePt(value); if (value !== "" && Number(value) >= 0 && Number(value) <= 72) onUpdateHangingSettings?.({ beforePt: Number(value) }); }} /></label>
          <label>Jarak sesudah (pt)<input type="number" min="0" max="72" step="1" value={listAfterPt} onChange={(event) => { const value = event.target.value; setListAfterPt(value); if (value !== "" && Number(value) >= 0 && Number(value) <= 72) onUpdateHangingSettings?.({ afterPt: Number(value) }); }} /></label>
          <button type="button" className="rich-editor__hanging-apply" disabled={!hangingText.trim()} onMouseDown={(event) => event.preventDefault()} onClick={addHangingList}><Plus size={14} /> Tambahkan item</button>
        </div> : null}
      </section>
    </div>
  );
}

function tableFromData(tableData) {
  const rows = Array.isArray(tableData?.rows) && tableData.rows.length ? tableData.rows : [["", ""], ["", ""]];
  const columns = Math.max(1, ...rows.map((row) => row.length));
  return rows.map((row) => Array.from({ length: columns }, (_, index) => String(row[index] ?? "")));
}

export default function ContentEditorPanel({ customPresets = [], onSaveCustomPreset, onDeleteCustomPreset, onSaveNow }) {
  const document = useDocumentStore((state) => state.document);
  const selectedNodeId = useDocumentStore((state) => state.selectedNodeId);
  const updateNode = useDocumentStore((state) => state.updateNode);
  const addNodeAtSelection = useDocumentStore((state) => state.addNodeAtSelection);
  const splitParagraph = useDocumentStore((state) => state.splitParagraph);
  const updateSettings = useDocumentStore((state) => state.updateSettings);
  const updateReferences = useDocumentStore((state) => state.updateReferences);
  const setCitationStyle = useDocumentStore((state) => state.setCitationStyle);
  const citationStyle = document?.citationStyle ?? "author-date";
  const citationNumbers = useMemo(() => getCitationNumberMap(document?.sections ?? []), [document]);
  const usedReferences = useMemo(() => getUsedReferences(document?.sections, document?.references, citationStyle), [document, citationStyle]);
  const usedReferenceIds = useMemo(() => new Set(usedReferences.map((reference) => reference.id)), [usedReferences]);
  const citationYearSuffixes = useMemo(() => getAuthorDateYearSuffixMap(usedReferences), [usedReferences]);
  const fileInputRef = useRef(null);
  const tableEditorRef = useRef(null);
  const [uploadError, setUploadError] = useState("");
  const [customPresetName, setCustomPresetName] = useState("");
  const [presetError, setPresetError] = useState("");
  const [activeCell, setActiveCell] = useState(null);
  const [referenceDraft, setReferenceDraft] = useState(EMPTY_REFERENCE_DRAFT);
  const [editingReferenceId, setEditingReferenceId] = useState(null);
  const [referenceError, setReferenceError] = useState("");
  const [referenceImportMessage, setReferenceImportMessage] = useState("");
  const referenceFileInput = useRef(null);
  const formatPresetInputRef = useRef(null);
  const [formatPresetDraft, setFormatPresetDraft] = useState(null);
  const [formatPresetBusy, setFormatPresetBusy] = useState(false);
  if (!document) return null;
  const node = findNode(document.sections, selectedNodeId);
  const mediaLabels = getMediaLabels(document.sections);
  const headingLabels = getHeadingLabels(document.sections);
  const table = node?.type === "table" ? tableFromData(node.tableData) : [];
  const activeTableCell = activeCell?.nodeId === node?.id ? activeCell : null;
  const isHeadingNode = ["chapter", "section", "subsection"].includes(node?.type);
  const editableTitle = isHeadingNode ? getEditableHeadingTitle(node) : node?.title ?? "";
  const writingGuidance = getWritingGuidance(node);
  const referencePreview = {
    ...referenceDraft,
    journal: referenceDraft.sourceType === "journal" ? referenceDraft.source : "",
    siteName: referenceDraft.sourceType === "website" ? referenceDraft.source : "",
    containerTitle: ["conference", "chapter"].includes(referenceDraft.sourceType) ? referenceDraft.source : "",
    institution: ["thesis", "report"].includes(referenceDraft.sourceType) ? referenceDraft.source : "",
    publisher: ["conference", "chapter"].includes(referenceDraft.sourceType) ? referenceDraft.publisher : referenceDraft.sourceType === "book" ? referenceDraft.publisher || referenceDraft.source : "",
  };
  const referencePreviewParts = referenceDraft.title.trim() || referenceDraft.authors.trim()
    ? formatReferenceParts(referencePreview, citationStyle)
    : [];

  function editReference(reference) {
    setReferenceDraft({
      sourceType: reference.sourceType ?? "book",
      authors: reference.authors ?? "",
      year: reference.year ?? "",
      title: reference.title ?? "",
      source: [reference.journal, reference.siteName, reference.containerTitle, reference.institution, reference.publisher, reference.source].find((value) => String(value ?? "").trim()) ?? "",
      publisher: reference.publisher ?? "",
      editor: reference.editor ?? "",
      volume: reference.volume ?? "",
      issue: reference.issue ?? "",
      pages: reference.pages ?? "",
      institution: reference.institution ?? (["thesis", "report"].includes(reference.sourceType) ? reference.source ?? "" : ""),
      doi: reference.doi ?? "",
      url: reference.url ?? "",
    });
    setEditingReferenceId(reference.id);
    setReferenceError("");
  }

  function cancelReferenceEdit() {
    setEditingReferenceId(null);
    setReferenceDraft(EMPTY_REFERENCE_DRAFT);
    setReferenceError("");
  }

  function changeReferenceType(sourceType) {
    setReferenceDraft((current) => current.sourceType === sourceType ? current : {
      ...current,
      sourceType,
      source: "",
      publisher: "",
      editor: "",
      institution: "",
      volume: ["journal", "conference", "chapter"].includes(sourceType) ? current.volume : "",
      issue: ["journal", "conference", "chapter"].includes(sourceType) ? current.issue : "",
      pages: ["journal", "conference", "chapter"].includes(sourceType) ? current.pages : "",
      url: sourceType === "website" ? current.url : "",
    });
    setReferenceError("");
  }

  function saveReference() {
    const reference = Object.fromEntries(Object.entries(referenceDraft).map(([key, value]) => [key, value.trim()]));
    if (!reference.authors || !reference.year || !reference.title) { setReferenceError("Isi penulis, tahun, dan judul sumber terlebih dahulu."); return; }
    if (["journal", "website", "thesis", "report", "conference", "chapter"].includes(reference.sourceType) && !reference.source) { setReferenceError("Isi nama jurnal, situs, institusi, prosiding, atau buku sesuai jenis sumber."); return; }
    if (["conference", "chapter"].includes(reference.sourceType) && !reference.publisher) { setReferenceError("Isi penerbit untuk prosiding atau buku sumber."); return; }
    if (reference.sourceType === "website" && !reference.url) { setReferenceError("Isi URL laman untuk sumber web."); return; }
    if (reference.url && !/^(https?:\/\/)/i.test(reference.url)) { setReferenceError("URL laman harus diawali https:// atau http://."); return; }
    if (reference.doi && !/^(?:10\.\d{4,9}\/|https?:\/\/doi\.org\/)/i.test(reference.doi)) { setReferenceError("DOI harus berbentuk 10.xxxx/... atau tautan https://doi.org/..."); return; }
    if (reference.doi) reference.doi = reference.doi.replace(/^https?:\/\/doi\.org\//i, "");
    const id = editingReferenceId ?? createId();
    const savedReference = {
      id,
      sourceType: reference.sourceType,
      authors: reference.authors,
      year: reference.year,
      title: reference.title,
      volume: reference.volume,
      issue: reference.issue,
      pages: reference.pages,
      doi: reference.doi,
      url: reference.url,
    };
    if (reference.sourceType === "journal") Object.assign(savedReference, { source: reference.source, journal: reference.source });
    else if (reference.sourceType === "website") Object.assign(savedReference, { source: reference.source, siteName: reference.source });
    else if (["thesis", "report"].includes(reference.sourceType)) Object.assign(savedReference, { source: reference.source, institution: reference.source });
    else if (["conference", "chapter"].includes(reference.sourceType)) Object.assign(savedReference, { source: reference.source, containerTitle: reference.source, publisher: reference.publisher, editor: reference.editor });
    else Object.assign(savedReference, { source: reference.publisher || reference.source, publisher: reference.publisher || reference.source });
    const nextReferences = editingReferenceId
      ? (settings.references ?? []).map((current) => current.id === editingReferenceId ? savedReference : current)
      : [...(settings.references ?? []), savedReference];
    updateReferences(nextReferences);
    cancelReferenceEdit();
  }

  async function importBibTeX(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setReferenceImportMessage("Berkas BibTeX terlalu besar. Batas ukuran adalah 5 MB.");
      return;
    }
    try {
      const sourceText = await file.text();
      const parsed = /\.ris$/i.test(file.name) ? parseRIS(sourceText) : parseBibTeX(sourceText);
      const existingReferences = settings.references ?? [];
      const knownKeys = new Set(existingReferences.flatMap(getReferenceIdentityKeys));
      const imported = [];
      let duplicates = 0;
      parsed.references.forEach((reference) => {
        const keys = getReferenceIdentityKeys(reference);
        if (keys.some((key) => knownKeys.has(key))) { duplicates += 1; return; }
        keys.forEach((key) => knownKeys.add(key));
        imported.push({ ...reference, id: createId() });
      });
      if (imported.length) updateReferences([...existingReferences, ...imported]);
      const notes = [];
      if (duplicates) notes.push(`${duplicates} duplikat dilewati`);
      if (parsed.skipped) notes.push(`${parsed.skipped} entri tanpa judul dilewati`);
      setReferenceImportMessage(imported.length
        ? `${imported.length} sumber berhasil diimpor${notes.length ? `; ${notes.join("; ")}` : ""}.`
        : `Tidak ada sumber baru yang diimpor${notes.length ? `; ${notes.join("; ")}` : ". Periksa apakah berkas berisi entri BibTeX dengan judul."}`);
    } catch {
      setReferenceImportMessage("Berkas tidak dapat dibaca. Pilih berkas BibTeX (.bib) atau RIS (.ris) yang valid.");
    }
  }

  function exportReferenceFile(format) {
    const references = settings.references ?? [];
    if (!references.length) {
      setReferenceImportMessage("Belum ada sumber untuk diekspor.");
      return;
    }
    const content = format === "ris" ? formatReferencesAsRIS(references) : formatReferencesAsBibTeX(references);
    const blob = new Blob([content], { type: format === "ris" ? "application/x-research-info-systems;charset=utf-8" : "application/x-bibtex;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    const baseName = String(document.title || "doccraft").normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "doccraft";
    anchor.href = url;
    anchor.download = `${baseName}-referensi.${format}`;
    window.document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    setReferenceImportMessage(`${references.length} sumber diekspor sebagai .${format}.`);
  }

  function addParagraph() {
    addNodeAtSelection("paragraph", { title: "Paragraf baru" }, selectedNodeId);
  }

  function addHangingNode(text, settings) {
    if (!node) return;
    updateNode(node.id, {
      hangingItems: [...(node.hangingItems ?? []), { id: createId(), text }],
      hangingSettings: { ...node.hangingSettings, ...settings },
    });
    onSaveNow?.();
  }

  function updateHangingItems(items) {
    if (node) updateNode(node.id, { hangingItems: items });
  }

  function updateHangingSettings(changes) {
    if (!node) return;
    updateNode(node.id, { hangingSettings: { format: "decimal", indentCm: 0.65, hangingCm: 0.6, fontFamily: settings.typography.fontFamily, fontSizePt: settings.typography.bodyPt, alignment: settings.paragraph.alignment ?? "justify", lineSpacing: settings.paragraph.lineSpacing, beforePt: settings.paragraph.beforePt, afterPt: settings.paragraph.afterPt, ...node.hangingSettings, ...changes } });
  }

  function addTable() {
    addNodeAtSelection("table", { title: "Tabel baru", caption: "", tableData: { rows: [["", ""], ["", ""]] } }, selectedNodeId);
  }

  function addPageBreak() {
    addNodeAtSelection("pageBreak", { title: "Pemisah halaman" }, selectedNodeId);
  }

  function addCodeBlock() {
    addNodeAtSelection("codeBlock", { title: "Blok kode", codeLanguage: "auto", codeFontSizePt: 9, codeTheme: "dark", content: "" }, selectedNodeId);
  }

  function updateTableRows(rows, changes = {}) {
    if (!node || node.type !== "table") return;
    updateNode(node.id, { tableData: { ...node.tableData, rows, ...changes } });
  }

  function focusTableCell(row, column) {
    if (!node || node.type !== "table") return;
    const cell = { nodeId: node.id, row, column };
    setActiveCell(cell);
    window.setTimeout(() => tableEditorRef.current?.querySelector(`[data-table-cell="${row}-${column}"]`)?.focus(), 0);
  }

  function insertTableRow(direction) {
    if (!activeTableCell) return;
    const index = direction === "above" ? activeTableCell.row : activeTableCell.row + 1;
    const rows = table.map((row) => [...row]);
    rows.splice(index, 0, Array.from({ length: table[0]?.length ?? 1 }, () => ""));
    updateTableRows(rows);
    focusTableCell(index, activeTableCell.column);
  }

  function duplicateTableRow() {
    if (!activeTableCell) return;
    const index = activeTableCell.row + 1;
    const rows = table.map((row) => [...row]);
    rows.splice(index, 0, [...table[activeTableCell.row]]);
    updateTableRows(rows);
    focusTableCell(index, activeTableCell.column);
  }

  function moveTableRow(direction) {
    if (!activeTableCell) return;
    const target = activeTableCell.row + direction;
    if (target < 0 || target >= table.length) return;
    const rows = table.map((row) => [...row]);
    [rows[activeTableCell.row], rows[target]] = [rows[target], rows[activeTableCell.row]];
    updateTableRows(rows);
    focusTableCell(target, activeTableCell.column);
  }

  function deleteTableRow() {
    if (!activeTableCell || table.length <= 1) return;
    const deletedIndex = activeTableCell.row;
    const rows = table.filter((_, index) => index !== deletedIndex);
    updateTableRows(rows);
    focusTableCell(Math.min(deletedIndex, rows.length - 1), activeTableCell.column);
  }

  function insertTableColumn(direction) {
    if (!activeTableCell) return;
    const index = direction === "left" ? activeTableCell.column : activeTableCell.column + 1;
    const rows = table.map((row) => {
      const next = [...row];
      next.splice(index, 0, "");
      return next;
    });
    updateTableRows(rows);
    focusTableCell(activeTableCell.row, index);
  }

  function duplicateTableColumn() {
    if (!activeTableCell) return;
    const index = activeTableCell.column + 1;
    const rows = table.map((row) => {
      const next = [...row];
      next.splice(index, 0, row[activeTableCell.column]);
      return next;
    });
    updateTableRows(rows);
    focusTableCell(activeTableCell.row, index);
  }

  function moveTableColumn(direction) {
    if (!activeTableCell) return;
    const target = activeTableCell.column + direction;
    if (target < 0 || target >= (table[0]?.length ?? 0)) return;
    const rows = table.map((row) => {
      const next = [...row];
      [next[activeTableCell.column], next[target]] = [next[target], next[activeTableCell.column]];
      return next;
    });
    updateTableRows(rows);
    focusTableCell(activeTableCell.row, target);
  }

  function clearTableCell() {
    if (!activeTableCell) return;
    const rows = table.map((row) => [...row]);
    rows[activeTableCell.row][activeTableCell.column] = "";
    updateTableRows(rows);
    focusTableCell(activeTableCell.row, activeTableCell.column);
  }

  function deleteTableColumn() {
    if (!activeTableCell || (table[0]?.length ?? 0) <= 1) return;
    const deletedIndex = activeTableCell.column;
    const rows = table.map((row) => row.filter((_, index) => index !== deletedIndex));
    updateTableRows(rows);
    setActiveCell({ ...activeTableCell, column: Math.min(deletedIndex, rows[0].length - 1) });
  }

  function handleUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadError("");
    if (!file.type.startsWith("image/")) { setUploadError("Pilih berkas gambar (PNG, JPG, GIF, atau WebP)."); return; }
    if (file.size > 5 * 1024 * 1024) { setUploadError("Ukuran gambar maksimal 5 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const asset = { name: file.name, mimeType: file.type, dataUrl: reader.result };
      if (node?.type === "image") updateNode(node.id, { title: file.name, asset });
      else addNodeAtSelection("image", { title: file.name, caption: "", asset }, selectedNodeId);
    };
    reader.onerror = () => setUploadError("Berkas gambar gagal dibaca.");
    reader.readAsDataURL(file);
  }

  function handlePasteImage(file) {
    if (!file?.type.startsWith("image/")) { setUploadError("Item yang ditempel bukan berkas gambar."); return; }
    if (file.size > 5 * 1024 * 1024) { setUploadError("Ukuran gambar maksimal 5 MB."); return; }
    setUploadError("");
    const reader = new FileReader();
    reader.onload = () => {
      const name = file.name || "Gambar dari clipboard";
      addNodeAtSelection("image", { title: name, caption: "", asset: { name, mimeType: file.type, dataUrl: reader.result } }, selectedNodeId);
    };
    reader.onerror = () => setUploadError("Gambar dari clipboard gagal dibaca.");
    reader.readAsDataURL(file);
  }

  function saveCurrentPreset() {
    setPresetError("");
    try {
      onSaveCustomPreset?.(customPresetName);
      setCustomPresetName("");
    } catch (error) {
      setPresetError(error instanceof Error ? error.message : "Preset gagal disimpan.");
    }
  }

  async function readFormatPreset(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPresetError("");
    setFormatPresetBusy(true);
    try {
      const imported = /\.pdf$/i.test(file.name)
        ? await formatPresetFromPdfFile(file)
        : /\.docx$/i.test(file.name)
          ? await formatPresetFromDocxFile(file)
          : null;
      if (!imported) throw new Error("Pilih berkas .docx atau .pdf.");
      setFormatPresetDraft({ ...imported, name: file.name.replace(/\.(docx|pdf)$/i, "").slice(0, 40) });
    } catch (error) {
      setPresetError(error instanceof Error ? error.message : "Format dokumen tidak dapat dibaca.");
    } finally {
      setFormatPresetBusy(false);
    }
  }

  function updateFormatPreset(group, key, value) {
    setFormatPresetDraft((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));
  }

  function updateFormatPresetHeading(type, key, value) {
    setFormatPresetDraft((current) => ({
      ...current,
      outlineStyles: {
        ...current.outlineStyles,
        [type]: { ...getOutlineStyle(current, type), [key]: value },
      },
    }));
  }

  function saveImportedFormatPreset() {
    if (!formatPresetDraft) return;
    try {
      const configuration = { paper: formatPresetDraft.paper, margins: formatPresetDraft.margins, typography: formatPresetDraft.typography, paragraph: formatPresetDraft.paragraph, outlineStyles: formatPresetDraft.outlineStyles };
      onSaveCustomPreset?.(formatPresetDraft.name, configuration);
      setCustomPresetName("");
      setFormatPresetDraft(null);
      setPresetError("");
    } catch (error) {
      setPresetError(error instanceof Error ? error.message : "Preset gagal disimpan.");
    }
  }

  const settings = document;
  const frontMatterProfile = { ...FRONT_MATTER_PROFILE_DEFAULTS, ...(settings.frontMatterProfile ?? {}) };
  const updateFrontMatterProfile = (key, value) => updateSettings("frontMatterProfile", { [key]: value });
  const handleFrontMatterLogo = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { setUploadError("Logo harus berupa berkas gambar."); return; }
    if (file.size > 5 * 1024 * 1024) { setUploadError("Ukuran logo maksimal 5 MB."); return; }
    setUploadError("");
    const reader = new FileReader();
    reader.onload = () => updateFrontMatterProfile("logoDataUrl", reader.result);
    reader.onerror = () => setUploadError("Logo kampus gagal dibaca.");
    reader.readAsDataURL(file);
  };
  const sharedFormatType = ["chapter", "section", "subsection", "paragraph"].includes(node?.type) ? node.type : null;
  const sharedFormat = sharedFormatType === "paragraph"
    ? { ...settings.paragraph, specialIndentType: settings.paragraph.specialIndentType ?? "firstLine", specialIndentCm: settings.paragraph.firstLineIndentCm, widowControl: settings.paragraph.widowControl ?? true, keepLinesTogether: settings.paragraph.keepLinesTogether ?? false, keepWithNext: settings.paragraph.keepWithNext ?? false, pageBreakBefore: settings.paragraph.pageBreakBefore ?? false }
    : sharedFormatType ? getOutlineStyle(settings, sharedFormatType) : null;
  const sharedFormatLabel = sharedFormatType === "chapter" ? "semua judul bab" : sharedFormatType === "section" ? "semua sub-bab" : sharedFormatType === "subsection" ? "semua anak sub-bab" : "semua paragraf isi";
  const sharedHeadingLevel = sharedFormatType === "chapter" ? 1 : sharedFormatType === "section" ? 2 : sharedFormatType === "subsection" ? 3 : null;
  const sharedHeadingTextFormat = sharedHeadingLevel ? {
    fontFamily: sharedFormat.fontFamily || settings.typography.fontFamily,
    fontSizePt: sharedFormat.fontSizePt ?? settings.typography[`heading${sharedHeadingLevel}Pt`],
    bold: sharedFormat.bold ?? sharedFormatType !== "subsection",
    italic: sharedFormat.italic ?? sharedFormatType === "subsection",
  } : null;
  const sharedBodyTextFormat = sharedFormatType === "paragraph" ? {
    fontFamily: settings.typography.fontFamily,
    fontSizePt: settings.typography.bodyPt,
    bold: Boolean(settings.typography.bodyBold),
    italic: Boolean(settings.typography.bodyItalic),
  } : null;
  const updateSharedFormat = (changes) => {
    if (sharedFormatType === "paragraph") {
      const paragraphChanges = { ...changes };
      const typographyChanges = {};
      if (Object.hasOwn(paragraphChanges, "fontFamily")) { typographyChanges.fontFamily = paragraphChanges.fontFamily; delete paragraphChanges.fontFamily; }
      if (Object.hasOwn(paragraphChanges, "fontSizePt")) { typographyChanges.bodyPt = paragraphChanges.fontSizePt; delete paragraphChanges.fontSizePt; }
      if (Object.hasOwn(paragraphChanges, "bold")) { typographyChanges.bodyBold = paragraphChanges.bold; delete paragraphChanges.bold; }
      if (Object.hasOwn(paragraphChanges, "italic")) { typographyChanges.bodyItalic = paragraphChanges.italic; delete paragraphChanges.italic; }
      if (Object.keys(typographyChanges).length) updateSettings("typography", typographyChanges);
      if (Object.hasOwn(paragraphChanges, "specialIndentCm")) {
        paragraphChanges.firstLineIndentCm = paragraphChanges.specialIndentCm;
        delete paragraphChanges.specialIndentCm;
      }
      updateSettings("paragraph", paragraphChanges);
    } else if (sharedFormatType) {
      updateSettings("outlineStyles", { [sharedFormatType]: { ...getOutlineStyle(settings, sharedFormatType), ...changes } });
    }
  };
  const lineSpacingPreset = [1, 1.5, 2].includes(Number(settings.paragraph.lineSpacing))
    ? String(Number(settings.paragraph.lineSpacing))
    : "custom";
  const numericSetting = (group, key, label, step = "0.5") => <label className="editor-setting-field" key={`${group}-${key}`}>{label}<input type="number" min="0" step={step} value={settings[group][key]} onChange={(event) => updateSettings(group, { [key]: Math.max(0, Number(event.target.value)) })} /></label>;

  return (
    <section className="editor-panel editor-panel--content">
      <h1 className="content-editor__heading">{node ? `Edit: ${node.type === "titlePage" ? "Cover" : headingLabels[node.id] ?? node.title ?? node.type}` : "Content Editor"}</h1>
      {node ? <div className="content-editor__card">
        {node.type !== "titlePage" ? <><label className="editor-field-label" htmlFor="section-title">{isHeadingNode ? "Teks judul" : "Judul bagian"}</label>
        <input id="section-title" value={editableTitle} onChange={(event) => updateNode(node.id, { title: event.target.value })} placeholder="Judul bagian" className="editor-text-input" /></> : null}
        {isHeadingNode ? <p className="content-editor__helper">Nomor otomatis: {headingLabels[node.id]}</p> : null}
        {writingGuidance ? <aside className="writing-guidance" aria-label={writingGuidance.title}><div className="writing-guidance__header"><strong>{writingGuidance.title}</strong>{writingGuidance.wordCount !== undefined ? <span className={writingGuidance.outsideLimit ? "writing-guidance__count writing-guidance__count--outside" : "writing-guidance__count"}>{writingGuidance.wordCount} kata{writingGuidance.minWords || writingGuidance.maxWords ? ` · target ${writingGuidance.minWords ?? "…"}–${writingGuidance.maxWords ?? "…"}` : ""}{writingGuidance.outsideLimit ? " · di luar target" : ""}</span> : null}</div>{node.type === "abstract" ? <div className="writing-guidance__limits"><label>Minimum kata<input type="number" min="1" value={node.minWords ?? ""} onChange={(event) => updateNode(node.id, { minWords: event.target.value ? Math.max(1, Number(event.target.value)) : null })} placeholder="Opsional" /></label><label>Maksimum kata<input type="number" min="1" value={node.maxWords ?? ""} onChange={(event) => updateNode(node.id, { maxWords: event.target.value ? Math.max(1, Number(event.target.value)) : null })} placeholder="Opsional" /></label></div> : null}<ul>{writingGuidance.points.map((point) => <li key={point}>{point}</li>)}</ul></aside> : null}
        {node.type === "titlePage" ? <div className="title-page-fields">
          <div className="cover-editor__intro"><strong>Template cover skripsi</strong><p>Isi data utama dan unggah logo kampus. Data identitas yang sama juga dipakai oleh template halaman awal.</p></div>
          <div className="cover-editor__fields">
            {[["institution", "Nama kampus"], ["thesisTitle", "Judul skripsi"], ["year", "Tahun"], ["author", "Nama mahasiswa"], ["studentId", "NIM/NPM"]].map(([key, label]) => <label className="editor-field-label" key={key}>{label}<input className="editor-text-input" value={frontMatterProfile[key] ?? ""} onChange={(event) => updateFrontMatterProfile(key, event.target.value)} /></label>)}
          </div>
          <label className="editor-field-label">Logo/foto pada cover<input type="file" accept="image/*" onChange={handleFrontMatterLogo} /></label>
          <p className="content-editor__helper">Format gambar mengikuti template cover dan akan menggantikan tempat logo pada preview serta file ekspor. Maksimal 5 MB.</p>
          {frontMatterProfile.logoDataUrl ? <div className="cover-editor__logo-preview"><img src={frontMatterProfile.logoDataUrl} alt="Pratinjau logo cover" /><button type="button" className="button button--secondary" onClick={() => updateFrontMatterProfile("logoDataUrl", "")}>Hapus logo</button></div> : <div className="cover-editor__logo-placeholder">Tempat logo kampus</div>}
          <details className="cover-editor__optional"><summary>Detail tambahan cover</summary><div className="cover-editor__fields">{[["workType", "Jenis karya"], ["faculty", "Fakultas"], ["department", "Program studi"], ["concentration", "Konsentrasi"], ["programLevel", "Jenjang pendidikan"], ["city", "Kota"]].map(([key, label]) => <label className="editor-field-label" key={key}>{label}<input className="editor-text-input" value={frontMatterProfile[key] ?? ""} onChange={(event) => updateFrontMatterProfile(key, event.target.value)} /></label>)}</div></details>
        </div> : null}
        {node.type === "frontMatter" && node.frontMatterTemplate ? <div className="front-matter-template-editor">
          <details className="content-editor__card editor-settings">
            <summary>Identitas bersama halaman awal</summary>
            <p className="content-editor__helper">Perubahan di sini diterapkan pada semua halaman dalam paket template.</p>
            {[ ["thesisTitle", "Judul karya tulis"], ["workType", "Jenis karya"], ["author", "Nama penulis"], ["studentId", "NIM/NPM"], ["institution", "Nama kampus"], ["faculty", "Fakultas"], ["department", "Program studi"], ["concentration", "Konsentrasi"], ["programLevel", "Jenjang pendidikan"], ["city", "Kota"], ["year", "Tahun"] ].map(([key, label]) => <label className="editor-field-label editor-field-label--spaced" key={key}>{label}<input className="editor-text-input" value={frontMatterProfile[key] ?? ""} onChange={(event) => updateFrontMatterProfile(key, event.target.value)} /></label>)}
            <label className="editor-field-label editor-field-label--spaced">Logo kampus (opsional)<input type="file" accept="image/*" onChange={handleFrontMatterLogo} /></label>
            {frontMatterProfile.logoDataUrl ? <button type="button" className="button button--secondary" onClick={() => updateFrontMatterProfile("logoDataUrl", "")}>Hapus logo kampus</button> : null}
          </details>
          {FRONT_MATTER_TEMPLATE_FIELDS[node.frontMatterTemplate]?.map(([key, label]) => <label className="editor-field-label editor-field-label--spaced" key={key}>{label}<input className="editor-text-input" value={node.frontMatterData?.[key] ?? ""} onChange={(event) => updateNode(node.id, { frontMatterData: { ...node.frontMatterData, [key]: event.target.value } })} /></label>)}
          {node.frontMatterTemplate === "preface" ? <><label className="editor-field-label editor-field-label--spaced" htmlFor="section-content">Isi kata pengantar</label><RichTextEditor node={node} onChange={(content) => updateNode(node.id, { content })} onSplit={(first, second) => splitParagraph(node.id, first, second)} onPasteImage={handlePasteImage} onAddHanging={addHangingNode} hangingItems={node.hangingItems ?? []} onUpdateHangingItems={updateHangingItems} onUpdateHangingSettings={updateHangingSettings} documentSettings={settings} references={settings.references ?? []} usedReferences={usedReferences} citationStyle={citationStyle} citationNumbers={citationNumbers} citationYearSuffixes={citationYearSuffixes} /><details className="preface-signature-editor"><summary>Format tanda tangan</summary><p className="content-editor__helper">Blok tanda tangan akan ditampilkan di sisi kanan setelah isi kata pengantar.</p>{[["signatureCity", "Kota tempat tanda tangan", frontMatterProfile.city || "Kota"], ["signatureDate", "Tanggal tanda tangan", "Contoh: 19 Oktober 2026"], ["signatureName", "Nama penulis untuk tanda tangan", frontMatterProfile.author || "Nama penulis"]].map(([key, label, placeholder]) => <label className="editor-field-label editor-field-label--spaced" key={key}>{label}<input className="editor-text-input" placeholder={placeholder} value={node.frontMatterData?.[key] ?? ""} onChange={(event) => updateNode(node.id, { frontMatterData: { ...node.frontMatterData, [key]: event.target.value } })} /></label>)}</details></> : null}
          {node.frontMatterTemplate === "originality" ? <label className="editor-field-label editor-field-label--spaced">Isi pernyataan<textarea className="editor-text-input" rows={5} value={node.frontMatterData?.declarationText ?? "Saya yang bertanda tangan di bawah ini menyatakan bahwa tugas akhir ini merupakan karya tulis saya sendiri, bukan hasil tiruan atau plagiarisme, dan belum pernah diajukan untuk memperoleh gelar akademik di perguruan tinggi lain."} onChange={(event) => updateNode(node.id, { frontMatterData: { ...node.frontMatterData, declarationText: event.target.value } })} /></label> : null}
        </div> : null}
        {node.type === "abstract" ? <label className="editor-field-label editor-field-label--spaced" htmlFor="abstract-keywords">Kata kunci<input id="abstract-keywords" className="editor-text-input" value={node.keywords ?? ""} onChange={(event) => updateNode(node.id, { keywords: event.target.value })} placeholder="Contoh: sistem informasi; pendidikan; evaluasi" /></label> : null}
        {node.type === "codeBlock" ? <div className="code-block-editor">
          <p className="content-editor__helper">Kode disimpan sebagai teks biasa. Spasi, indentasi, dan baris baru dipertahankan saat ditampilkan dan diekspor.</p>
          <div className="media-image-settings"><label>Bahasa<select value={node.codeLanguage === "auto" ? "auto" : resolveCodeLanguage(node.codeLanguage, node.content) === "text" ? "plain" : resolveCodeLanguage(node.codeLanguage, node.content)} onChange={(event) => updateNode(node.id, { codeLanguage: event.target.value })}><option value="auto">Deteksi otomatis</option><option value="plain">Teks biasa (tanpa warna)</option><option value="javascript">JavaScript</option><option value="typescript">TypeScript</option><option value="python">Python</option><option value="java">Java</option><option value="php">PHP</option><option value="sql">SQL</option><option value="html">HTML</option><option value="css">CSS</option><option value="c">C</option><option value="cpp">C++</option><option value="csharp">C#</option></select></label><label>Ukuran huruf: {node.codeFontSizePt ?? 9} pt<input type="range" min="7" max="14" step="1" value={node.codeFontSizePt ?? 9} onChange={(event) => updateNode(node.id, { codeFontSizePt: Number(event.target.value) })} /></label></div>
          <div className="media-image-settings"><label>Bahasa<select value={node.codeLanguage === "auto" ? "auto" : resolveCodeLanguage(node.codeLanguage, node.content) === "text" ? "plain" : resolveCodeLanguage(node.codeLanguage, node.content)} onChange={(event) => updateNode(node.id, { codeLanguage: event.target.value })}><option value="auto">Deteksi otomatis</option><option value="plain">Teks biasa (tanpa warna)</option><option value="javascript">JavaScript</option><option value="typescript">TypeScript</option><option value="python">Python</option><option value="java">Java</option><option value="php">PHP</option><option value="sql">SQL</option><option value="html">HTML</option><option value="css">CSS</option><option value="c">C</option><option value="cpp">C++</option><option value="csharp">C#</option></select></label><label>Ukuran huruf: {node.codeFontSizePt ?? 9} pt<input type="range" min="7" max="14" step="1" value={node.codeFontSizePt ?? 9} onChange={(event) => updateNode(node.id, { codeFontSizePt: Number(event.target.value) })} /></label></div>
          <label className="editor-field-label editor-field-label--spaced">Tema latar<select value={node.codeTheme ?? "dark"} onChange={(event) => updateNode(node.id, { codeTheme: event.target.value })}><option value="dark">Dark</option><option value="light">Light</option></select></label>
          <label className="editor-field-label editor-field-label--spaced" htmlFor="code-block-content">Kode</label><HighlightedCodeEditor value={node.content ?? ""} language={node.codeLanguage ?? "text"} theme={node.codeTheme ?? "dark"} onChange={(content) => updateNode(node.id, { content })} />
        </div> : null}
        {node.type === "image" || node.type === "table" ? <>
          <label className="editor-field-label editor-field-label--spaced" htmlFor="media-caption">Keterangan</label>
          <input id="media-caption" value={node.caption ?? ""} onChange={(event) => updateNode(node.id, { caption: event.target.value })} placeholder="Tulis keterangan gambar/tabel" className="editor-text-input" />
          <p className="media-number-label">{mediaLabels[node.id]}</p>
          {node.type === "image" ? <>
            <label className="editor-field-label editor-field-label--spaced" htmlFor="image-alt-text">Teks alternatif gambar</label>
            <input id="image-alt-text" value={node.altText ?? ""} onChange={(event) => updateNode(node.id, { altText: event.target.value })} placeholder="Jelaskan isi gambar untuk pembaca layar" className="editor-text-input" />
            <div className="media-image-settings">
              <label>Lebar gambar: {node.widthPct ?? 80}%<input type="range" min="20" max="100" step="5" value={node.widthPct ?? 80} onChange={(event) => updateNode(node.id, { widthPct: Number(event.target.value) })} /></label>
              <label>Perataan<select value={node.alignment ?? "center"} onChange={(event) => updateNode(node.id, { alignment: event.target.value })}><option value="left">Kiri</option><option value="center">Tengah</option><option value="right">Kanan</option></select></label>
            </div>
            <div className="media-preview" style={{ textAlign: node.alignment ?? "center" }}>{node.asset?.dataUrl ? <Image src={node.asset.dataUrl} alt={node.altText || node.caption || node.title || "Gambar dokumen"} width={1200} height={900} unoptimized style={{ width: `${node.widthPct ?? 80}%`, marginLeft: node.alignment === "left" ? 0 : "auto", marginRight: node.alignment === "right" ? 0 : "auto" }} /> : <p>Belum ada gambar. Gunakan tombol Sisipkan Gambar di bawah.</p>}</div>
            {node.asset?.dataUrl ? <button type="button" className="button button--secondary media-image-remove" onClick={() => updateNode(node.id, { asset: null })}>Lepas gambar dari elemen</button> : null}
          </> : <>
            <label className="settings-toggle table-header-toggle"><span><strong>Baris pertama adalah kepala tabel</strong><small>Baris ini ditebalkan dan diulang di setiap halaman Word.</small></span><input type="checkbox" checked={Boolean(node.tableData?.hasHeaderRow)} onChange={(event) => updateTableRows(table, { hasHeaderRow: event.target.checked })} /></label>
            <div className="table-editor-wrap" ref={tableEditorRef}><table className="table-editor"><tbody>{table.map((row, rowIndex) => <tr key={`r-${rowIndex}`}>{row.map((cell, colIndex) => <td key={`c-${colIndex}`}><input data-table-cell={`${rowIndex}-${colIndex}`} aria-label={`Baris ${rowIndex + 1}, kolom ${colIndex + 1}`} value={cell} onFocus={() => setActiveCell({ nodeId: node.id, row: rowIndex, column: colIndex })} onChange={(event) => { const rows = table.map((r) => [...r]); rows[rowIndex][colIndex] = event.target.value; updateTableRows(rows); }} onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                const nextRow = rowIndex + 1;
                if (nextRow >= table.length) updateTableRows([...table.map((r) => [...r]), Array.from({ length: table[0]?.length ?? 1 }, () => "")]);
                focusTableCell(nextRow, colIndex);
              } else if (event.key === "Tab" && !event.shiftKey && rowIndex === table.length - 1 && colIndex === row.length - 1) {
                event.preventDefault();
                updateTableRows([...table.map((r) => [...r]), Array.from({ length: table[0]?.length ?? 1 }, () => "")]);
                focusTableCell(table.length, 0);
              }
            }} /></td>)}</tr>)}</tbody></table></div>
            <div className="media-table-actions">
              <button type="button" className="button button--secondary" disabled={!activeTableCell} onClick={() => insertTableRow("above")}>Baris di atas</button>
              <button type="button" className="button button--secondary" disabled={!activeTableCell} onClick={() => insertTableRow("below")}>Baris di bawah</button>
              <button type="button" className="button button--secondary" disabled={!activeTableCell} onClick={duplicateTableRow}>Duplikasi baris</button>
              <button type="button" className="button button--secondary" disabled={!activeTableCell || activeTableCell.row === 0} onClick={() => moveTableRow(-1)}>Naikkan baris</button>
              <button type="button" className="button button--secondary" disabled={!activeTableCell || activeTableCell.row === table.length - 1} onClick={() => moveTableRow(1)}>Turunkan baris</button>
              <button type="button" className="button button--secondary" disabled={!activeTableCell || table.length <= 1} onClick={deleteTableRow}>Hapus baris terpilih</button>
              <button type="button" className="button button--secondary" disabled={!activeTableCell} onClick={() => insertTableColumn("left")}>Kolom di kiri</button>
              <button type="button" className="button button--secondary" disabled={!activeTableCell} onClick={() => insertTableColumn("right")}>Kolom di kanan</button>
              <button type="button" className="button button--secondary" disabled={!activeTableCell} onClick={duplicateTableColumn}>Duplikasi kolom</button>
              <button type="button" className="button button--secondary" disabled={!activeTableCell || activeTableCell.column === 0} onClick={() => moveTableColumn(-1)}>Geser kolom ke kiri</button>
              <button type="button" className="button button--secondary" disabled={!activeTableCell || activeTableCell.column === (table[0]?.length ?? 1) - 1} onClick={() => moveTableColumn(1)}>Geser kolom ke kanan</button>
              <button type="button" className="button button--secondary" disabled={!activeTableCell || (table[0]?.length ?? 0) <= 1} onClick={deleteTableColumn}>Hapus kolom terpilih</button>
              <button type="button" className="button button--secondary" disabled={!activeTableCell} onClick={clearTableCell}>Kosongkan sel</button>
            </div>
          </>}
        </> : node.type === "titlePage" ? <p className="content-editor__helper">Cover dibuat otomatis dari data template dan logo yang kamu masukkan.</p> : node.type === "frontMatter" && node.frontMatterTemplate ? null : node.type === "codeBlock" ? null : node.type === "pageBreak" ? <p className="content-editor__helper">Bagian berikutnya dimulai pada halaman baru. Untuk memindahkan atau menghapus pemisah, gunakan Outline.</p> : node.type === "tableOfContents" ? <p className="content-editor__helper">Daftar isi dibuat otomatis dari bab, sub-bab, dan anak sub-bab. Daftar ini mengikuti perubahan judul dan urutan outline. Word dapat memperbarui nomor halaman saat dokumen dibuka.</p> : ["listOfFigures", "listOfTables"].includes(node.type) ? <p className="content-editor__helper">Daftar ini mengikuti nomor dan caption gambar atau tabel. Nomor halaman dihitung otomatis di pratinjau dan PDF; periksa ulang setelah dibuka di Word.</p> : <>
          <label className="editor-field-label editor-field-label--spaced" htmlFor="section-content">Paragraf / isi</label>
          <RichTextEditor node={node} onChange={(content) => updateNode(node.id, { content })} onSplit={(first, second) => splitParagraph(node.id, first, second)} onPasteImage={handlePasteImage} onAddHanging={addHangingNode} hangingItems={node.hangingItems ?? []} onUpdateHangingItems={updateHangingItems} onUpdateHangingSettings={updateHangingSettings} documentSettings={settings} references={settings.references ?? []} usedReferences={usedReferences} citationStyle={citationStyle} citationNumbers={citationNumbers} citationYearSuffixes={citationYearSuffixes} />
        </>}
      </div> : <div className="content-editor__empty"><AlignLeft size={22} /><p>Pilih bagian dari outline untuk mengeditnya, atau tambahkan bagian baru.</p></div>}

      {sharedFormat ? <details className="content-editor__card editor-settings shared-paragraph-format">
        <summary>Format paragraf bersama · {sharedFormatType === "chapter" ? "Bab" : sharedFormatType === "section" ? "Sub-bab" : sharedFormatType === "subsection" ? "Anak sub-bab" : "Paragraf"}</summary>
        <p className="content-editor__helper">Perubahan berlaku untuk {sharedFormatLabel} di seluruh dokumen, termasuk pratinjau dan ekspor.</p>
        {sharedHeadingTextFormat || sharedBodyTextFormat ? (() => {
          const textFormat = sharedHeadingTextFormat ?? sharedBodyTextFormat;
          return <div className="editor-settings__group">
            <h3>Font dan gaya teks</h3>
            <label className="editor-setting-field">Jenis font<select value={textFormat.fontFamily} onChange={(event) => updateSharedFormat({ fontFamily: event.target.value })}>{fonts.map((font) => <option key={font}>{font}</option>)}</select></label>
            <label className="editor-setting-field">Ukuran font (pt)<input type="number" min="6" max="36" step="0.5" value={textFormat.fontSizePt} onChange={(event) => updateSharedFormat({ fontSizePt: Math.min(36, Math.max(6, Number(event.target.value))) })} /></label>
            <label className="settings-toggle editor-setting-span"><span><strong>Tebal</strong><small>Terapkan ke semua {sharedFormatLabel}.</small></span><input type="checkbox" checked={Boolean(textFormat.bold)} onChange={(event) => updateSharedFormat({ bold: event.target.checked })} /></label>
            <label className="settings-toggle editor-setting-span"><span><strong>Miring</strong><small>Terapkan ke semua {sharedFormatLabel}.</small></span><input type="checkbox" checked={Boolean(textFormat.italic)} onChange={(event) => updateSharedFormat({ italic: event.target.checked })} /></label>
          </div>;
        })() : null}
        <div className="editor-settings__group">
          <h3>Indentasi dan perataan</h3>
          <label className="editor-setting-field">Perataan<select value={sharedFormat.alignment ?? (sharedFormatType === "paragraph" ? "justify" : "left")} onChange={(event) => updateSharedFormat({ alignment: event.target.value })}><option value="justify">Rata kiri-kanan</option><option value="left">Rata kiri</option><option value="center">Tengah</option><option value="right">Rata kanan</option></select></label>
          <label className="editor-setting-field">Indentasi kiri (cm)<input type="number" min="0" max="10" step="0.1" value={sharedFormat.leftIndentCm ?? 0} onChange={(event) => updateSharedFormat({ leftIndentCm: Math.max(0, Number(event.target.value)) })} /></label>
          <label className="editor-setting-field">Indentasi kanan (cm)<input type="number" min="0" max="10" step="0.1" value={sharedFormat.rightIndentCm ?? 0} onChange={(event) => updateSharedFormat({ rightIndentCm: Math.max(0, Number(event.target.value)) })} /></label>
          <label className="editor-setting-field">Indentasi khusus<select value={sharedFormat.specialIndentType ?? "none"} onChange={(event) => updateSharedFormat({ specialIndentType: event.target.value })}><option value="none">Tidak ada</option><option value="firstLine">Baris pertama</option><option value="hanging">Gantung (hanging)</option></select></label>
          <label className="editor-setting-field">Sebesar (cm)<input type="number" min="0" max="5" step="0.05" disabled={(sharedFormat.specialIndentType ?? "none") === "none"} value={sharedFormat.specialIndentCm ?? 0} onChange={(event) => updateSharedFormat({ specialIndentCm: Math.max(0, Number(event.target.value)) })} /></label>
        </div>
        <div className="editor-settings__group">
          <h3>Jarak paragraf</h3>
          <label className="editor-setting-field">Sebelum (pt)<input type="number" min="0" max="72" step="1" value={sharedFormat.beforePt ?? 0} onChange={(event) => updateSharedFormat({ beforePt: Math.max(0, Number(event.target.value)) })} /></label>
          <label className="editor-setting-field">Sesudah (pt)<input type="number" min="0" max="72" step="1" value={sharedFormat.afterPt ?? 0} onChange={(event) => updateSharedFormat({ afterPt: Math.max(0, Number(event.target.value)) })} /></label>
          <label className="editor-setting-field">Jarak baris<input type="number" min="0.5" max="3" step="0.1" value={sharedFormat.lineSpacing ?? 1.5} onChange={(event) => updateSharedFormat({ lineSpacing: Math.min(3, Math.max(0.5, Number(event.target.value))) })} /></label>
        </div>
        <div className="editor-settings__group">
          <h3>Baris dan pemisah halaman</h3>
          <label className="settings-toggle editor-setting-span"><span><strong>Kontrol baris yatim dan menggantung</strong><small>Usahakan minimal dua baris paragraf berada di tiap halaman.</small></span><input type="checkbox" checked={Boolean(sharedFormat.widowControl)} onChange={(event) => updateSharedFormat({ widowControl: event.target.checked })} /></label>
          <label className="settings-toggle editor-setting-span"><span><strong>Satukan baris dalam paragraf</strong><small>Cegah paragraf terbelah antarhalaman bila memungkinkan.</small></span><input type="checkbox" checked={Boolean(sharedFormat.keepLinesTogether)} onChange={(event) => updateSharedFormat({ keepLinesTogether: event.target.checked })} /></label>
          <label className="settings-toggle editor-setting-span"><span><strong>Satukan dengan bagian berikutnya</strong><small>Cegah judul terpisah dari isi setelahnya.</small></span><input type="checkbox" checked={Boolean(sharedFormat.keepWithNext)} onChange={(event) => updateSharedFormat({ keepWithNext: event.target.checked })} /></label>
          <label className="settings-toggle editor-setting-span"><span><strong>Mulai pada halaman baru</strong><small>Tambahkan pemisah halaman sebelum jenis bagian ini.</small></span><input type="checkbox" checked={Boolean(sharedFormat.pageBreakBefore)} onChange={(event) => updateSharedFormat({ pageBreakBefore: event.target.checked })} /></label>
        </div>
      </details> : null}

      {node?.type !== "titlePage" ? <div className="content-editor__card content-editor__insert">
        <h2>Sisipkan elemen</h2>
        <div className="content-editor__insert-actions">
          <button type="button" className="button button--secondary" onClick={addParagraph}><Plus size={15} /> Paragraf</button>
          <button type="button" className="button button--secondary" onClick={addCodeBlock}><Code2 size={15} /> Blok kode</button>
          <button type="button" className="button button--secondary" onClick={() => fileInputRef.current?.click()}><ImageIcon size={15} /> {node?.type === "image" ? "Ganti gambar" : "Gambar"}</button>
          <button type="button" className="button button--secondary" onClick={addTable}><Table2 size={15} /> Tabel</button>
          <button type="button" className="button button--secondary" onClick={addPageBreak}><Plus size={15} /> Pemisah halaman</button>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleUpload} />
        </div>
        <p className="content-editor__helper">Gambar disimpan bersama dokumen di browser, maksimal 5 MB per gambar.</p>
        {uploadError ? <p className="content-editor__error" role="alert">{uploadError}</p> : null}
      </div> : null}

      <details className="content-editor__card editor-settings">
        <summary>Format halaman, paragraf, dan font</summary>
        <div className="editor-settings__group"><h3>Kertas dan margin</h3>
          <label className="editor-setting-field">Ukuran kertas<select value={settings.paper.size} onChange={(event) => { const size = event.target.value; updateSettings("paper", size === "Custom" ? { size } : { size, ...PAPER_PRESETS[size] }); }}>
            {Object.keys(PAPER_PRESETS).map((size) => <option key={size}>{size}</option>)}<option>Custom</option>
          </select></label>
          <label className="editor-setting-field">Lebar kertas (cm)<input type="number" min="10" max="60" step="0.1" value={settings.paper.widthCm} onChange={(event) => updateSettings("paper", { size: "Custom", widthCm: Math.max(10, Number(event.target.value)) })} /></label>
          <label className="editor-setting-field">Tinggi kertas (cm)<input type="number" min="10" max="80" step="0.1" value={settings.paper.heightCm} onChange={(event) => updateSettings("paper", { size: "Custom", heightCm: Math.max(10, Number(event.target.value)) })} /></label>
          {numericSetting("margins", "topCm", "Margin atas (cm)", "0.1")}{numericSetting("margins", "leftCm", "Margin kiri (cm)", "0.1")}{numericSetting("margins", "rightCm", "Margin kanan (cm)", "0.1")}{numericSetting("margins", "bottomCm", "Margin bawah (cm)", "0.1")}
          <div className="custom-presets">
            <h4>Simpan sebagai preset</h4>
            <div className="custom-presets__form"><input aria-label="Nama preset kertas" maxLength={40} value={customPresetName} onChange={(event) => setCustomPresetName(event.target.value)} placeholder="Contoh: Format Kampus A" /><button type="button" className="button button--secondary" onClick={saveCurrentPreset}>Simpan</button></div>
            {presetError ? <p className="content-editor__error" role="alert">{presetError}</p> : null}
            {customPresets.length ? <ul className="custom-presets__list">{customPresets.map((item) => <li key={item.id}><span>{item.name}</span><button type="button" onClick={() => onDeleteCustomPreset?.(item.id)}>Hapus preset</button></li>)}</ul> : <p className="content-editor__helper">Preset tersimpan dapat dipilih dari menu Preset di bagian atas.</p>}
            <div className="custom-presets__form">
              <input ref={formatPresetInputRef} type="file" accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={readFormatPreset} />
              <button type="button" className="button button--secondary" disabled={formatPresetBusy} onClick={() => formatPresetInputRef.current?.click()}>{formatPresetBusy ? "Membaca dokumen…" : "Ambil format dari PDF/DOCX"}</button>
            </div>
            {formatPresetDraft ? <div className="editor-settings__group">
              <h4>Tinjau format dari {formatPresetDraft.sourceType}</h4>
              <p className="content-editor__helper">{formatPresetDraft.extractionNote}</p>
              <label className="editor-setting-field">Nama preset<input maxLength={40} value={formatPresetDraft.name} onChange={(event) => setFormatPresetDraft({ ...formatPresetDraft, name: event.target.value })} /></label>
              <label className="editor-setting-field">Kertas<select value={formatPresetDraft.paper.size} onChange={(event) => { const size = event.target.value; setFormatPresetDraft({ ...formatPresetDraft, paper: size === "Custom" ? { ...formatPresetDraft.paper, size } : { size, ...PAPER_PRESETS[size] } }); }}>
                {Object.keys(PAPER_PRESETS).map((size) => <option key={size}>{size}</option>)}<option>Custom</option>
              </select></label>
              {[["margins", "topCm", "Margin atas"], ["margins", "rightCm", "Margin kanan"], ["margins", "bottomCm", "Margin bawah"], ["margins", "leftCm", "Margin kiri"]].map(([group, key, label]) => <label className="editor-setting-field" key={`import-${key}`}>{label} (cm)<input type="number" min="0" max="15" step="0.1" value={formatPresetDraft[group][key]} onChange={(event) => updateFormatPreset(group, key, Math.max(0, Number(event.target.value)))} /></label>)}
              <label className="editor-setting-field">Font isi<input value={formatPresetDraft.typography.fontFamily} maxLength={80} onChange={(event) => updateFormatPreset("typography", "fontFamily", event.target.value)} /></label>
              <label className="editor-setting-field">Ukuran font isi (pt)<input type="number" min="6" max="36" step="0.5" value={formatPresetDraft.typography.bodyPt} onChange={(event) => updateFormatPreset("typography", "bodyPt", Math.max(6, Number(event.target.value)))} /></label>
              <label className="settings-toggle editor-setting-span"><span><strong>Teks isi tebal</strong></span><input type="checkbox" checked={Boolean(formatPresetDraft.typography.bodyBold)} onChange={(event) => updateFormatPreset("typography", "bodyBold", event.target.checked)} /></label>
              <label className="settings-toggle editor-setting-span"><span><strong>Teks isi miring</strong></span><input type="checkbox" checked={Boolean(formatPresetDraft.typography.bodyItalic)} onChange={(event) => updateFormatPreset("typography", "bodyItalic", event.target.checked)} /></label>
              <label className="editor-setting-field">Jarak baris<input type="number" min="0.5" max="3" step="0.1" value={formatPresetDraft.paragraph.lineSpacing} onChange={(event) => updateFormatPreset("paragraph", "lineSpacing", Math.max(0.5, Number(event.target.value)))} /></label>
              <label className="editor-setting-field">Indentasi kiri (cm)<input type="number" min="0" max="10" step="0.1" value={formatPresetDraft.paragraph.leftIndentCm} onChange={(event) => updateFormatPreset("paragraph", "leftIndentCm", Math.max(0, Number(event.target.value)))} /></label>
              <label className="editor-setting-field">Indentasi kanan (cm)<input type="number" min="0" max="10" step="0.1" value={formatPresetDraft.paragraph.rightIndentCm} onChange={(event) => updateFormatPreset("paragraph", "rightIndentCm", Math.max(0, Number(event.target.value)))} /></label>
              <label className="editor-setting-field">Indentasi khusus<select value={formatPresetDraft.paragraph.specialIndentType ?? "firstLine"} onChange={(event) => updateFormatPreset("paragraph", "specialIndentType", event.target.value)}><option value="none">Tidak ada</option><option value="firstLine">Baris pertama</option><option value="hanging">Gantung</option></select></label>
              <label className="editor-setting-field">Besar indentasi khusus (cm)<input type="number" min="0" max="5" step="0.05" disabled={formatPresetDraft.paragraph.specialIndentType === "none"} value={formatPresetDraft.paragraph.specialIndentCm ?? formatPresetDraft.paragraph.firstLineIndentCm} onChange={(event) => { const value = Math.max(0, Number(event.target.value)); setFormatPresetDraft((current) => ({ ...current, paragraph: { ...current.paragraph, specialIndentCm: value, firstLineIndentCm: current.paragraph.specialIndentType === "hanging" ? current.paragraph.firstLineIndentCm : value } })); }} /></label>
              <label className="editor-setting-field">Jarak sebelum paragraf (pt)<input type="number" min="0" max="120" step="1" value={formatPresetDraft.paragraph.beforePt} onChange={(event) => updateFormatPreset("paragraph", "beforePt", Math.max(0, Number(event.target.value)))} /></label>
              <label className="editor-setting-field">Jarak sesudah paragraf (pt)<input type="number" min="0" max="120" step="1" value={formatPresetDraft.paragraph.afterPt} onChange={(event) => updateFormatPreset("paragraph", "afterPt", Math.max(0, Number(event.target.value)))} /></label>
              <label className="editor-setting-field">Perataan<select value={formatPresetDraft.paragraph.alignment} onChange={(event) => updateFormatPreset("paragraph", "alignment", event.target.value)}><option value="justify">Rata kiri-kanan</option><option value="left">Rata kiri</option><option value="center">Rata tengah</option><option value="right">Rata kanan</option></select></label>
              <label className="settings-toggle editor-setting-span"><span><strong>Kontrol baris yatim dan menggantung</strong><small>Usahakan sedikitnya dua baris paragraf berada di tiap halaman.</small></span><input type="checkbox" checked={Boolean(formatPresetDraft.paragraph.widowControl)} onChange={(event) => updateFormatPreset("paragraph", "widowControl", event.target.checked)} /></label>
              <label className="settings-toggle editor-setting-span"><span><strong>Satukan baris dalam paragraf</strong></span><input type="checkbox" checked={Boolean(formatPresetDraft.paragraph.keepLinesTogether)} onChange={(event) => updateFormatPreset("paragraph", "keepLinesTogether", event.target.checked)} /></label>
              <label className="settings-toggle editor-setting-span"><span><strong>Satukan paragraf dengan bagian berikutnya</strong></span><input type="checkbox" checked={Boolean(formatPresetDraft.paragraph.keepWithNext)} onChange={(event) => updateFormatPreset("paragraph", "keepWithNext", event.target.checked)} /></label>
              <label className="settings-toggle editor-setting-span"><span><strong>Mulai paragraf pada halaman baru</strong></span><input type="checkbox" checked={Boolean(formatPresetDraft.paragraph.pageBreakBefore)} onChange={(event) => updateFormatPreset("paragraph", "pageBreakBefore", event.target.checked)} /></label>
              {Object.keys(formatPresetDraft.outlineStyles ?? {}).length ? <>
                <h4>Gaya judul dari DOCX</h4>
                {[["chapter", "Judul BAB"], ["section", "Judul Sub-bab"], ["subsection", "Judul Anak Sub-bab"]].map(([type, label]) => {
                  const style = getOutlineStyle(formatPresetDraft, type);
                  const level = type === "chapter" ? 1 : type === "section" ? 2 : 3;
                  return <details className="editor-settings__group" key={type}>
                    <summary>{label}</summary>
                    <label className="editor-setting-field">Jenis font<input value={style.fontFamily ?? formatPresetDraft.typography.fontFamily} maxLength={80} onChange={(event) => updateFormatPresetHeading(type, "fontFamily", event.target.value)} /></label>
                    <label className="editor-setting-field">Ukuran font (pt)<input type="number" min="6" max="36" step="0.5" value={style.fontSizePt ?? formatPresetDraft.typography[`heading${level}Pt`]} onChange={(event) => updateFormatPresetHeading(type, "fontSizePt", Math.min(36, Math.max(6, Number(event.target.value))))} /></label>
                    <label className="editor-setting-field">Perataan<select value={style.alignment} onChange={(event) => updateFormatPresetHeading(type, "alignment", event.target.value)}><option value="left">Kiri</option><option value="center">Tengah</option><option value="right">Kanan</option><option value="justify">Rata kiri-kanan</option></select></label>
                    <label className="editor-setting-field">Indentasi kiri (cm)<input type="number" min="0" max="10" step="0.1" value={style.leftIndentCm} onChange={(event) => updateFormatPresetHeading(type, "leftIndentCm", Math.max(0, Number(event.target.value)))} /></label>
                    <label className="editor-setting-field">Indentasi kanan (cm)<input type="number" min="0" max="10" step="0.1" value={style.rightIndentCm} onChange={(event) => updateFormatPresetHeading(type, "rightIndentCm", Math.max(0, Number(event.target.value)))} /></label>
                    <label className="editor-setting-field">Indentasi khusus<select value={style.specialIndentType} onChange={(event) => updateFormatPresetHeading(type, "specialIndentType", event.target.value)}><option value="none">Tidak ada</option><option value="firstLine">Baris pertama</option><option value="hanging">Gantung</option></select></label>
                    <label className="editor-setting-field">Besar indentasi khusus (cm)<input type="number" min="0" max="5" step="0.05" disabled={style.specialIndentType === "none"} value={style.specialIndentCm} onChange={(event) => updateFormatPresetHeading(type, "specialIndentCm", Math.max(0, Number(event.target.value)))} /></label>
                    <label className="editor-setting-field">Jarak sebelum (pt)<input type="number" min="0" max="120" step="1" value={style.beforePt} onChange={(event) => updateFormatPresetHeading(type, "beforePt", Math.max(0, Number(event.target.value)))} /></label>
                    <label className="editor-setting-field">Jarak sesudah (pt)<input type="number" min="0" max="120" step="1" value={style.afterPt} onChange={(event) => updateFormatPresetHeading(type, "afterPt", Math.max(0, Number(event.target.value)))} /></label>
                    <label className="editor-setting-field">Jarak baris<input type="number" min="0.5" max="3" step="0.1" value={style.lineSpacing} onChange={(event) => updateFormatPresetHeading(type, "lineSpacing", Math.min(3, Math.max(0.5, Number(event.target.value))))} /></label>
                    <label className="settings-toggle editor-setting-span"><span><strong>Tebal</strong></span><input type="checkbox" checked={Boolean(style.bold ?? type !== "subsection")} onChange={(event) => updateFormatPresetHeading(type, "bold", event.target.checked)} /></label>
                    <label className="settings-toggle editor-setting-span"><span><strong>Miring</strong></span><input type="checkbox" checked={Boolean(style.italic ?? type === "subsection")} onChange={(event) => updateFormatPresetHeading(type, "italic", event.target.checked)} /></label>
                    <label className="settings-toggle editor-setting-span"><span><strong>Mulai halaman baru</strong></span><input type="checkbox" checked={Boolean(style.pageBreakBefore)} onChange={(event) => updateFormatPresetHeading(type, "pageBreakBefore", event.target.checked)} /></label>
                    <label className="settings-toggle editor-setting-span"><span><strong>Satukan dengan bagian berikutnya</strong></span><input type="checkbox" checked={Boolean(style.keepWithNext)} onChange={(event) => updateFormatPresetHeading(type, "keepWithNext", event.target.checked)} /></label>
                  </details>;
                })}
              </> : null}
              <div className="settings-dialog__actions"><button type="button" className="button button--secondary" onClick={() => setFormatPresetDraft(null)}>Batal</button><button type="button" className="button button--primary" disabled={!formatPresetDraft.name.trim()} onClick={saveImportedFormatPreset}>Simpan dan terapkan preset</button></div>
            </div> : null}
          </div>
        </div>
        <div className="editor-settings__group"><h3>Tipografi</h3>
          <label className="editor-setting-field">Jenis font<select value={settings.typography.fontFamily} onChange={(event) => updateSettings("typography", { fontFamily: event.target.value })}>{fonts.map((font) => <option key={font}>{font}</option>)}</select></label>
          {numericSetting("typography", "heading1Pt", "Heading 1 (pt)")}{numericSetting("typography", "heading2Pt", "Heading 2 (pt)")}{numericSetting("typography", "heading3Pt", "Heading 3 (pt)")}{numericSetting("typography", "bodyPt", "Isi (pt)")}{numericSetting("typography", "captionPt", "Caption (pt)")}
        </div>
        <div className="editor-settings__group"><h3>Paragraf</h3>
          {numericSetting("paragraph", "firstLineIndentCm", "Jarak indentasi khusus (cm)", "0.25")}{numericSetting("paragraph", "leftIndentCm", "Indentasi kiri (cm)", "0.25")}{numericSetting("paragraph", "rightIndentCm", "Indentasi kanan (cm)", "0.25")}{numericSetting("paragraph", "beforePt", "Jarak sebelum (pt)")}{numericSetting("paragraph", "afterPt", "Jarak sesudah (pt)")}
          <label className="editor-setting-field">Perataan teks<select value={settings.paragraph.alignment ?? "justify"} onChange={(event) => updateSettings("paragraph", { alignment: event.target.value })}><option value="justify">Rata kiri-kanan</option><option value="left">Rata kiri</option><option value="center">Rata tengah</option><option value="right">Rata kanan</option></select></label>
          <label className="editor-setting-field">Jarak baris<select value={lineSpacingPreset} onChange={(event) => {
            const value = event.target.value;
            if (value !== "custom") updateSettings("paragraph", { lineSpacing: Number(value) });
          }}><option value="1">Tunggal (1,0)</option><option value="1.5">1,5 baris</option><option value="2">Ganda (2,0)</option><option value="custom">Kustom</option></select></label>
          {lineSpacingPreset === "custom" ? <label className="editor-setting-field">Jarak kustom<input type="number" min="0.5" max="3" step="0.05" value={settings.paragraph.lineSpacing} onChange={(event) => updateSettings("paragraph", { lineSpacing: Math.min(3, Math.max(0.5, Number(event.target.value))) })} /></label> : null}
        </div>
        <div className="editor-settings__group"><h3>Nomor halaman default</h3>
          <label className="settings-toggle editor-setting-span"><span><strong>Tampilkan nomor halaman</strong><small>Bab dengan pengaturan khusus akan mengikuti setelannya sendiri.</small></span><input type="checkbox" checked={settings.pageNumbering.show !== false} onChange={(event) => updateSettings("pageNumbering", { show: event.target.checked })} /></label>
          <fieldset className="settings-fieldset editor-setting-span"><legend>Format angka default</legend>
            <label><input type="radio" name="global-page-style" checked={settings.pageNumbering.style === "roman-lower"} onChange={() => updateSettings("pageNumbering", { style: "roman-lower" })} /> Romawi kecil (i, ii, iii)</label>
            <label><input type="radio" name="global-page-style" checked={settings.pageNumbering.style === "arabic"} onChange={() => updateSettings("pageNumbering", { style: "arabic" })} /> Arab (1, 2, 3)</label>
          </fieldset>
          <label className="editor-setting-field">Mulai dari halaman<input type="number" min="1" step="1" value={settings.pageNumbering.startAt ?? 1} onChange={(event) => updateSettings("pageNumbering", { startAt: Math.max(1, Math.floor(Number(event.target.value) || 1)) })} /></label>
        </div>
        <div className="editor-settings__group"><h3>Sumber dan sitasi</h3>
          <label className="editor-setting-field">Gaya kutipan<select value={citationStyle} onChange={(event) => setCitationStyle(event.target.value)}>{Object.entries(CITATION_STYLES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <p className="content-editor__helper">Gaya numerik memberi nomor menurut urutan kutipan pertama di dalam naskah. Cocokkan format akhir dengan pedoman kampus atau jurnal.</p>
          <p className="content-editor__helper">Masukkan satu atau beberapa penulis; pisahkan nama penulis dengan titik koma. Contoh: Sari, A.; Putra, B.</p>
          <div className="reference-import">
            <input ref={referenceFileInput} type="file" accept=".bib,.ris,application/x-bibtex,text/plain" onChange={importBibTeX} hidden />
            <button type="button" className="button button--secondary" onClick={() => referenceFileInput.current?.click()}>Impor daftar pustaka (.bib / .ris)</button>
            <button type="button" className="button button--secondary" disabled={!settings.references?.length} onClick={() => exportReferenceFile("bib")}>Ekspor BibTeX</button>
            <button type="button" className="button button--secondary" disabled={!settings.references?.length} onClick={() => exportReferenceFile("ris")}>Ekspor RIS</button>
            <p className="content-editor__helper">Menerima BibTeX atau RIS dari pengelola referensi. Entri duplikat akan dilewati.</p>
            {referenceImportMessage ? <p className="content-editor__helper" role="status" aria-live="polite">{referenceImportMessage}</p> : null}
          </div>
          <div className="reference-manager-form">
            <label className="editor-setting-field">Jenis sumber<select value={referenceDraft.sourceType} onChange={(event) => changeReferenceType(event.target.value)}>{Object.entries(REFERENCE_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="editor-setting-field">Penulis<input value={referenceDraft.authors} onChange={(event) => setReferenceDraft((current) => ({ ...current, authors: event.target.value }))} placeholder="Nama belakang, inisial" /></label>
            <label className="editor-setting-field">Tahun<input value={referenceDraft.year} onChange={(event) => setReferenceDraft((current) => ({ ...current, year: event.target.value }))} placeholder="2024 atau t.t." maxLength={12} /></label>
            <label className="editor-setting-field">Judul<input value={referenceDraft.title} onChange={(event) => setReferenceDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Judul buku atau artikel" /></label>
            <label className="editor-setting-field">{referenceDraft.sourceType === "journal" ? "Nama jurnal" : referenceDraft.sourceType === "website" ? "Nama situs" : referenceDraft.sourceType === "thesis" || referenceDraft.sourceType === "report" ? "Institusi" : referenceDraft.sourceType === "conference" ? "Nama prosiding konferensi" : referenceDraft.sourceType === "chapter" ? "Judul buku" : "Penerbit"}<input value={referenceDraft.source} onChange={(event) => setReferenceDraft((current) => ({ ...current, source: event.target.value }))} placeholder={referenceDraft.sourceType === "conference" ? "Proceedings of ..." : referenceDraft.sourceType === "chapter" ? "Judul buku" : referenceDraft.sourceType === "journal" ? "Nama jurnal" : referenceDraft.sourceType === "website" ? "Nama situs" : "Nama penerbit atau institusi"} /></label>
            {["conference", "chapter"].includes(referenceDraft.sourceType) ? <>
              <label className="editor-setting-field">Editor buku/prosiding<input value={referenceDraft.editor} onChange={(event) => setReferenceDraft((current) => ({ ...current, editor: event.target.value }))} placeholder="Nama belakang, inisial; pisahkan dengan titik koma" /></label>
              <label className="editor-setting-field">Penerbit<input value={referenceDraft.publisher} onChange={(event) => setReferenceDraft((current) => ({ ...current, publisher: event.target.value }))} placeholder="Nama penerbit" /></label>
            </> : null}
            {["journal", "conference", "chapter"].includes(referenceDraft.sourceType) ? <>
              <label className="editor-setting-field">Volume<input value={referenceDraft.volume} onChange={(event) => setReferenceDraft((current) => ({ ...current, volume: event.target.value }))} placeholder="12" /></label>
              <label className="editor-setting-field">Nomor edisi<input value={referenceDraft.issue} onChange={(event) => setReferenceDraft((current) => ({ ...current, issue: event.target.value }))} placeholder="2" /></label>
              <label className="editor-setting-field">Halaman<input value={referenceDraft.pages} onChange={(event) => setReferenceDraft((current) => ({ ...current, pages: event.target.value }))} placeholder="45–59" /></label>
            </> : null}
            <label className="editor-setting-field">DOI<input value={referenceDraft.doi} onChange={(event) => setReferenceDraft((current) => ({ ...current, doi: event.target.value }))} placeholder="10.1234/abc.2024.01" /></label>
            {referenceDraft.sourceType === "website" ? <label className="editor-setting-field">URL laman<input value={referenceDraft.url} onChange={(event) => setReferenceDraft((current) => ({ ...current, url: event.target.value }))} placeholder="https://..." /></label> : null}
            {referencePreviewParts.length ? <div className="reference-draft-preview"><strong>Pratinjau daftar pustaka · {CITATION_STYLES[citationStyle]}</strong><p>{referencePreviewParts.map((part, index) => part.italics ? <em key={index}>{part.text}</em> : <span key={index}>{part.text}</span>)}</p></div> : null}
            <button type="button" className="button button--secondary" onClick={saveReference}>{editingReferenceId ? <Check size={14} /> : <Plus size={14} />}{editingReferenceId ? " Simpan perubahan" : " Tambah sumber"}</button>
            {editingReferenceId ? <button type="button" className="button button--secondary" onClick={cancelReferenceEdit}>Batal edit</button> : null}
            {referenceError ? <p className="content-editor__error" role="alert">{referenceError}</p> : null}
          </div>
          {settings.references?.length ? <ul className="custom-presets__list reference-manager-list">{settings.references.map((reference) => <li key={reference.id}><span><strong>{formatInTextCitation(reference, citationStyle, citationNumbers[reference.id] ?? 1)}</strong> {reference.title}{usedReferenceIds.has(reference.id) ? <small> · Dikutip dalam naskah</small> : null}</span><div className="reference-manager-actions"><button type="button" onClick={() => editReference(reference)}>Edit</button><button type="button" disabled={usedReferenceIds.has(reference.id)} title={usedReferenceIds.has(reference.id) ? "Hapus sitasi di naskah sebelum menghapus sumber" : "Hapus sumber"} onClick={() => { if (editingReferenceId === reference.id) cancelReferenceEdit(); updateReferences(settings.references.filter((item) => item.id !== reference.id)); }}>Hapus</button></div></li>)}</ul> : <p className="content-editor__helper">Belum ada sumber. Setelah ditambahkan, gunakan ikon kutip pada toolbar paragraf untuk menyisipkan sitasi.</p>}
        </div>
      </details>
    </section>
  );
}
