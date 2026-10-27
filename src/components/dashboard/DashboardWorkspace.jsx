"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Check, Copy, Download, FileText, FolderOpen, FolderPlus, Home, Pencil, Plus, RefreshCw, Search, Star, Trash2, Upload, X } from "lucide-react";
import AppHeader from "@/components/layout/AppHeader";
import CloudAccountPanel from "@/components/dashboard/CloudAccountPanel";
import { createDocumentNode, createEmptyDocument, createId, createThesisFrontMatter, DOCUMENT_PRESETS, PAPER_PRESETS } from "@/lib/document/schema";
import { validateDocument } from "@/lib/document/validation";
import { documentFromTextFile } from "@/lib/document/importText";
import { documentFromDocxFile } from "@/lib/document/importDocx";
import { importCustomPresets, readCustomPresets, validateCustomPresets } from "@/lib/document/customPresets";
import { deleteDocument, deleteFolder, listDocuments, listFolders, moveDocumentToFolder, restoreBackupRecords, saveDocument, saveFolder } from "@/lib/storage/documentStorage";
import { useDocumentStore } from "@/store/useDocumentStore";

const DOCUMENT_TEMPLATES = [
  { id: "empty", name: "Dokumen kosong", description: "Mulai dari outline tanpa bab.", chapters: [] },
  { id: "skripsi", name: "Skripsi", description: "Lima bab dengan kerangka penelitian umum.", chapters: [
    { title: "BAB I PENDAHULUAN", sections: ["Latar Belakang", "Rumusan Masalah", "Tujuan Penelitian", "Manfaat Penelitian"] },
    { title: "BAB II LANDASAN TEORI", sections: ["Tinjauan Pustaka", "Landasan Teori", "Kerangka Pemikiran"] },
    { title: "BAB III METODE PENELITIAN", sections: ["Jenis Penelitian", "Lokasi dan Waktu Penelitian", "Teknik Pengumpulan Data", "Teknik Analisis Data"] },
    { title: "BAB IV HASIL DAN PEMBAHASAN", sections: ["Hasil Penelitian", "Pembahasan"] },
    { title: "BAB V PENUTUP", sections: ["Kesimpulan", "Saran"] },
  ] },
  { id: "makalah", name: "Makalah", description: "Pendahuluan, pembahasan, dan penutup.", chapters: [
    { title: "BAB I PENDAHULUAN", sections: ["Latar Belakang", "Rumusan Masalah", "Tujuan Penulisan"] },
    { title: "BAB II PEMBAHASAN", sections: ["Pembahasan"] },
    { title: "BAB III PENUTUP", sections: ["Kesimpulan", "Saran"] },
  ] },
  { id: "laporan", name: "Laporan", description: "Kerangka laporan kegiatan atau penelitian.", chapters: [
    { title: "BAB I PENDAHULUAN", sections: ["Latar Belakang", "Tujuan", "Ruang Lingkup"] },
    { title: "BAB II GAMBARAN UMUM", sections: ["Profil", "Kondisi Umum"] },
    { title: "BAB III HASIL DAN PEMBAHASAN", sections: ["Hasil", "Pembahasan"] },
    { title: "BAB IV PENUTUP", sections: ["Kesimpulan", "Saran"] },
  ] },
  { id: "jurnal", name: "Artikel jurnal", description: "Struktur artikel ilmiah dengan halaman judul dan abstrak.", chapters: [
    { title: "PENDAHULUAN", sections: ["Latar Belakang", "Tujuan Penelitian"] },
    { title: "METODE PENELITIAN", sections: ["Jenis dan Desain Penelitian", "Pengumpulan dan Analisis Data"] },
    { title: "HASIL DAN PEMBAHASAN", sections: ["Hasil Penelitian", "Pembahasan"] },
    { title: "KESIMPULAN", sections: ["Kesimpulan", "Saran"] },
  ] },
];

