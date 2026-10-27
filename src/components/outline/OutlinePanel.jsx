"use client";

import { useEffect, useRef, useState } from "react";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import { ArrowDown, ArrowUp, BookOpen, ChevronDown, ChevronUp, Code2, Copy, FileText, Files, GripVertical, Image as ImageIcon, MoreVertical, Pencil, Plus, Table2, Trash2 } from "lucide-react";
import { CONTAINER_NODE_TYPES, createThesisFrontMatter } from "@/lib/document/schema";
import { getHeadingLabels } from "@/lib/document/numbering";
import { useDocumentStore } from "@/store/useDocumentStore";

const nodeNames = {
  chapter: "Bab",
  section: "Sub-bab",
  subsection: "Anak sub-bab",
  paragraph: "Paragraf",
  codeBlock: "Blok kode",
  image: "Gambar",
  table: "Tabel",
  pageBreak: "Pemisah halaman",
  tableOfContents: "Daftar isi otomatis",
  listOfFigures: "Daftar gambar otomatis",
  listOfTables: "Daftar tabel otomatis",
  titlePage: "Cover",
  abstract: "Abstrak",
  frontMatter: "Halaman awal",
  frontMatterPack: "Paket template halaman awal skripsi",
};

const nodeIcons = {
  chapter: BookOpen,
  section: FileText,
  subsection: FileText,
  paragraph: FileText,
  codeBlock: Code2,
  image: ImageIcon,
  table: Table2,
  pageBreak: FileText,
  tableOfContents: FileText,
  listOfFigures: ImageIcon,
  listOfTables: Table2,
  titlePage: BookOpen,
  abstract: FileText,
  frontMatter: BookOpen,
  frontMatterPack: Files,
};

function defaultNode(type) {
  const defaults = {
    chapter: { title: "BAB I PENDAHULUAN" },
    section: { title: "1.1 Judul Sub-bab" },
    subsection: { title: "1.1.1 Judul Anak Sub-bab" },
    paragraph: { title: "Paragraf baru" },
    codeBlock: { title: "Blok kode", codeLanguage: "auto", codeFontSizePt: 9, codeTheme: "dark", content: "" },
    image: { title: "Gambar baru", caption: "" },
    table: { title: "Tabel baru", caption: "" },
    pageBreak: { title: "Pemisah halaman" },
    tableOfContents: { title: "DAFTAR ISI" },
    listOfFigures: { title: "DAFTAR GAMBAR" },
    listOfTables: { title: "DAFTAR TABEL" },
    titlePage: { title: "Cover", coverData: {} },
    abstract: { title: "ABSTRAK", keywords: "" },
    frontMatter: { title: "KATA PENGANTAR", content: "" },
  };
  return defaults[type];
}

function flattenNodes(nodes, parentId = null, depth = 0) {
  const list = nodes ?? [];
  return list.flatMap((node, siblingIndex) => [
    { node, parentId, depth, siblingIndex, siblingCount: list.length },
    ...flattenNodes(node.children, node.id, depth + 1),
  ]);
}

