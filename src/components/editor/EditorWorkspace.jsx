"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import AppHeader from "@/components/layout/AppHeader";
import ContentEditorPanel from "@/components/content-editor/ContentEditorPanel";
import LivePreviewCanvas from "@/components/preview/LivePreviewCanvas";
import OutlinePanel from "@/components/outline/OutlinePanel";
import { exportDocumentToDocx } from "@/lib/export/docx";
import { exportDocumentToPdf } from "@/lib/export/pdf";
import { createEmptyDocument, createThesisFrontMatter } from "@/lib/document/schema";
import { readCustomPresets, removeCustomPreset, saveCustomPreset } from "@/lib/document/customPresets";
import { getDocument, saveDocument } from "@/lib/storage/documentStorage";
import { countDocumentMatches } from "@/lib/document/textSearch";
import { auditDocument } from "@/lib/document/audit";
import { useDocumentStore } from "@/store/useDocumentStore";

const QUICK_INSERT_ITEMS = [
  { type: "chapter", label: "Bab", description: "Tambahkan bab utama di akhir outline.", values: { title: "BAB baru" } },
  { type: "section", label: "Sub-bab", description: "Tambahkan sub-bab di lokasi terpilih.", values: { title: "Sub-bab baru" } },
  { type: "subsection", label: "Anak sub-bab", description: "Tambahkan anak sub-bab di lokasi terpilih.", values: { title: "Anak sub-bab baru" } },
  { type: "paragraph", label: "Paragraf", description: "Sisipkan paragraf baru.", values: { title: "Paragraf baru" } },
  { type: "image", label: "Gambar", description: "Buat node gambar, lalu unggah berkasnya.", values: { title: "Gambar baru", caption: "" } },
  { type: "table", label: "Tabel", description: "Sisipkan tabel kosong 2 × 2.", values: { title: "Tabel baru", caption: "", tableData: { rows: [["", ""], ["", ""]] } } },
  { type: "pageBreak", label: "Pemisah halaman", description: "Mulai materi berikutnya di halaman baru.", values: { title: "Pemisah halaman" } },
  { type: "tableOfContents", label: "Daftar isi otomatis", description: "Buat daftar judul dari bab dan sub-bab.", values: { title: "DAFTAR ISI" } },
  { type: "listOfFigures", label: "Daftar gambar otomatis", description: "Buat daftar gambar dari caption gambar dan nomor halaman pratinjau.", values: { title: "DAFTAR GAMBAR" } },
  { type: "listOfTables", label: "Daftar tabel otomatis", description: "Buat daftar tabel dari caption tabel dan nomor halaman pratinjau.", values: { title: "DAFTAR TABEL" } },
  { type: "titlePage", label: "Halaman judul", description: "Sisipkan halaman judul dengan identitas penulis dan institusi.", values: { title: "HALAMAN JUDUL" } },
  { type: "abstract", label: "Abstrak", description: "Sisipkan abstrak dengan bidang kata kunci.", values: { title: "ABSTRAK" } },
  { type: "frontMatterPack", label: "Paket halaman awal skripsi", description: "Cover, pengesahan, persetujuan pembimbing dan penguji, lembar keaslian, kata pengantar, abstrak, dan daftar otomatis.", values: {} },
];

function queueDocumentSave(queueRef, documentData) {
  const pending = queueRef.current.catch(() => {}).then(() => saveDocument(documentData));
  queueRef.current = pending;
  return pending;
}