function createOutlineFromTemplate(template) {
  const frontMatter = template.id === "empty" ? [] : template.id === "skripsi" ? createThesisFrontMatter() : [createDocumentNode("titlePage")];
  if (template.id === "jurnal") frontMatter.push(createDocumentNode("abstract"));
  return [...frontMatter, ...template.chapters.map((chapter, chapterIndex) => createDocumentNode("chapter", {
    title: chapter.title,
    ...(template.id === "jurnal" ? { plainHeading: true, pageStart: false } : {}),
    children: chapter.sections.map((section, index) => createDocumentNode("section", {
      title: `${chapterIndex + 1}.${index + 1} ${section}`,
      ...(template.id === "jurnal" ? { plainHeading: true } : {}),
    })),
  }))];
}

function formatUpdatedAt(value) {
  if (!value) return "Belum ada perubahan";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waktu tidak diketahui";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function getSearchableText(document) {
  const parts = [document.title ?? ""];
  const visit = (nodes = []) => nodes.forEach((node) => {
    parts.push(node.title ?? "", node.caption ?? "", node.altText ?? "");
    parts.push(node.keywords ?? "", ...Object.values(node.coverData ?? {}).map((value) => String(value ?? "")));
    if (node.content) parts.push(String(node.content).replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">"));
    if (Array.isArray(node.tableData?.rows)) parts.push(...node.tableData.rows.flat().map(String));
    if (Array.isArray(node.children)) visit(node.children);
  });
  visit(document.sections);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function getSearchMatchInfo(document, query) {
  if (!query) return null;
  const parts = [];
  const visit = (nodes = []) => nodes.forEach((node) => {
    if (node.title) parts.push({ label: "judul bagian", text: node.title });
    if (node.keywords) parts.push({ label: "kata kunci", text: node.keywords });
    Object.entries(node.coverData ?? {}).forEach(([field, value]) => { if (value) parts.push({ label: `halaman judul · ${field}`, text: String(value) }); });
    if (node.caption) parts.push({ label: "keterangan media", text: node.caption });
    if (node.content) parts.push({ label: "isi", text: String(node.content).replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">") });
    if (Array.isArray(node.tableData?.rows)) parts.push({ label: "tabel", text: node.tableData.rows.flat().join(" ") });
    if (Array.isArray(node.children)) visit(node.children);
  });
  visit(document.sections);
  const normalizedQuery = query.toLocaleLowerCase();
  if ((document.title ?? "").toLocaleLowerCase().includes(normalizedQuery)) return { label: "judul dokumen", excerpt: document.title };
  const match = parts.find((part) => part.text.toLocaleLowerCase().includes(normalizedQuery));
  if (!match) return null;
  const start = Math.max(0, match.text.toLocaleLowerCase().indexOf(normalizedQuery) - 38);
  const end = Math.min(match.text.length, start + 120);
  return { label: match.label, excerpt: `${start ? "…" : ""}${match.text.slice(start, end)}${end < match.text.length ? "…" : ""}` };
}