function OutlineRow({ entry, index, selectedNodeId, multiSelected, activeMenuId, onMenu, onEdit, onToggleSelection, onDuplicate, onMove, onDelete, onPageSetup, treeView, headingLabels }) {
  const { node, depth, siblingIndex, siblingCount } = entry;
  const nodeTypeName = node.hangingList ? "Hanging" : nodeNames[node.type];
  const displayTitle = node.type === "titlePage" ? "Cover" : headingLabels[node.id] ?? (node.title || nodeTypeName);
  const Icon = nodeIcons[node.type] ?? FileText;
  const handleEdit = () => onEdit(node);
  const handleDelete = () => onDelete(node);
  const handleDuplicate = () => onDuplicate(node);
  const handlePageSetup = () => onPageSetup(node);

  return (
    <Draggable draggableId={node.id} index={index}>
      {(drag, snapshot) => (
        <div
          ref={drag.innerRef}
          {...drag.draggableProps}
          data-outline-node={node.id}
          className={`outline-node ${selectedNodeId === node.id ? "outline-node--selected" : ""} ${multiSelected ? "outline-node--multi-selected" : ""} ${snapshot.isDragging ? "outline-node--dragging" : ""}`}
        >
          <div className="outline-node__row" style={{ paddingInlineStart: `${depth * 12 + 3}px` }}>
            <button type="button" className="outline-node__drag" aria-label={`Pindahkan ${displayTitle}`} {...drag.dragHandleProps}>
              <GripVertical size={16} />
            </button>
            <input className="outline-node__checkbox" type="checkbox" checked={multiSelected} aria-label={`Pilih ${displayTitle}`} onChange={(event) => onToggleSelection(node, index, event.nativeEvent.shiftKey)} />
            <button type="button" onClick={handleEdit} className="outline-node__select" title="Edit section">
              <Icon size={15} className="outline-node__type-icon" />
              <span className="outline-node__title">{displayTitle}</span>
              {treeView ? <span className="outline-node__type">{nodeTypeName}</span> : null}
            </button>
            <div className="outline-node__menu-wrap">
              <button type="button" className="outline-node__more" aria-label={`Menu ${displayTitle}`} aria-expanded={activeMenuId === node.id} onClick={() => onMenu(node.id)}>
                <MoreVertical size={16} />
              </button>
              {activeMenuId === node.id ? (
                <div className="outline-context-menu" role="menu">
                  <button type="button" role="menuitem" onClick={handleEdit}><Pencil size={14} /> Edit Section</button>
                  <button type="button" role="menuitem" onClick={handleDuplicate}><Copy size={14} /> Duplikat bagian</button>
                  <button type="button" role="menuitem" disabled={siblingIndex === 0} onClick={() => onMove(node, -1)}><ArrowUp size={14} /> Pindah ke atas</button>
                  <button type="button" role="menuitem" disabled={siblingIndex === siblingCount - 1} onClick={() => onMove(node, 1)}><ArrowDown size={14} /> Pindah ke bawah</button>
                  {node.type === "chapter" ? <button type="button" role="menuitem" onClick={handlePageSetup}><FileText size={14} /> Page Number Settings</button> : null}
                  <button type="button" role="menuitem" className="outline-context-menu__danger" onClick={handleDelete}><Trash2 size={14} /> Delete Node</button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </Draggable>
  );
}

function PageNumberDialog({ node, documentSettings, onClose, onSave }) {
  const current = node.pageNumbering ?? { ...documentSettings, restart: false };
  const [settings, setSettings] = useState(current);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="page-settings-title">
        <div className="settings-dialog__header">
          <div><p className="eyebrow">Pengaturan section</p><h2 id="page-settings-title">Nomor halaman</h2></div>
          <button type="button" className="icon-button icon-button--light" onClick={onClose} aria-label="Tutup pengaturan">×</button>
        </div>
        <label className="settings-toggle">
          <span><strong>Tampilkan nomor halaman</strong><small>Nonaktifkan untuk cover atau halaman tanpa nomor.</small></span>
          <input type="checkbox" checked={settings.show} onChange={(event) => setSettings({ ...settings, show: event.target.checked })} />
        </label>
        <fieldset className="settings-fieldset">
          <legend>Format angka</legend>
          <label><input type="radio" name="number-style" value="roman-lower" checked={settings.style === "roman-lower"} onChange={() => setSettings({ ...settings, style: "roman-lower" })} /> Romawi kecil (i, ii, iii)</label>
          <label><input type="radio" name="number-style" value="arabic" checked={settings.style === "arabic"} onChange={() => setSettings({ ...settings, style: "arabic" })} /> Arab (1, 2, 3)</label>
        </fieldset>
        <fieldset className="settings-fieldset">
          <legend>Logika penomoran</legend>
          <label><input type="radio" name="number-restart" checked={!settings.restart} onChange={() => setSettings({ ...settings, restart: false })} /> Lanjutkan dari section sebelumnya</label>
          <label><input type="radio" name="number-restart" checked={settings.restart} onChange={() => setSettings({ ...settings, restart: true })} /> Mulai lagi dari halaman 1</label>
        </fieldset>
        {settings.restart ? (
          <label className="settings-start-at">Mulai dari
            <input type="number" min="1" value={settings.startAt ?? 1} onChange={(event) => setSettings({ ...settings, startAt: Math.max(1, Number(event.target.value)) })} />
          </label>
        ) : null}
        <div className="settings-dialog__actions">
          <button type="button" className="button button--secondary" onClick={onClose}>Batal</button>
          <button type="button" className="button button--primary" onClick={() => onSave(settings)}>Simpan pengaturan</button>
        </div>
      </section>
    </div>
  );
}

export default function OutlinePanel() {
  const document = useDocumentStore((state) => state.document);
  const selectedNodeId = useDocumentStore((state) => state.selectedNodeId);
  const selectNode = useDocumentStore((state) => state.selectNode);
  const addNode = useDocumentStore((state) => state.addNode);
  const addNodes = useDocumentStore((state) => state.addNodes);
  const addNodeAtSelection = useDocumentStore((state) => state.addNodeAtSelection);
  const duplicateNode = useDocumentStore((state) => state.duplicateNode);
  const updateNode = useDocumentStore((state) => state.updateNode);
  const moveNode = useDocumentStore((state) => state.moveNode);
  const moveNodeByOffset = useDocumentStore((state) => state.moveNodeByOffset);
  const removeNodes = useDocumentStore((state) => state.removeNodes);
  const outlineRef = useRef(null);
  const [tab, setTab] = useState("outline");
  const [outlineSearch, setOutlineSearch] = useState("");
  const [outlineMatchIndex, setOutlineMatchIndex] = useState(-1);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState(null);
  const [settingsNode, setSettingsNode] = useState(null);
  const [deleteNodes, setDeleteNodes] = useState([]);
  const [multiSelectedIds, setMultiSelectedIds] = useState([]);
  const selectionAnchorId = useRef(null);

  useEffect(() => {
    if (!selectedNodeId) return;
    outlineRef.current?.querySelector(`[data-outline-node="${selectedNodeId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedNodeId]);

  function handleAdd(type) {
    if (type === "frontMatterPack") {
      addNodes(createThesisFrontMatter(), null);
      setAddMenuOpen(false);
      return;
    }
    if (type === "chapter") addNode(type, defaultNode(type), null);
    else addNodeAtSelection(type, defaultNode(type), selectedNodeId);
    setAddMenuOpen(false);
  }

  function handleDragEnd(result) {
    const entries = flattenNodes(document.sections);
    const source = entries.find((entry) => entry.node.id === result.draggableId);
    if (!source) return;

    const siblingsFor = (parentId) => parentId ? findNode(document.sections, parentId)?.children ?? [] : document.sections;
    if (result.combine) {
      const target = entries.find((entry) => entry.node.id === result.combine.draggableId);
      if (!target || target.node.id === source.node.id) return;
      if (CONTAINER_NODE_TYPES.includes(target.node.type)) {
        moveNode(source.node.id, target.node.id, target.node.children.length);
        return;
      }
      const siblings = siblingsFor(target.parentId).filter((node) => node.id !== source.node.id);
      const targetIndex = siblings.findIndex((node) => node.id === target.node.id);
      moveNode(source.node.id, target.parentId, targetIndex + 1);
      return;
    }

    if (!result.destination) return;
    const remaining = entries.filter((entry) => entry.node.id !== source.node.id);
    const siblingsAfterRemoval = siblingsFor(source.parentId).filter((node) => node.id !== source.node.id);
    const destinationIndex = Math.max(0, Math.min(result.destination.index, remaining.length));
    const target = remaining.slice(destinationIndex).find((entry) => entry.parentId === source.parentId);
    const insertionIndex = target
      ? siblingsAfterRemoval.findIndex((node) => node.id === target.node.id)
      : siblingsAfterRemoval.length;
    if (insertionIndex < 0 || (insertionIndex === siblingsAfterRemoval.length && siblingsFor(source.parentId).at(-1)?.id === source.node.id)) return;
    moveNode(source.node.id, source.parentId, insertionIndex);
  }

  function requestDelete(node) {
    setActiveMenuId(null);
    setDeleteNodes([node]);
  }

  function toggleOutlineSelection(node, index, shiftKey = false) {
    selectNode(node.id);
    const anchorIndex = flatNodes.findIndex(({ node: item }) => item.id === selectionAnchorId.current);
    if (shiftKey && anchorIndex >= 0) {
      const start = Math.min(anchorIndex, index);
      const end = Math.max(anchorIndex, index);
      setMultiSelectedIds(flatNodes.slice(start, end + 1).map(({ node: item }) => item.id));
      return;
    }
    setMultiSelectedIds((current) => current.includes(node.id) ? current.filter((id) => id !== node.id) : [...current, node.id]);
    selectionAnchorId.current = node.id;
  }

  function moveSelectedSiblings(direction) {
    const entries = flatNodes.filter(({ node }) => multiSelectedIds.includes(node.id));
    if (!entries.length || entries.some((entry) => entry.parentId !== entries[0].parentId)) return;
    const ordered = [...entries].sort((a, b) => direction < 0 ? a.siblingIndex - b.siblingIndex : b.siblingIndex - a.siblingIndex);
    ordered.forEach(({ node }) => moveNodeByOffset(node.id, direction));
  }

  function editNode(node) {
    selectNode(node.id);
    setMultiSelectedIds([]);
    selectionAnchorId.current = node.id;
    setActiveMenuId(null);
  }

  function savePageSettings(settings) {
    updateNode(settingsNode.id, { pageNumbering: settings });
    setSettingsNode(null);
  }

  if (!document) return null;
  const flatNodes = flattenNodes(document.sections);
  const headingLabels = getHeadingLabels(document.sections);
  const selectedEntries = flatNodes.filter(({ node }) => multiSelectedIds.includes(node.id));
  const canMoveSelection = selectedEntries.length > 0 && selectedEntries.every((entry) => entry.parentId === selectedEntries[0].parentId);
  const normalizedSearch = outlineSearch.trim().toLocaleLowerCase();
  const searchMatches = normalizedSearch
    ? flatNodes.filter(({ node }) => (headingLabels[node.id] ?? node.title ?? nodeNames[node.type]).toLocaleLowerCase().includes(normalizedSearch))
    : [];

  function navigateSearch(direction) {
    if (!searchMatches.length) return;
    const nextIndex = outlineMatchIndex < 0
      ? (direction > 0 ? 0 : searchMatches.length - 1)
      : (outlineMatchIndex + direction + searchMatches.length) % searchMatches.length;
    setOutlineMatchIndex(nextIndex);
    selectNode(searchMatches[nextIndex].node.id);
  }

  return (
    <aside ref={outlineRef} className="editor-panel editor-outline-panel outline-panel">
      <div className="outline-panel__tabs" role="tablist" aria-label="Tampilan outline">
        <button type="button" role="tab" aria-selected={tab === "outline"} className={tab === "outline" ? "is-active" : ""} onClick={() => setTab("outline")}>Outline</button>
        <button type="button" role="tab" aria-selected={tab === "tree"} className={tab === "tree" ? "is-active" : ""} onClick={() => setTab("tree")}>Tree-View</button>
      </div>

      <div className="outline-panel__toolbar">
        <span>{document.sections.length ? `${document.sections.length} item utama` : "Belum ada bagian"}</span>
        <div className="outline-add-wrap">
          <button type="button" className="button button--secondary outline-add-button" aria-expanded={addMenuOpen} onClick={() => setAddMenuOpen(!addMenuOpen)}>
            <Plus size={15} /> Tambah node
          </button>
          {addMenuOpen ? (
            <div className="outline-add-menu" role="menu">
              {Object.entries(nodeNames).map(([type, label]) => {
                const Icon = nodeIcons[type];
                return <button key={type} type="button" role="menuitem" onClick={() => handleAdd(type)}><Icon size={15} /> {label}</button>;
              })}
            </div>
          ) : null}
        </div>
      </div>
      {document.sections.length ? (
        <div className="outline-search">
          <input
            type="search"
            value={outlineSearch}
            onChange={(event) => { setOutlineSearch(event.target.value); setOutlineMatchIndex(-1); }}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); navigateSearch(event.shiftKey ? -1 : 1); } }}
            placeholder="Cari bagian di outline..."
            aria-label="Cari bagian di outline"
          />
          <span aria-live="polite">{searchMatches.length ? `${Math.min(outlineMatchIndex + 1, searchMatches.length)}/${searchMatches.length}` : "0/0"}</span>
          <button type="button" onClick={() => navigateSearch(-1)} disabled={!searchMatches.length} aria-label="Hasil sebelumnya" title="Hasil sebelumnya"><ChevronUp size={16} /></button>
          <button type="button" onClick={() => navigateSearch(1)} disabled={!searchMatches.length} aria-label="Hasil berikutnya" title="Hasil berikutnya"><ChevronDown size={16} /></button>
        </div>
      ) : null}
      {document.sections.length ? <p className="outline-drag-hint">Centang beberapa bagian untuk menghapus atau mengurutkan bersama. Shift+klik memilih rentang. Geser handle untuk mengubah susunan atau lepas di atas Bab/Sub-bab untuk menjadikannya anak.</p> : null}
      {multiSelectedIds.length ? <div className="outline-selection-toolbar" aria-live="polite">
        <strong>{multiSelectedIds.length} outline dipilih</strong>
        <div className="outline-selection-toolbar__actions">
          <button type="button" className="button button--secondary" disabled={!canMoveSelection} title={canMoveSelection ? "Geser ke atas dalam tingkat yang sama" : "Pilih item pada tingkat outline yang sama untuk memindahkan bersama"} onClick={() => moveSelectedSiblings(-1)}><ArrowUp size={14} /> Naik</button>
          <button type="button" className="button button--secondary" disabled={!canMoveSelection} title={canMoveSelection ? "Geser ke bawah dalam tingkat yang sama" : "Pilih item pada tingkat outline yang sama untuk memindahkan bersama"} onClick={() => moveSelectedSiblings(1)}><ArrowDown size={14} /> Turun</button>
          <button type="button" className="button button--danger" onClick={() => setDeleteNodes(selectedEntries.map(({ node }) => node))}><Trash2 size={14} /> Hapus</button>
          <button type="button" className="outline-selection-toolbar__clear" onClick={() => setMultiSelectedIds([])}>Batal</button>
        </div>
      </div> : null}

      {document.sections.length ? (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="root" type="DOC_NODE" isCombineEnabled>
            {(drop, snapshot) => (
              <div
                ref={drop.innerRef}
                {...drop.droppableProps}
                className={`outline-tree ${snapshot.isDraggingOver ? "outline-tree--over" : ""}`}
              >
                {flatNodes.map((entry, index) => (
                  <OutlineRow
                    key={entry.node.id}
                    entry={entry}
                    index={index}
                    selectedNodeId={selectedNodeId}
                    multiSelected={multiSelectedIds.includes(entry.node.id)}
                    activeMenuId={activeMenuId}
                    onMenu={(id) => setActiveMenuId(activeMenuId === id ? null : id)}
                    onEdit={editNode}
                    onToggleSelection={toggleOutlineSelection}
                    onDuplicate={(item) => { duplicateNode(item.id); setActiveMenuId(null); }}
                    onMove={(item, direction) => { moveNodeByOffset(item.id, direction); setActiveMenuId(null); }}
                    onDelete={requestDelete}
                    onPageSetup={(item) => { setSettingsNode(item); setActiveMenuId(null); }}
                    treeView={tab === "tree"}
                    headingLabels={headingLabels}
                  />
                ))}
                {drop.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      ) : (
        <div className="outline-empty">
          <FileText size={23} />
          <p>Mulai susun dokumen dari bab pertama.</p>
          <button type="button" className="button button--primary" onClick={() => handleAdd("chapter")}><Plus size={16} /> Tambah Bab</button>
        </div>
      )}

      {settingsNode ? <PageNumberDialog key={settingsNode.id} node={settingsNode} documentSettings={document.pageNumbering} onClose={() => setSettingsNode(null)} onSave={savePageSettings} /> : null}
      {deleteNodes.length ? (
        <div className="dialog-backdrop" role="presentation">
          <section className="settings-dialog settings-dialog--compact" role="alertdialog" aria-modal="true" aria-labelledby="delete-node-title">
            <h2 id="delete-node-title">Hapus {deleteNodes.length > 1 ? `${deleteNodes.length} bagian terpilih?` : "bagian ini?"}</h2>
            <p>{deleteNodes.length > 1 ? "Semua bagian terpilih beserta turunannya akan dihapus dari dokumen." : <><strong>{headingLabels[deleteNodes[0].id] ?? (deleteNodes[0].title || nodeNames[deleteNodes[0].type])}</strong> dan semua node di bawahnya akan dihapus dari dokumen.</>}</p>
            <div className="settings-dialog__actions">
              <button type="button" className="button button--secondary" onClick={() => setDeleteNodes([])}>Batal</button>
              <button type="button" className="button button--danger" onClick={() => { removeNodes(deleteNodes.map((node) => node.id)); setDeleteNodes([]); setMultiSelectedIds([]); }}>Hapus {deleteNodes.length > 1 ? "semua" : "node"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </aside>
  );
}

function findNode(nodes, nodeId) {
  for (const node of nodes ?? []) {
    if (node.id === nodeId) return node;
    const nested = findNode(node.children, nodeId);
    if (nested) return nested;
  }
  return null;
}
