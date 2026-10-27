# DocCraft

DocCraft is a local-first academic document editor starter built with Next.js App Router and JavaScript.

## Requirements

- Node.js 20.9 or newer
- npm (the lockfile is installed with `npm ci`)

## Setup on Windows

Open PowerShell in this folder and run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\setup.ps1
npm.cmd run dev
```

The setup script requires Node.js 20.9 or newer and installs the exact versions in `package-lock.json`. If your PowerShell policy blocks `npm`, use `npm.cmd` as shown. On macOS or Linux, use `npm ci` and `npm run dev` instead.

Then open `http://localhost:3000` in a browser.

On the prepared Windows desktop, double-click **DocCraft** to start the local server and open the app in your browser. Keep the PowerShell window open while using DocCraft; press **Ctrl+C** there to stop the server. The `Start-DocCraft.ps1` launcher can also be run from this project folder.

If a production build cannot write to `.next` while the development server is using it, build into a separate folder from PowerShell:

```powershell
$env:NEXT_DIST_DIR = '.next-build'
npm.cmd run build
Remove-Item Env:NEXT_DIST_DIR
```

## Data and privacy

By default, documents and folders are stored in IndexedDB and custom presets in the current browser profile. Optional Supabase account sync stores a private copy on the server only after an account signs in and presses Sync. It merges edits by their last-edited timestamp and reconciles deletions after a device has synced that account before. Accounts cannot see one another's records and there is no live team editing. Without Supabase, people can exchange documents manually with the dashboard JSON backup and restore tools. Back up documents before changing browser profiles or clearing site data.



## Account cloud (optional)

DocCraft can keep a private copy of each account's documents in Supabase so the same account can open them on another device. Synchronization is manual and merges documents and folders by their last edited time. After a device has synced an account, later deletions are reconciled too. This is not live collaboration and accounts cannot see one another's records. Local browser data remains available if cloud sync is not configured.