export default function EditorWorkspace({ documentId }) {
  const router = useRouter();
  const document = useDocumentStore((state) => state.document);
  const setDocumentTitle = useDocumentStore((state) => state.setDocumentTitle);
  const setPreset = useDocumentStore((state) => state.setPreset);
  const undo = useDocumentStore((state) => state.undo);
  const redo = useDocumentStore((state) => state.redo);
  const canUndo = useDocumentStore((state) => state.past.length > 0);
  const canRedo = useDocumentStore((state) => state.future.length > 0);
  const replaceDocumentText = useDocumentStore((state) => state.replaceDocumentText);
  const addNode = useDocumentStore((state) => state.addNode);
  const addNodes = useDocumentStore((state) => state.addNodes);
  const addNodeAtSelection = useDocumentStore((state) => state.addNodeAtSelection);
  const selectedNodeId = useDocumentStore((state) => state.selectedNodeId);
  const selectNode = useDocumentStore((state) => state.selectNode);
  const setDocumentKind = useDocumentStore((state) => state.setDocumentKind);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState("saved");
  const [exporting, setExporting] = useState("");
  const [exportError, setExportError] = useState("");
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [replacementText, setReplacementText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWords, setWholeWords] = useState(false);
  const [replaceNotice, setReplaceNotice] = useState("");
  const [quickInsertOpen, setQuickInsertOpen] = useState(false);
  const [quickInsertQuery, setQuickInsertQuery] = useState("");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [pendingExport, setPendingExport] = useState(null);
  const [loadError, setLoadError] = useState({ documentId: null, message: "" });
  const [customPresets, setCustomPresets] = useState([]);
  const createdDocumentRef = useRef(null);
  const saveQueueRef = useRef(Promise.resolve());
  const audit = useMemo(() => auditDocument(document), [document]);

  const quickInsertResults = QUICK_INSERT_ITEMS.filter((item) => `${item.label} ${item.description}`.toLocaleLowerCase().includes(quickInsertQuery.trim().toLocaleLowerCase()));
  const findOptions = { caseSensitive, wholeWords };
  const insertQuickItem = useCallback((item) => {
    if (item.type === "frontMatterPack") addNodes(createThesisFrontMatter(), null);
    else if (item.type === "chapter") addNode(item.type, item.values, null);
    else addNodeAtSelection(item.type, item.values, selectedNodeId);
    setQuickInsertOpen(false);
    setQuickInsertQuery("");
  }, [addNode, addNodes, addNodeAtSelection, selectedNodeId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setCustomPresets(readCustomPresets()); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        let loadedDocument;
        if (documentId === "new") {
          if (!createdDocumentRef.current) createdDocumentRef.current = createEmptyDocument();
          loadedDocument = createdDocumentRef.current;
          await saveDocument(loadedDocument);
        } else {
          loadedDocument = await getDocument(documentId);
          if (!loadedDocument) {
            loadedDocument = createEmptyDocument(documentId);
            await saveDocument(loadedDocument);
          }
        }
        if (!active) return;
        const result = useDocumentStore.getState().loadDocument(loadedDocument);
        if (!result.valid) throw new Error(result.errors.join(" "));
        setReady(true);
        if (documentId === "new") router.replace(`/editor/${loadedDocument.id}`);
      } catch {
        if (active) setLoadError({ documentId, message: "Dokumen tidak dapat dimuat atau penyimpanan browser tidak tersedia." });
      }
    }

    load();
    return () => { active = false; };
  }, [documentId, router]);

  useEffect(() => {
    if (!ready || !document) return undefined;
    const documentToSave = document;
    const timer = window.setTimeout(async () => {
      setSaveStatus("saving");
      try {
        await queueDocumentSave(saveQueueRef, documentToSave);
        if (useDocumentStore.getState().document?.updatedAt === documentToSave.updatedAt) setSaveStatus("saved");
      } catch {
        if (useDocumentStore.getState().document?.updatedAt === documentToSave.updatedAt) setSaveStatus("error");
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [document, ready]);

  const handleSaveNow = useCallback(async () => {
    if (!ready) return;
    const documentToSave = useDocumentStore.getState().document;
    if (!documentToSave) return;
    setSaveStatus("saving");
    try {
      await queueDocumentSave(saveQueueRef, documentToSave);
      if (useDocumentStore.getState().document?.updatedAt === documentToSave.updatedAt) setSaveStatus("saved");
    } catch {
      if (useDocumentStore.getState().document?.updatedAt === documentToSave.updatedAt) setSaveStatus("error");
    }
  }, [ready]);

  useEffect(() => {
    function handleSaveShortcut(event) {
      if (event.key === "Escape") {
        setQuickInsertOpen(false);
        setShortcutsOpen(false);
        setFindReplaceOpen(false);
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setQuickInsertQuery("");
        setQuickInsertOpen(true);
        return;
      }
      if (key === "/" || key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (key === "s") {
        event.preventDefault();
        handleSaveNow();
        return;
      }
      if (key === "h") {
        event.preventDefault();
        setFindReplaceOpen(true);
        setReplaceNotice("");
        return;
      }
      const isFormField = event.target instanceof HTMLElement
        && Boolean(event.target.closest("input, textarea, select"));
      if (isFormField) return;
      if (event.key === "Enter") {
        event.preventDefault();
        insertQuickItem(QUICK_INSERT_ITEMS.find((item) => item.type === "pageBreak"));
        return;
      }
      if (event.altKey) {
        const shortcutType = key === "p" ? "paragraph"
          : key === "t" ? "table"
            : key === "i" ? "image"
              : key === "c" && event.shiftKey ? "chapter" : null;
        if (shortcutType) {
          event.preventDefault();
          const shortcutItem = QUICK_INSERT_ITEMS.find((item) => item.type === shortcutType);
          if (shortcutItem) insertQuickItem(shortcutItem);
          return;
        }
      }
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (key === "z") {
        event.preventDefault();
        undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [handleSaveNow, insertQuickItem, redo, undo]);

  async function handleExport(format, auditConfirmed = false) {
    if (!document || exporting) return;
    if (!auditConfirmed && audit.warnings > 0) {
      setPendingExport(format);
      setAuditOpen(true);
      return;
    }
    setExportError("");
    setExporting(format);
    try {
      if (format === "docx") await exportDocumentToDocx(document);
      else await exportDocumentToPdf(document);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Dokumen gagal diekspor.");
    } finally {
      setExporting("");
    }
  }

  function closeAudit() {
    setAuditOpen(false);
    setPendingExport(null);
  }

  function handleSaveCustomPreset(name, configuration = null) {
    const settings = configuration ?? document;
    const saved = saveCustomPreset(name, settings.paper, settings.margins, settings.typography, settings.paragraph, {
      outlineStyles: settings.outlineStyles,
      pageNumbering: settings.pageNumbering,
    });
    setCustomPresets((current) => [...current, saved]);
    setPreset(saved.name, saved);
  }

  function handleDeleteCustomPreset(id) {
    setCustomPresets(removeCustomPreset(id));
  }

  function handlePresetChange(name) {
    const custom = customPresets.find((item) => item.name === name);
    setPreset(name, custom ?? null);
  }

  if (loadError.documentId === documentId && loadError.message) {
    return (
      <main className="min-h-screen bg-slate-100">
        <AppHeader mode="editor" documentTitle="Dokumen tidak tersedia" />
        <div role="alert" className="mx-auto mt-12 max-w-xl rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <p className="font-semibold text-red-800">{loadError.message}</p>
          <button type="button" onClick={() => router.push("/")} className="button button--secondary mt-4">Kembali ke dashboard</button>
        </div>
      </main>
    );
  }

  if (!ready || !document || document.id !== documentId) {
    return <main className="min-h-screen bg-slate-100"><AppHeader mode="editor" /><div className="dashboard-loading"><span className="loading-spinner" /> Membuka dokumen...</div></main>;
  }

  return (
    <main className="editor-shell">
      <AppHeader
        mode="editor"
        documentTitle={document.title}
        onTitleChange={(event) => setDocumentTitle(event.target.value)}
        saveStatus={saveStatus}
        onSaveNow={handleSaveNow}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        onFindReplace={() => { setFindReplaceOpen(true); setReplaceNotice(""); }}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onOpenAudit={() => setAuditOpen(true)}
        preset={document.preset}
        onPresetChange={handlePresetChange}
        customPresets={customPresets}
        onExportDocx={() => handleExport("docx")}
        onExportPdf={() => handleExport("pdf")}
        exporting={exporting}
        exportError={exportError}
      />
      <div className="editor-columns">
        <OutlinePanel />

        <ContentEditorPanel customPresets={customPresets} onSaveCustomPreset={handleSaveCustomPreset} onDeleteCustomPreset={handleDeleteCustomPreset} onSaveNow={handleSaveNow} />

        <LivePreviewCanvas />
      </div>
      {auditOpen ? <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAudit(); }}>
        <section className="settings-dialog manuscript-audit-dialog" role="dialog" aria-modal="true" aria-labelledby="manuscript-audit-title">
          <div className="settings-dialog__header"><div><p className="eyebrow">Pemeriksaan naskah</p><h2 id="manuscript-audit-title">Kelengkapan dan konsistensi</h2></div><button type="button" className="icon-button icon-button--light" onClick={closeAudit} aria-label="Tutup">×</button></div>
          <p className="manuscript-audit-summary">{audit.warnings ? `${audit.warnings} hal perlu ditinjau` : "Tidak ada masalah utama yang terdeteksi"}{audit.infos ? ` · ${audit.infos} saran` : ""}</p>
          <p className="content-editor__helper">{pendingExport ? "Temuan ini tidak menghalangi ekspor. Tinjau daftar di bawah, perbaiki yang perlu, atau lanjutkan ekspor. " : "Pemeriksaan ini mencari masalah umum pada struktur, isi, media, sitasi, dan tata letak. "}Pedoman kampus atau jurnal dapat menetapkan aturan berbeda.</p>
          <label className="editor-setting-field manuscript-audit-profile">Jenis kerangka<select value={document.documentKind ?? "general"} onChange={(event) => setDocumentKind(event.target.value)}><option value="general">Umum</option><option value="skripsi">Skripsi</option><option value="makalah">Makalah</option><option value="jurnal">Artikel jurnal</option><option value="laporan">Laporan</option></select></label>
          <div className="manuscript-audit-list">
            {audit.findings.map((finding) => {
              const row = <><span className={`manuscript-audit-badge manuscript-audit-badge--${finding.severity}`}>{finding.severity === "warning" ? "Tinjau" : "Saran"}</span><span className="manuscript-audit-copy"><strong>{finding.title}</strong><small>{finding.detail}</small></span><span className="manuscript-audit-category">{finding.category}</span></>;
              return finding.nodeId ? <button type="button" key={finding.id} className="manuscript-audit-item" onClick={() => { selectNode(finding.nodeId); closeAudit(); }}>{row}</button> : <div key={finding.id} className="manuscript-audit-item">{row}</div>;
            })}
            {!audit.findings.length ? <div className="manuscript-audit-empty"><CheckCheck size={22} /><strong>Pemeriksaan umum selesai.</strong><span>Tetap cocokkan isi, sitasi, dan tata letak dengan pedoman yang berlaku.</span></div> : null}
          </div>
          <div className="settings-dialog__actions">{pendingExport ? <><button type="button" className="button button--secondary" onClick={closeAudit}>Kembali ke dokumen</button><button type="button" className="button button--primary" onClick={() => { const format = pendingExport; setPendingExport(null); setAuditOpen(false); handleExport(format, true); }}>Ekspor tetap</button></> : <button type="button" className="button button--primary" onClick={closeAudit}>Selesai</button>}</div>
        </section>
      </div> : null}
      {findReplaceOpen ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFindReplaceOpen(false); }}>
          <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="find-replace-title">
            <div className="settings-dialog__header">
              <div><p className="eyebrow">Dokumen aktif</p><h2 id="find-replace-title">Cari dan ganti</h2></div>
              <button type="button" className="icon-button icon-button--light" onClick={() => setFindReplaceOpen(false)} aria-label="Tutup">×</button>
            </div>
            <label className="editor-field-label" htmlFor="find-text">Cari teks</label>
            <input id="find-text" autoFocus value={findText} onChange={(event) => { setFindText(event.target.value); setReplaceNotice(""); }} className="editor-text-input" placeholder="Masukkan teks yang dicari" />
            <label className="editor-field-label" htmlFor="replacement-text">Ganti dengan</label>
            <input id="replacement-text" value={replacementText} onChange={(event) => setReplacementText(event.target.value)} className="editor-text-input" placeholder="Teks pengganti (boleh kosong)" />
            <div className="find-replace-options"><label><input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} /> Peka huruf besar/kecil</label><label><input type="checkbox" checked={wholeWords} onChange={(event) => setWholeWords(event.target.checked)} /> Kata utuh saja</label></div>
            <p className="dashboard-subtitle" aria-live="polite">{countDocumentMatches(document, findText, findOptions)} kecocokan di judul, isi, keterangan, dan tabel.</p>
            {replaceNotice ? <p className="dashboard-subtitle" role="status">{replaceNotice}</p> : null}
            <div className="settings-dialog__actions">
              <button type="button" className="button button--secondary" onClick={() => setFindReplaceOpen(false)}>Tutup</button>
              <button type="button" className="button button--primary" disabled={!countDocumentMatches(document, findText, findOptions)} onClick={() => {
                const replacedCount = replaceDocumentText(findText, replacementText, findOptions);
                setReplaceNotice(`${replacedCount} kecocokan berhasil diganti.`);
              }}>Ganti semua</button>
            </div>
          </section>
        </div>
      ) : null}
      {quickInsertOpen ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setQuickInsertOpen(false); }}>
          <section className="settings-dialog quick-insert-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-insert-title">
            <div className="settings-dialog__header"><div><p className="eyebrow">Sisipkan ke dokumen</p><h2 id="quick-insert-title">Penyisipan cepat</h2></div><button type="button" className="icon-button icon-button--light" onClick={() => setQuickInsertOpen(false)} aria-label="Tutup">×</button></div>
            <input autoFocus type="search" value={quickInsertQuery} onChange={(event) => setQuickInsertQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && quickInsertResults[0]) { event.preventDefault(); insertQuickItem(quickInsertResults[0]); } }} className="editor-text-input" placeholder="Cari jenis elemen..." aria-label="Cari elemen untuk disisipkan" />
            <div className="quick-insert-list" role="listbox" aria-label="Elemen dokumen">
              {quickInsertResults.map((item) => <button type="button" role="option" aria-selected="false" key={item.type} onClick={() => insertQuickItem(item)}><strong>{item.label}</strong><span>{item.description}</span></button>)}
              {!quickInsertResults.length ? <p>Tidak ada elemen yang cocok.</p> : null}
            </div>
            <p className="content-editor__helper">Pintasan: Ctrl+K atau ⌘K. Tekan Enter untuk memilih hasil pertama.</p>
          </section>
        </div>
      ) : null}
      {shortcutsOpen ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShortcutsOpen(false); }}>
          <section className="settings-dialog shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
            <div className="settings-dialog__header"><div><p className="eyebrow">Bantuan editor</p><h2 id="shortcuts-title">Pintasan keyboard</h2></div><button type="button" className="icon-button icon-button--light" onClick={() => setShortcutsOpen(false)} aria-label="Tutup">×</button></div>
            <dl className="shortcut-list"><div><dt>Simpan sekarang</dt><dd>Ctrl+S / ⌘S</dd></div><div><dt>Cari dan ganti</dt><dd>Ctrl+H / ⌘H</dd></div><div><dt>Penyisipan cepat</dt><dd>Ctrl+K / ⌘K</dd></div><div><dt>Pemisah halaman</dt><dd>Ctrl+Enter / ⌘Enter</dd></div><div><dt>Paragraf</dt><dd>Ctrl+Alt+P / ⌘Option+P</dd></div><div><dt>Tabel</dt><dd>Ctrl+Alt+T / ⌘Option+T</dd></div><div><dt>Gambar</dt><dd>Ctrl+Alt+I / ⌘Option+I</dd></div><div><dt>Bab</dt><dd>Ctrl+Alt+Shift+C</dd></div><div><dt>Daftar pintasan</dt><dd>Ctrl+/ / ⌘/</dd></div><div><dt>Urungkan</dt><dd>Ctrl+Z / ⌘Z</dd></div><div><dt>Ulangi</dt><dd>Ctrl+Y / Ctrl+Shift+Z / ⌘Shift+Z</dd></div><div><dt>Tutup dialog</dt><dd>Esc</dd></div></dl>
            <div className="settings-dialog__actions"><button type="button" className="button button--primary" onClick={() => setShortcutsOpen(false)}>Selesai</button></div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