export default function DashboardWorkspace() {
  const router = useRouter();
  const [documents, setDocuments] = useState([]);
  const [folders, setFolders] = useState([]);
  const [activeFolderId, setActiveFolderId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [folderDialog, setFolderDialog] = useState(null);
  const [folderName, setFolderName] = useState("");
  const [folderBusy, setFolderBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState("recent");
  const [documentToDelete, setDocumentToDelete] = useState(null);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const backupInputRef = useRef(null);
  const textImportInputRef = useRef(null);

  const visibleDocuments = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return documents.filter((document) => (activeFolderId === "all" || document.folderId === activeFolderId)
      && (!query || getSearchableText(document).toLocaleLowerCase().includes(query)))
      .sort((left, right) => {
        if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
        if (sortMode === "title") return (left.title || "Dokumen Tanpa Judul").localeCompare(right.title || "Dokumen Tanpa Judul", "id");
        if (sortMode === "title-desc") return (right.title || "Dokumen Tanpa Judul").localeCompare(left.title || "Dokumen Tanpa Judul", "id");
        const difference = new Date(left.updatedAt) - new Date(right.updatedAt);
        return sortMode === "oldest" ? difference : -difference;
      });
  }, [documents, activeFolderId, searchQuery, sortMode]);

  const selectedVisibleDocuments = visibleDocuments.filter((document) => selectedIds.has(document.id));

  function changeActiveFolder(folderId) {
    setActiveFolderId(folderId);
    setSelectedIds(new Set());
  }

  function changeSearch(value) {
    setSearchQuery(value);
    setSelectedIds(new Set());
  }

  async function refreshData(showSpinner = true) {
    if (showSpinner) setLoading(true);
    setError("");
    try {
      const [savedDocuments, savedFolders] = await Promise.all([listDocuments(), listFolders()]);
      savedDocuments.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      savedFolders.sort((a, b) => a.name.localeCompare(b.name, "id"));
      setDocuments(savedDocuments);
      setFolders(savedFolders);
    } catch {
      setError("Penyimpanan lokal tidak dapat dibuka. Coba gunakan browser biasa, bukan mode privat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    Promise.all([listDocuments(), listFolders()])
      .then(([savedDocuments, savedFolders]) => {
        if (!active) return;
        savedDocuments.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        savedFolders.sort((a, b) => a.name.localeCompare(b.name, "id"));
        setDocuments(savedDocuments);
        setFolders(savedFolders);
      })
      .catch(() => { if (active) setError("Penyimpanan lokal tidak dapat dibuka. Coba gunakan browser biasa, bukan mode privat."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function createDocument(templateId = "empty") {
    setCreating(true);
    setError("");
    try {
      const template = DOCUMENT_TEMPLATES.find((item) => item.id === templateId) ?? DOCUMENT_TEMPLATES[0];
      const baseDocument = createEmptyDocument();
      const presetName = template.id === "makalah" ? "Makalah" : template.id === "jurnal" ? "Jurnal" : "Skripsi 4-4-3-3";
      const preset = DOCUMENT_PRESETS[presetName];
      const document = { ...baseDocument, preset: presetName, paper: { ...baseDocument.paper, size: preset.paper, ...PAPER_PRESETS[preset.paper] }, margins: { ...preset.margins }, documentKind: template.id === "empty" ? "general" : template.id, folderId: activeFolderId === "all" ? null : activeFolderId, sections: createOutlineFromTemplate(template) };
      await saveDocument(document);
      useDocumentStore.getState().loadDocument(document);
      if (document.sections.length) useDocumentStore.getState().selectNode(document.sections[0].id);
      router.push(`/editor/${document.id}`);
    } catch {
      setError("Dokumen baru belum bisa disimpan di browser ini. Coba muat ulang halaman.");
      setCreating(false);
    }
  }

  function openCreateDialog() { setCreateDialogOpen(true); }

  function openFolderDialog(mode, folder = null) {
    setFolderName(folder?.name ?? "");
    setFolderDialog({ mode, folder });
  }

  async function saveFolderDialog(event) {
    event.preventDefault();
    const name = folderName.trim();
    if (folderDialog?.mode !== "delete" && !name) return;
    if (folderDialog?.mode !== "delete" && folders.some((folder) => folder.id !== folderDialog.folder?.id && folder.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setError("Nama folder itu sudah digunakan.");
      return;
    }
    setFolderBusy(true);
    setError("");
    try {
      if (folderDialog.mode === "delete") {
        await deleteFolder(folderDialog.folder.id);
        if (activeFolderId === folderDialog.folder.id) changeActiveFolder("all");
      } else {
        const saved = await saveFolder({ id: folderDialog.folder?.id ?? createId(), name });
        if (folderDialog.mode === "create") changeActiveFolder(saved.id);
      }
      setFolderDialog(null);
      await refreshData(false);
    } catch {
      setError("Folder gagal disimpan. Muat ulang halaman, lalu coba lagi.");
    } finally {
      setFolderBusy(false);
    }
  }

  async function moveDocument(documentId, folderId) {
    try {
      await moveDocumentToFolder(documentId, folderId || null);
      await refreshData(false);
    } catch {
      setError("Dokumen gagal dipindahkan ke folder.");
    }
  }

  async function togglePinned(document) {
    setDocumentBusy(true);
    setError("");
    try {
      const updated = { ...document, pinned: !document.pinned };
      await saveDocument(updated);
      setDocuments((current) => current.map((item) => item.id === document.id ? updated : item));
    } catch {
      setError("Status dokumen penting gagal disimpan.");
    } finally {
      setDocumentBusy(false);
    }
  }

  async function duplicateDocument(document) {
    setDocumentBusy(true);
    setError("");
    try {
      const duplicate = structuredClone(document);
      const now = new Date().toISOString();
      duplicate.id = createId();
      duplicate.title = `${document.title || "Dokumen Tanpa Judul"} (salinan)`;
      duplicate.createdAt = now;
      duplicate.updatedAt = now;
      await saveDocument(duplicate);
      await refreshData(false);
    } catch {
      setError("Dokumen gagal diduplikasi. Coba lagi setelah memuat ulang halaman.");
    } finally {
      setDocumentBusy(false);
    }
  }

  function toggleDocumentSelection(documentId) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  }

  function toggleSelectVisibleDocuments() {
    const allVisibleSelected = visibleDocuments.length > 0 && visibleDocuments.every((document) => selectedIds.has(document.id));
    setSelectedIds(allVisibleSelected ? new Set() : new Set(visibleDocuments.map((document) => document.id)));
  }

  async function runBulkAction(action, value = null) {
    const selected = selectedVisibleDocuments;
    if (!selected.length) return;
    if (action === "delete" && !window.confirm(`Hapus ${selected.length} dokumen terpilih? Tindakan ini tidak dapat dibatalkan.`)) return;
    setBulkBusy(true);
    setError("");
    setNotice("");
    try {
      if (action === "pin" || action === "unpin") {
        const pinned = action === "pin";
        await Promise.all(selected.map((document) => saveDocument({ ...document, pinned })));
        await refreshData(false);
        setNotice(`${selected.length} dokumen ${pinned ? "ditandai penting" : "dilepas dari daftar penting"}.`);
      } else if (action === "move") {
        await Promise.all(selected.map((document) => moveDocumentToFolder(document.id, value || null)));
        await refreshData(false);
        setNotice(`${selected.length} dokumen dipindahkan ke ${folders.find((folder) => folder.id === value)?.name ?? "Semua dokumen"}.`);
      } else if (action === "delete") {
        await Promise.all(selected.map((document) => deleteDocument(document.id)));
        await refreshData(false);
        setNotice(`${selected.length} dokumen berhasil dihapus.`);
      }
      setSelectedIds(new Set());
      setSelectMode(false);
    } catch {
      await refreshData(false);
      setError("Sebagian tindakan massal gagal. Daftar sudah dimuat ulang; periksa pilihan sebelum mencoba lagi.");
    } finally {
      setBulkBusy(false);
    }
  }

  function downloadSelectedBackup() {
    const selected = selectedVisibleDocuments;
    if (!selected.length) return;
    const folderIds = new Set(selected.map((document) => document.folderId).filter(Boolean));
    const backup = {
      format: "doccraft-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      documents: selected,
      folders: folders.filter((folder) => folderIds.has(folder.id)),
      customPresets: readCustomPresets(),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `DocCraft-pilihan-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.style.display = "none";
    window.document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function confirmDeleteDocument() {
    if (!documentToDelete) return;
    setDocumentBusy(true);
    setError("");
    try {
      await deleteDocument(documentToDelete.id);
      setDocumentToDelete(null);
      await refreshData(false);
    } catch {
      setError("Dokumen gagal dihapus.");
    } finally {
      setDocumentBusy(false);
    }
  }

  async function downloadBackup() {
    setBackupBusy(true);
    setError("");
    try {
      const [savedDocuments, savedFolders] = await Promise.all([listDocuments(), listFolders()]);
      const backup = { format: "doccraft-backup", version: 1, exportedAt: new Date().toISOString(), documents: savedDocuments, folders: savedFolders, customPresets: readCustomPresets() };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `DocCraft-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.style.display = "none";
      window.document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch {
      setError("Backup gagal dibuat. Pastikan penyimpanan browser dapat dibuka.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBackupBusy(true);
    setError("");
    try {
      const backup = JSON.parse(await file.text());
      if (backup?.format !== "doccraft-backup" || backup.version !== 1 || !Array.isArray(backup.documents) || !Array.isArray(backup.folders)) {
        throw new Error("File bukan backup DocCraft yang dikenali.");
      }
      const folderIds = new Map();
      const importedFolders = backup.folders.map((folder) => {
        if (!folder || typeof folder.name !== "string" || !folder.name.trim()) throw new Error("Ada data folder yang tidak valid.");
        const id = createId();
        folderIds.set(folder.id, id);
        return { ...folder, id, name: folder.name.trim(), updatedAt: new Date().toISOString() };
      });
      const importedDocuments = backup.documents.map((document) => {
        const result = validateDocument(document);
        if (!result.valid) throw new Error(`Dokumen backup tidak valid: ${result.errors[0]}`);
        return {
          ...structuredClone(document),
          id: createId(),
          folderId: folderIds.get(document.folderId) ?? null,
          updatedAt: new Date().toISOString(),
        };
      });
      const presetsToImport = backup.customPresets ?? [];
      validateCustomPresets(presetsToImport);
      if (!window.confirm(`Backup berisi ${importedDocuments.length} dokumen, ${importedFolders.length} folder, dan ${Array.isArray(presetsToImport) ? presetsToImport.length : 0} preset kustom. Data akan ditambahkan sebagai salinan baru tanpa menimpa dokumen yang ada. Lanjutkan?`)) return;
      await restoreBackupRecords(importedDocuments, importedFolders);
      let importedPresetCount = 0;
      let presetWarning = "";
      try {
        const result = importCustomPresets(presetsToImport);
        importedPresetCount = result.importedCount;
      } catch {
        presetWarning = " Preset kustom tidak dapat dipulihkan.";
      }
      await refreshData(false);
      setNotice(`${importedDocuments.length} dokumen, ${importedFolders.length} folder, dan ${importedPresetCount} preset kustom berhasil dipulihkan.${presetWarning}`);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Backup tidak dapat dipulihkan.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function importTextFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setNotice("");
    const extension = file.name.toLocaleLowerCase().split(".").pop();
    if (!["txt", "md", "markdown", "docx"].includes(extension)) {
      setError("Pilih berkas .txt, .md, .markdown, atau .docx.");
      return;
    }
    const isWordDocument = extension === "docx";
    if (file.size > (isWordDocument ? 25 : 10) * 1024 * 1024) {
      setError(`Berkas ${isWordDocument ? "Word" : "teks"} maksimal ${isWordDocument ? 25 : 10} MB.`);
      return;
    }
    setBackupBusy(true);
    try {
      const importedDocument = isWordDocument
        ? await documentFromDocxFile(file, activeFolderId === "all" ? null : activeFolderId)
        : documentFromTextFile(file.name, await file.text(), activeFolderId === "all" ? null : activeFolderId);
      const result = validateDocument(importedDocument);
      if (!result.valid) throw new Error(`Berkas tidak dapat diimpor: ${result.errors[0]}`);
      const importWarning = importedDocument.importWarning;
      delete importedDocument.importWarning;
      await saveDocument(importedDocument);
      if (importWarning) window.alert(importWarning);
      router.push(`/editor/${importedDocument.id}`);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Berkas teks gagal diimpor.");
      setBackupBusy(false);
    }
  }

  const activeFolder = folders.find((folder) => folder.id === activeFolderId);

  return (
    <main className="dashboard-page">
      <AppHeader />
      <div className="dashboard-layout">
        <aside className="dashboard-sidebar" aria-label="Navigasi dokumen">
          <button type="button" className={`dashboard-nav-item ${activeFolderId === "all" ? "is-active" : ""}`} onClick={() => changeActiveFolder("all")}><Home size={16} /> Semua dokumen</button>
          <div className="dashboard-sidebar__heading"><span>Folder</span><button type="button" title="Buat folder" aria-label="Buat folder" onClick={() => openFolderDialog("create")}><FolderPlus size={16} /></button></div>
          {folders.length ? folders.map((folder) => (
            <div className={`dashboard-folder-row ${activeFolderId === folder.id ? "is-active" : ""}`} key={folder.id}>
              <button type="button" className="dashboard-folder-row__select" onClick={() => changeActiveFolder(folder.id)}><FolderOpen size={15} /><span>{folder.name}</span><small>{documents.filter((document) => document.folderId === folder.id).length}</small></button>
              <div className="dashboard-folder-row__actions">
                <button type="button" title="Ubah nama folder" aria-label={`Ubah nama ${folder.name}`} onClick={() => openFolderDialog("rename", folder)}><Pencil size={13} /></button>
                <button type="button" title="Hapus folder" aria-label={`Hapus ${folder.name}`} onClick={() => openFolderDialog("delete", folder)}><Trash2 size={13} /></button>
              </div>
            </div>
          )) : <p className="dashboard-sidebar__empty">Belum ada folder.</p>}
          <button type="button" className="dashboard-sidebar__add" onClick={() => openFolderDialog("create")}><Plus size={14} /> Tambah folder</button>
        </aside>

        <section className="dashboard-content dashboard-content--main">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="eyebrow">Ruang kerja akademik</p>
              <h1 className="dashboard-title">{activeFolder ? activeFolder.name : "Dokumen Anda"}</h1>
              <p className="dashboard-subtitle">Dokumen disimpan di browser ini dan dapat dibuka kembali.</p>
            </div>
            <div className="dashboard-toolbar-actions">
              <input ref={backupInputRef} type="file" accept="application/json,.json" className="sr-only" onChange={importBackup} aria-label="Pilih file backup DocCraft" />
              <input ref={textImportInputRef} type="file" accept=".txt,.md,.markdown,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" onChange={importTextFile} aria-label="Pilih file teks, Markdown, atau Word" />
              {documents.length ? <button type="button" onClick={() => { setSelectMode((value) => !value); setSelectedIds(new Set()); }} className="button button--secondary min-h-11 px-3 text-sm"><Check size={16} /> {selectMode ? "Batal pilih" : "Pilih banyak"}</button> : null}
              <button type="button" onClick={() => textImportInputRef.current?.click()} disabled={backupBusy} className="button button--secondary min-h-11 px-3 text-sm"><FileText size={16} /> Impor Word/teks</button>
              <button type="button" onClick={downloadBackup} disabled={backupBusy || (documents.length === 0 && folders.length === 0)} className="button button--secondary min-h-11 px-3 text-sm"><Download size={16} /> {backupBusy ? "Memproses..." : "Backup"}</button>
              <button type="button" onClick={() => backupInputRef.current?.click()} disabled={backupBusy} className="button button--secondary min-h-11 px-3 text-sm"><Upload size={16} /> Pulihkan</button>
              <button type="button" onClick={openCreateDialog} disabled={creating} className="button button--primary min-h-11 px-4 text-sm"><Plus size={18} /> Buat dokumen</button>
            </div>
          </div>

          <CloudAccountPanel />

          {error ? <div role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
          {notice ? <div role="status" className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}
          {!loading && documents.length > 0 ? <div className="dashboard-document-tools"><label className="dashboard-search"><Search size={16} /><input type="search" value={searchQuery} onChange={(event) => changeSearch(event.target.value)} placeholder="Cari judul dan isi dokumen..." aria-label="Cari dokumen berdasarkan judul atau isi" />{searchQuery ? <button type="button" onClick={() => changeSearch("")} aria-label="Hapus pencarian" title="Hapus pencarian"><X size={15} /></button> : null}</label><label className="dashboard-sort">Urutkan<select value={sortMode} onChange={(event) => setSortMode(event.target.value)} aria-label="Urutkan dokumen"><option value="recent">Terbaru</option><option value="oldest">Terlama</option><option value="title">Nama A–Z</option><option value="title-desc">Nama Z–A</option></select></label><span className="dashboard-result-count" aria-live="polite">{visibleDocuments.length} dari {documents.length} dokumen</span></div> : null}
          {selectMode && visibleDocuments.length ? <div className="dashboard-bulk-toolbar" role="group" aria-label="Tindakan massal dokumen">
            <button type="button" className="button button--secondary" onClick={toggleSelectVisibleDocuments} disabled={bulkBusy}>{visibleDocuments.length && visibleDocuments.every((document) => selectedIds.has(document.id)) ? "Batalkan pilihan tampil" : "Pilih semua yang tampil"}</button>
            <span className="dashboard-result-count">{selectedVisibleDocuments.length} dipilih</span>
            <label className="dashboard-sort">Pindah ke<select value="" onChange={(event) => { if (event.target.value !== "__none__") runBulkAction("move", event.target.value); }} disabled={bulkBusy || !selectedVisibleDocuments.length} aria-label="Pindahkan dokumen terpilih ke folder"><option value="" disabled>Folder tujuan</option><option value="__none__">Semua dokumen</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
            <button type="button" className="button button--secondary" onClick={() => runBulkAction("pin")} disabled={bulkBusy || !selectedVisibleDocuments.length}>Tandai penting</button>
            <button type="button" className="button button--secondary" onClick={() => runBulkAction("unpin")} disabled={bulkBusy || !selectedVisibleDocuments.length}>Lepas tanda penting</button>
            <button type="button" className="button button--secondary" onClick={downloadSelectedBackup} disabled={!selectedVisibleDocuments.length}><Download size={14} /> Ekspor pilihan</button>
            <button type="button" className="button button--danger" onClick={() => runBulkAction("delete")} disabled={bulkBusy || !selectedVisibleDocuments.length}><Trash2 size={14} /> Hapus pilihan</button>
          </div> : null}
          {loading ? <div className="dashboard-loading" role="status"><span className="loading-spinner" /> Memuat dokumen lokal...</div> : visibleDocuments.length > 0 ? (
            <div className="dashboard-grid">
              <button type="button" onClick={openCreateDialog} disabled={creating} className="document-card document-card--create"><span className="document-card__icon"><Plus size={23} /></span><span className="document-card__title">Buat dokumen baru</span><span className="document-card__meta">Pilih template atau mulai kosong</span></button>
              {visibleDocuments.map((document) => {
                const matchInfo = getSearchMatchInfo(document, searchQuery.trim());
                return (
                <article key={document.id} className="document-card document-card--saved dashboard-document-card">
                  {selectMode ? <label className="dashboard-document-card__select"><input type="checkbox" checked={selectedIds.has(document.id)} onChange={() => toggleDocumentSelection(document.id)} aria-label={`Pilih ${document.title || "dokumen"}`} /> Pilih</label> : null}
                  <button type="button" className="dashboard-document-card__open" onClick={() => router.push(`/editor/${document.id}`)}>
                    <FileText className="document-card__icon" size={30} />
                    <span className="document-card__title">{document.title || "Dokumen Tanpa Judul"}</span>
                    <span className="document-card__meta">Terakhir diubah {formatUpdatedAt(document.updatedAt)}</span>
                  </button>
                  {matchInfo ? <p className="dashboard-document-card__match"><strong>{matchInfo.label}:</strong> {matchInfo.excerpt}</p> : null}
                  <div className="dashboard-document-card__actions">
                    <button type="button" disabled={documentBusy} onClick={() => togglePinned(document)} aria-pressed={Boolean(document.pinned)} title={document.pinned ? "Lepas dari dokumen penting" : "Tandai sebagai dokumen penting"}><Star size={13} fill={document.pinned ? "currentColor" : "none"} /> {document.pinned ? "Penting" : "Tandai"}</button>
                    <button type="button" disabled={documentBusy} onClick={() => duplicateDocument(document)}><Copy size={13} /> Duplikat</button>
                    <button type="button" disabled={documentBusy} onClick={() => setDocumentToDelete(document)}><Trash2 size={13} /> Hapus</button>
                  </div>
                  <label className="dashboard-document-card__folder"><FolderOpen size={13} /><span>Folder</span>
                    <select aria-label={`Folder untuk ${document.title || "dokumen"}`} value={document.folderId ?? ""} onChange={(event) => moveDocument(document.id, event.target.value)}>
                      <option value="">Tidak ada</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                    </select>
                  </label>
                </article>
                );
              })}
            </div>
          ) : (
            (searchQuery.trim() || (activeFolderId === "all" && documents.length > 0)) ? <div className="dashboard-empty"><span className="dashboard-empty__icon"><Search size={25} /></span><h2>Tidak ada dokumen yang cocok</h2><p>Coba kata pencarian lain atau ubah folder yang dipilih.</p><button type="button" className="button button--secondary mt-4" onClick={() => changeSearch("")}>Hapus pencarian</button></div> : <div className="dashboard-empty"><span className="dashboard-empty__icon">{activeFolder ? <FolderOpen size={26} /> : <FileText size={26} />}</span><h2>{activeFolder ? "Folder ini masih kosong" : "Belum ada dokumen"}</h2><p>{activeFolder ? "Pindahkan dokumen yang sudah ada ke folder ini atau buat dokumen baru." : "Buat dokumen pertama. Perubahan judul akan tersimpan otomatis di browser ini."}</p><button type="button" onClick={openCreateDialog} disabled={creating} className="button button--primary mt-4"><Plus size={17} /> Buat dokumen</button></div>
          )}
          <button type="button" onClick={() => refreshData(true)} disabled={loading} className="button button--ghost mt-5 text-xs"><RefreshCw size={14} /> Muat ulang daftar</button>
          <p className="dashboard-footnote">Impor Word membaca judul, teks berformat, tabel, gambar berukuran maksimal 5 MB, dan pengaturan halaman dari .docx hingga 25 MB. Impor .txt/Markdown hingga 10 MB; judul # menjadi bab, ## sub-bab, dan ### anak sub-bab.</p>
        </section>
      </div>

      {createDialogOpen ? <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateDialogOpen(false); }}>
        <section className="settings-dialog template-dialog" role="dialog" aria-modal="true" aria-labelledby="create-document-title">
          <div className="settings-dialog__header"><div><p className="eyebrow">Dokumen baru</p><h2 id="create-document-title">Pilih struktur awal</h2></div><button type="button" className="icon-button icon-button--light" onClick={() => setCreateDialogOpen(false)} aria-label="Tutup">×</button></div>
          <div className="template-grid">{DOCUMENT_TEMPLATES.map((template) => <button type="button" key={template.id} disabled={creating} className="template-option" onClick={() => { setCreateDialogOpen(false); createDocument(template.id); }}><span className="template-option__icon">{template.id === "empty" ? <FileText size={18} /> : <BookOpen size={18} />}</span><strong>{template.name}</strong><small>{template.description}</small><span className="template-option__count">{template.chapters.length ? `${template.chapters.length} bagian` : "Kosong"}</span></button>)}</div>
        </section>
      </div> : null}

      {folderDialog ? <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFolderDialog(null); }}>
        <form className="settings-dialog settings-dialog--compact" role="dialog" aria-modal="true" onSubmit={saveFolderDialog}>
          {folderDialog.mode === "delete" ? <><h2>Hapus folder ini?</h2><p>Folder <strong>{folderDialog.folder.name}</strong> akan dihapus. Dokumen di dalamnya tetap ada dan dipindahkan ke “Semua dokumen”.</p></> : <><div className="settings-dialog__header"><div><p className="eyebrow">Pengelolaan folder</p><h2>{folderDialog.mode === "create" ? "Folder baru" : "Ubah nama folder"}</h2></div><button type="button" className="icon-button icon-button--light" onClick={() => setFolderDialog(null)} aria-label="Tutup">×</button></div><label className="editor-field-label" htmlFor="folder-name">Nama folder</label><input id="folder-name" autoFocus maxLength={50} value={folderName} onChange={(event) => setFolderName(event.target.value)} className="editor-text-input" placeholder="Contoh: Skripsi" /></>}
          <div className="settings-dialog__actions"><button type="button" className="button button--secondary" onClick={() => setFolderDialog(null)}>Batal</button><button type="submit" disabled={folderBusy} className={`button ${folderDialog.mode === "delete" ? "button--danger" : "button--primary"}`}>{folderBusy ? "Menyimpan..." : folderDialog.mode === "delete" ? "Hapus folder" : "Simpan"}</button></div>
        </form>
      </div> : null}
      {documentToDelete ? <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !documentBusy) setDocumentToDelete(null); }}>
        <section className="settings-dialog settings-dialog--compact" role="alertdialog" aria-modal="true" aria-labelledby="delete-document-title">
          <h2 id="delete-document-title">Hapus dokumen ini?</h2>
          <p><strong>{documentToDelete.title || "Dokumen Tanpa Judul"}</strong> akan dihapus permanen dari penyimpanan browser ini.</p>
          <div className="settings-dialog__actions"><button type="button" disabled={documentBusy} className="button button--secondary" onClick={() => setDocumentToDelete(null)}>Batal</button><button type="button" disabled={documentBusy} className="button button--danger" onClick={confirmDeleteDocument}>{documentBusy ? "Menghapus..." : "Hapus dokumen"}</button></div>
        </section>
      </div> : null}
    </main>
  );
}
