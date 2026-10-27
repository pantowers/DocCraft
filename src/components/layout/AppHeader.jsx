import Link from "next/link";
import { ArrowLeft, CheckCheck, CircleHelp, Download, FileDown, FileText, FolderOpen, Redo2, Save, Search, Undo2 } from "lucide-react";

export default function AppHeader({ mode = "dashboard", documentTitle = "Dokumen Tanpa Judul", onTitleChange, saveStatus = "saved", onSaveNow, onUndo, onRedo, canUndo = false, canRedo = false, onFindReplace, onOpenShortcuts, onOpenAudit, onExportDocx, onExportPdf, onPresetChange, customPresets = [], preset = "Skripsi 4-4-3-3", exporting = "", exportError = "" }) {
  const isEditor = mode === "editor";

  return (
    <header className="app-header">
      <div className="app-header__identity">
        {isEditor ? (
          <Link href="/" className="icon-button app-header__back" aria-label="Kembali ke dashboard">
            <ArrowLeft size={19} />
          </Link>
        ) : null}
        <Link href="/" className="brand" aria-label="DocCraft beranda">
          <span className="brand__mark"><FileText size={21} strokeWidth={2.2} /></span>
          <span>DocCraft</span>
        </Link>
        {isEditor ? (
          <>
            <input
              aria-label="Nama dokumen"
              className="app-header__filename"
              value={documentTitle}
              onChange={onTitleChange}
              readOnly={!onTitleChange}
            />
            <span className={`save-indicator save-indicator--${saveStatus}`} title="Ctrl+S untuk simpan sekarang" aria-live="polite">
              <span className="save-indicator__dot" />
              {saveStatus === "saving" ? "Menyimpan..." : saveStatus === "error" ? "Belum tersimpan" : "Tersimpan"}
            </span>
          </>
        ) : null}
      </div>

      {isEditor ? (
        <div className="app-header__actions">
          <label className="preset-picker">
            <span>Preset</span>
            <select value={preset} onChange={(event) => onPresetChange?.(event.target.value)} aria-label="Preset dokumen">
              <option>Skripsi 4-4-3-3</option>
              <option>Makalah</option>
              <option>Jurnal</option>
              <option>Custom</option>
              {customPresets.length ? <optgroup label="Preset tersimpan">{customPresets.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</optgroup> : null}
              {preset !== "Skripsi 4-4-3-3" && preset !== "Makalah" && preset !== "Jurnal" && preset !== "Custom" && !customPresets.some((item) => item.name === preset) ? <option value={preset}>{preset}</option> : null}
            </select>
          </label>
          <button className="app-header__history-button" type="button" onClick={onFindReplace} title="Cari dan ganti (Ctrl+H)" aria-label="Cari dan ganti">
            <Search size={17} />
          </button>
          <button className="app-header__history-button" type="button" onClick={onOpenShortcuts} title="Pintasan keyboard (Ctrl+/)" aria-label="Pintasan keyboard">
            <CircleHelp size={17} />
          </button>
          <button className="app-header__history-button" type="button" onClick={onOpenAudit} title="Periksa kelengkapan dan format naskah" aria-label="Periksa naskah">
            <CheckCheck size={17} />
          </button>
          <div className="app-header__history" aria-label="Riwayat perubahan">
            <button className="app-header__history-button" type="button" onClick={onUndo} disabled={!canUndo} title="Urungkan (Ctrl+Z)" aria-label="Urungkan">
              <Undo2 size={17} />
            </button>
            <button className="app-header__history-button" type="button" onClick={onRedo} disabled={!canRedo} title="Ulangi (Ctrl+Y)" aria-label="Ulangi">
              <Redo2 size={17} />
            </button>
          </div>
          <button className="button button--header-secondary" type="button" onClick={onSaveNow} title="Simpan sekarang (Ctrl+S)">
            <Save size={16} /> <span>Simpan</span>
          </button>
          <button className="button button--primary" type="button" disabled={Boolean(exporting)} onClick={onExportDocx} title="Ekspor dokumen Word">
            <Download size={16} /> <span>{exporting === "docx" ? "Membuat Word…" : "Export to .docx (Word)"}</span>
          </button>
          <button className="button button--header-secondary" type="button" disabled={Boolean(exporting)} onClick={onExportPdf} title="Buka dialog cetak dan pilih Save as PDF">
            <FileDown size={16} /> <span>{exporting === "pdf" ? "Menyiapkan PDF…" : "Download PDF"}</span>
          </button>
          {exportError ? <span className="app-header__export-error" role="alert">{exportError}</span> : null}
        </div>
      ) : (
        <div className="app-header__workspace-label">
          <FolderOpen size={17} /> <span>Dokumen lokal</span>
        </div>
      )}
    </header>
  );
}