1. Create a Supabase project and run supabase/schema.sql in its SQL Editor.
2. Copy .env.example to .env.local; set SUPABASE_URL and the project publishable/anon key. Never use or commit a service-role key.
3. In Supabase Auth, set the site URL and allowed redirect URL to your DocCraft origin (for local development, http://localhost:3000). Keep email confirmation enabled for deployed use.
4. Restart DocCraft, then create an account or sign in from Akun dan sinkronisasi cloud. Press Sinkronkan sekarang to merge this browser with that account.

Passwords are sent only to Supabase Auth over HTTPS. Session tokens are kept in HttpOnly cookies; database Row Level Security restricts rows to the signed-in account. A Supabase project and internet access are required for account sign-in and cloud sync.

## Run and build

For a clean install, run `npm ci`. Start development with `npm run dev`, then open `http://localhost:3000`. Check the project with `npm run lint` and create a production build with `npm run build`; serve that build with `npm start`.

## Project map

- `src/app`: dashboard route, editor route, root layout, and global CSS
- `src/components`: reusable dashboard, editor, outline, preview, settings, and UI components
- `src/store`: Zustand document state, editing actions, and selection
- `src/lib/document`: document shape, numbering, sanitizing, and validation helpers
- `src/lib/storage`: IndexedDB persistence for documents, folders, and backup restore
- `src/lib/export`: Word and PDF generation modules

The editor includes an outline/tree view, rich text editing, automatic chapter and subsection numbering that updates after reordering, global paragraph alignment and spacing with single, 1.5, double, and custom line spacing, autosave in IndexedDB, live page preview that keeps headings with the following block, reusable custom paper presets, image sizing/alignment, document-wide and per-chapter page numbering, and Word/PDF export. The preview footer shows word, character, and heading counts; open it for a breakdown of chapters, sections, subsections, paragraphs, images, tables, page breaks, and estimated reading time. Jump directly to any page from the preview footer. Adjust preview zoom with plus/minus controls, reset it to fit the panel, or open the canvas in fullscreen. Save immediately with the header button or Ctrl+S; autosave writes are queued and the status only reports success for the latest document revision. Open the keyboard shortcut reference from the header or press Ctrl+/. Use Ctrl+K to open the quick insert palette for chapters, sections, paragraphs, images, tables, and page breaks. Ctrl+Enter inserts a page break; Ctrl+Alt+P, Ctrl+Alt+T, Ctrl+Alt+I, and Ctrl+Alt+Shift+C insert a paragraph, table, image node, and chapter. Undo and redo are available from the header or with Ctrl+Z and Ctrl+Y (Cmd+Z and Shift+Cmd+Z on Mac); rapid edits are grouped into a single history step. Use Cari dan Ganti in the header or Ctrl+H to count and replace text across headings, content, captions, and table cells; choose case-sensitive matching or whole words. Search the outline and navigate matching headings with Enter and Shift+Enter or the previous/next buttons. Reorder sibling nodes with the outline menu's Pindah ke atas and Pindah ke bawah actions, or drag them. Add alternative text to images for screen readers and exported documents. Paste or drag an image into the rich editor to insert it as a new image node; images are limited to 5 MB each. Duplicate a node and its nested contents from the outline menu; every copied node receives a fresh internal ID so headings and media numbering remain independent. Pasting formatted text into the rich editor retains supported formatting such as bold, lists, and links while removing unsupported markup. Selecting an item in the outline scrolls the preview to its page. Pressing Enter in a paragraph splits it into two separately editable paragraph nodes and moves the caret to the new paragraph; Shift+Enter inserts a line break inside the current paragraph. New paragraphs, images, tables, and manual page breaks are placed under the selected chapter/subsection or directly after another selected node. Table editing supports inserting, duplicating, moving, and deleting rows and columns at the selected cell, clearing a cell, and adding a row with Enter or Tab at the table end. An optional first-row header repeats in Word and PDF. Remove an image from its node without deleting its caption or alternative text, then upload a replacement when needed. Insert a manual page break from the content editor to start the following material on a new page in the preview, Word, and PDF. Word export keeps image captions with their images, table captions with their tables, and each table row together across page breaks. The dashboard can sort by last modified, oldest, title A–Z, or title Z–A; mark important documents to keep them at the top. It also shows how many documents match the current folder and search. It supports folders, document search, duplication, deletion with confirmation, and JSON backup/restore. Word files are generated in the browser. PDF export opens the browser's print dialog; choose **Save as PDF** there.

Academic templates add an editable title page with author, institution, faculty, study program, and year fields. The Skripsi template also starts with editable declaration, approval, foreword, abstract, table of contents, figure list, and table list pages; the quick insert palette can add this complete front-matter package to another document. Front-matter pages have centered headings, their own page starts, and editable text. Journal templates include an abstract and keywords. The abstract is included in word and character counts, checked during manuscript review, and exported without a first-line paragraph indent. Journal headings flow as article sections instead of forced, numbered thesis chapters; thesis and report chapters keep their page-start behavior.

When editing an abstract or a recognized section such as the background, research questions, methods, results, discussion, or conclusion, the editor shows a short writing guide for that section. The abstract guide displays its live word count and lets you set optional minimum and maximum word targets from your institution or journal guide; the manuscript review flags an abstract outside those limits. These prompts help with drafting and do not replace the selected institution or journal's style guide.

New Makalah documents start with the Makalah page preset, and new Artikel jurnal documents start with the Jurnal preset. Skripsi and Laporan use the Skripsi 4-4-3-3 preset as a starting point; adjust it to the institution or publication guide before writing if its requirements differ.

Live preview uses browser line measurements to continue ordinary long paragraphs across pages, keeps headings with following text, and avoids leaving a single paragraph line alone at the top or bottom of a page where space permits. Word and PDF exports also apply heading keep-with-next and paragraph widow/orphan controls. Complex blocks use estimated heights in preview. Always review the exported Word or PDF for final line wrapping and page breaks, especially with formatted lists, large tables, or different fonts.

## Generated table of contents

- Select **Daftar isi otomatis** from the outline add menu or quick insert palette to add a table of contents at the current outline position.
- The live preview lists current chapters and subsections with estimated page numbers. Word exports use built-in Heading 1–3 styles and a native table-of-contents field; update the field in Word after layout changes to refresh final page numbers. PDF entries link to headings and use page labels calculated by the live preview. Review the final PDF after export because browser print pagination can differ from the preview.

## Lists of figures and tables

- Add **Daftar gambar otomatis** or **Daftar tabel otomatis** from the outline or quick insert menu. Each list updates from the corresponding media captions and numbering.
- The live preview shows page numbers based on its current pagination. PDF uses linked entries with page labels calculated by the live preview; compare them with the final print layout. DOCX includes page-reference fields linked to each caption; if Word has not refreshed them, select the list and press **F9** after layout changes.

## Citations and references

- Add sources under **Format halaman, paragraf, dan font → Sumber dan sitasi**. Enter author names in the preferred reference-list form and separate multiple authors with semicolons.
- Choose APA 7 author–date, IEEE numeric bracket `[1]`, or Vancouver numeric parenthesis `(1)`. Numeric citations follow first appearance in the manuscript; switching styles updates in-text citations and reference-entry structure in the preview, Word, and PDF.
- APA narrative citations join two authors with “dan”, while parenthetical citations use “&”.
- APA 7 reference entries sort by author, year, then title. Works by the same author in the same year receive matching `a`, `b`, and subsequent suffixes in citations and the bibliography, based on title order.
- Add structured records for books, journal articles, websites, theses, and reports. Journal records include volume, issue, pages, and DOI; web sources include a URL. Older records with a single publisher/source field remain supported.
- Import `.bib` BibTeX and `.ris` files from the source manager, including RIS files from common reference managers. Common books, journal articles, conference papers, book chapters, theses, reports, and web entries are converted into editable sources; duplicates are detected by DOI or normalized author/year/title. Conference and chapter entries keep their proceedings/book title, editors, publisher, and page range when available.
- Export the current source library as BibTeX or RIS from the same panel to move references into another reference manager.
- Changing a source type clears incompatible fields when the reference is saved, and BibTeX export writes only the metadata fields that belong to that source type.
- The source editor previews each reference in the selected citation style before it is saved.
- Generated reference entries italicize book, thesis, report, and website titles, plus journal names and volume numbers. DOI and URL text links to the source in the live preview, Word, and PDF.
- Edit source details from the reference list without breaking citations already linked in the text. Deleting a source remains disabled while the manuscript cites it.
- In a paragraph, choose the quotation-mark button and select one or more sources to insert a linked citation. Grouped citations use semicolons in author–date/narrative styles and grouped numbers in IEEE/Vancouver parenthetical styles; citation labels follow source edits automatically.
- Choose parenthetical or narrative citations and optionally add a page or locator such as `hlm. 24`. These options are retained in the editor and formatted in preview, Word, and PDF. Citations in abstracts are included in citation numbering and the generated reference list.
- Click an in-text citation in the preview or exported PDF to jump to its bibliography entry. Word exports link citations to internal bookmarks at the matching reference.
- Word and PDF exports generate a **DAFTAR PUSTAKA** from sources actually cited in the text. These are practical common formats; verify full journal/publisher details, capitalization, italics, DOI formatting, and campus-specific rules before submission.

## Manuscript review

- Select the checkmark icon in the editor header to review common structure, empty paragraphs, placeholder text, media captions/accessibility text, citations, and page-format issues. Choose a general, thesis, paper, journal, or report outline profile to check for commonly expected sections and the order of main chapters; new documents inherit the profile used by their template.
- The review also checks 20 additional patterns: duplicate headings; heading punctuation; sub-bab outside a chapter; anak sub-bab without a parent; repeated paragraphs; paragraphs over 300 words; missing terminal punctuation; adjacent repeated words; repeated punctuation; duplicate media captions; figure/table mentions in body text; inconsistent table column counts; empty table rows; mostly empty tables; missing reference publisher/journal; unusual years; malformed source links; placeholder reference titles; and duplicate references.
- Reference review also flags missing titles, unchecked author/year details, source-type-specific journal/site/institution/publisher metadata, and DOIs reused across different records.
- In APA mode, review also looks for likely manually typed author–year citations that are not linked to a saved source, so those works can be added to the generated bibliography.
- Select a finding tied to a document node to jump to that content. This is a general preflight review, not a substitute for the official campus or journal rubric.

## Dashboard tools

- Search across document titles, headings, captions, paragraph text, alternative text, and table cells. Matching cards show a short location and content excerpt.
- Select multiple visible documents to move them between folders, pin or unpin them, export a portable JSON backup of the selection, or delete them after a confirmation prompt.

## Import

- Select **Impor Word/teks** on the dashboard to create a new document from `.docx` (up to 25 MB), `.txt`, `.md`, or `.markdown` (up to 10 MB).
- Word import retains heading levels, bold/italic/underline/strike and script text, hyperlinks, numbered/bulleted paragraphs, tables, embedded images up to 5 MB each, and the document's paper size and margins when present. Markdown `#`, `##`, and `###` headings become chapters, sections, and subsections; paragraphs, lists, bold, italic, strikethrough, and safe web links are retained.
- From **Format halaman, paragraf, dan font → Kertas dan margin**, choose **Ambil format dari PDF/DOCX** to inspect an uploaded document's page, font, and paragraph settings. Edit the extracted values, then save and apply the named preset. DOCX provides the best source for typography and paragraph defaults; PDF page dimensions and text positions are best-effort estimates, so review them against the source document.
- Import creates a separate document in the currently selected folder. Existing documents are not overwritten.

## Export

- **Word:** Select **Export to .docx (Word)** to download an editable document with page size, margins, typography, paragraph spacing, tables, images, captions, and page numbering. Figure captions appear below images and table captions above tables in the preview and exports.
- DOCX export filters XML-illegal control characters from document text and validates required package parts and XML before downloading. Live preview now uses the same point-based heading spacing as PDF and the same physical image height limit; complex pagination can still differ between browser and print engines.
- **PDF:** Select **Download PDF**, then choose **Save as PDF** in the browser print dialog. Allow pop-ups for `localhost` if the print window is blocked.
- The export uses the document currently open in the editor. Wait until the save indicator says **Tersimpan** before closing the editor.
- PDF global page numbers are produced by the browser print engine. Per-chapter page-number restart is currently reflected in Word export and live preview, but may not match in PDF; verify page numbering after export.

## Backup

- Select **Backup** on the dashboard to download local documents, folders, and custom paper presets as one JSON file.
- Select **Pulihkan** to merge a backup into the current browser. Imported records become new copies and do not overwrite existing documents; conflicting custom preset names receive a numbered suffix.

## License and repository release

DocCraft is licensed under MIT; see [LICENSE](LICENSE). Before publishing, replace [Nama pemegang hak cipta] in that file with the name of the copyright holder. MIT permits use, modification, distribution, and commercial use when the copyright and license notices are retained. Do not commit local exports, browser backups, environment files, node_modules, or build output.
