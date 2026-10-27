import { getMediaLabels } from "./numbering";
import { getReferenceIdentityKeys } from "./referenceIdentity";

function plainText(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function hasUnlinkedAuthorDateCitation(html) {
  const withoutLinkedCitations = String(html ?? "").replace(/<span\b(?=[^>]*\bdata-reference-id\s*=)[^>]*>[\s\S]*?<\/span>/gi, " ");
  const text = plainText(withoutLinkedCitations);
  const author = String.raw`[A-ZÀ-ÖØ-Þ][\p{L}\p{M}'’.-]*(?:\s+(?:(?:&|dan)\s+)?[A-ZÀ-ÖØ-Þ][\p{L}\p{M}'’.-]*){0,5}(?:\s+et al\.)?`;
  const locator = String.raw`(?:,\s*(?:p\.?|pp\.?|hlm\.?|hal\.?)\s*\d+(?:[-–]\d+)?)?`;
  return new RegExp(String.raw`\(${author},\s*(?:18|19|20)\d{2}[a-z]?${locator}\)`, "u").test(text)
    || new RegExp(String.raw`\b${author}\s*\((?:18|19|20)\d{2}[a-z]?${locator}\)`, "u").test(text);
}

function wordCount(text) { return String(text ?? "").match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0; }

function hasBodyContent(node) {
  if (node.type === "paragraph" && wordCount(plainText(node.content)) > 0) return true;
  if (node.type === "image" && node.asset?.dataUrl) return true;
  if (node.type === "table" && node.tableData?.rows?.some((row) => row.some((cell) => String(cell ?? "").trim()))) return true;
  return (node.children ?? []).some(hasBodyContent);
}

const OUTLINE_PROFILES = {
  skripsi: [
    ["Pendahuluan", /pendahuluan/i],
    ["Landasan teori atau tinjauan pustaka", /landasan teori|tinjauan pustaka|kajian pustaka/i],
    ["Metode penelitian", /metode penelitian|metodologi penelitian/i],
    ["Hasil penelitian", /hasil/i],
    ["Pembahasan", /pembahasan|diskusi/i],
    ["Kesimpulan atau penutup", /kesimpulan|penutup/i],
  ],
  makalah: [
    ["Pendahuluan", /pendahuluan/i],
    ["Pembahasan", /pembahasan|diskusi|analisis/i],
    ["Kesimpulan atau penutup", /kesimpulan|penutup/i],
  ],
  laporan: [
    ["Pendahuluan", /pendahuluan/i],
    ["Gambaran umum", /gambaran umum|profil|kondisi umum/i],
    ["Hasil, pelaksanaan, atau pembahasan", /hasil|pelaksanaan|pembahasan/i],
    ["Kesimpulan atau penutup", /kesimpulan|penutup|evaluasi/i],
  ],
  jurnal: [
    ["Abstrak", /abstrak|abstract/i],
    ["Pendahuluan", /pendahuluan|introduction/i],
    ["Metode", /metode|method/i],
    ["Hasil", /hasil|results?/i],
    ["Pembahasan", /pembahasan|discussion/i],
    ["Kesimpulan", /kesimpulan|conclusion/i],
  ],
};

const OUTLINE_ORDER_PROFILES = {
  skripsi: [
    ["Pendahuluan", /pendahuluan/i],
    ["Landasan teori atau tinjauan pustaka", /landasan teori|tinjauan pustaka|kajian pustaka/i],
    ["Metode penelitian", /metode penelitian|metodologi penelitian/i],
    ["Hasil penelitian", /hasil/i],
    ["Pembahasan", /pembahasan|diskusi/i],
    ["Kesimpulan atau penutup", /kesimpulan|penutup/i],
  ],
  makalah: [
    ["Pendahuluan", /pendahuluan/i],
    ["Pembahasan", /pembahasan|diskusi|analisis/i],
    ["Kesimpulan atau penutup", /kesimpulan|penutup/i],
  ],
  laporan: [
    ["Pendahuluan", /pendahuluan/i],
    ["Gambaran umum", /gambaran umum|profil|kondisi umum/i],
    ["Hasil atau pembahasan", /hasil|pelaksanaan|pembahasan/i],
    ["Kesimpulan atau penutup", /kesimpulan|penutup|evaluasi/i],
  ],
  jurnal: [
    ["Pendahuluan", /pendahuluan|introduction/i],
    ["Metode", /metode|method/i],
    ["Hasil", /hasil|results?/i],
    ["Pembahasan", /pembahasan|discussion/i],
    ["Kesimpulan", /kesimpulan|conclusion/i],
  ],
};

export function auditDocument(document) {
  const findings = [];
  const add = (severity, title, detail, nodeId = null, category = "Naskah") => findings.push({ id: `${findings.length}-${nodeId ?? "document"}`, severity, title, detail, nodeId, category });
  const headingCounts = { chapter: 0, section: 0, subsection: 0 };
  const citationIds = new Set();
  const outlineTitles = [];
  const headingSeen = new Set();
  const paragraphSeen = new Map();
  const mediaSeen = new Map();
  const paragraphTexts = [];
  const mediaNodes = [];
  const automaticLists = { tableOfContents: 0, listOfFigures: 0, listOfTables: 0 };
  const mediaLabels = getMediaLabels(document?.sections ?? []);

  function visit(list, hasChapter = false, hasSection = false) {
    for (const node of list ?? []) {
      if (headingCounts[node.type] !== undefined) headingCounts[node.type] += 1;
      if (Object.hasOwn(automaticLists, node.type)) automaticLists[node.type] += 1;
      if (node.type === "titlePage") {
        const cover = node.coverData ?? {};
        if (!String(cover.author ?? "").trim()) add("warning", "Nama penulis belum diisi pada halaman judul", "Lengkapi identitas penulis pada elemen halaman judul sebelum mengekspor naskah.", node.id, "Identitas");
        if (!String(cover.institution ?? "").trim()) add("info", "Nama institusi belum diisi", "Tambahkan institusi jika pedoman karya tulis memintanya.", node.id, "Identitas");
        if (!String(cover.year ?? "").trim()) add("info", "Tahun halaman judul belum diisi", "Tambahkan tahun penyusunan sesuai pedoman.", node.id, "Identitas");
      }
      if (node.type === "abstract") {
        outlineTitles.push(String(node.title ?? "ABSTRAK"));
        for (const match of String(node.content ?? "").matchAll(/data-reference-id=["']([^"']+)["']/gi)) citationIds.add(match[1]);
        if (document?.citationStyle === "author-date" && hasUnlinkedAuthorDateCitation(node.content)) add("info", "Sitasi penulis–tahun belum tertaut", "Sitasi ini tampaknya diketik langsung. Gunakan tombol kutip untuk menautkannya ke data sumber dan memasukkannya ke daftar pustaka otomatis.", node.id, "Sitasi");
        const abstractWords = wordCount(plainText(node.content));
        if (!abstractWords) add("warning", "Abstrak masih kosong", "Tulis ringkasan tujuan, metode, hasil utama, dan kesimpulan sesuai batas kata pedoman.", node.id, "Isi");
        if (!String(node.keywords ?? "").trim()) add("info", "Kata kunci belum diisi", "Tambahkan kata kunci yang mewakili topik jika diwajibkan oleh pedoman.", node.id, "Isi");
        const minWords = Number(node.minWords) > 0 ? Number(node.minWords) : null;
        const maxWords = Number(node.maxWords) > 0 ? Number(node.maxWords) : null;
        if (minWords !== null && maxWords !== null && minWords > maxWords) add("warning", "Rentang kata abstrak tidak valid", "Batas minimum lebih besar daripada batas maksimum. Sesuaikan target dengan pedoman.", node.id, "Isi");
        else if (minWords !== null && abstractWords > 0 && abstractWords < minWords) add("info", "Abstrak di bawah batas minimum", `Abstrak berisi ${abstractWords} kata, sedangkan batas minimum yang kamu tetapkan adalah ${minWords}.`, node.id, "Isi");
        else if (maxWords !== null && abstractWords > maxWords) add("warning", "Abstrak melebihi batas maksimum", `Abstrak berisi ${abstractWords} kata, sedangkan batas maksimum yang kamu tetapkan adalah ${maxWords}.`, node.id, "Isi");
      }
      if (["chapter", "section", "subsection"].includes(node.type)) {
        const title = String(node.title ?? "").trim();
        outlineTitles.push(title);
        const key = `${node.type}:${title.toLocaleLowerCase("id-ID").replace(/\s+/g, " ")}`;
        if (title && headingSeen.has(key)) add("warning", "Judul bagian berulang", `Judul “${title}” muncul lebih dari sekali pada tingkat yang sama; pastikan ini disengaja.`, node.id, "Struktur");
        if (title) headingSeen.add(key);
        if (title && /[.!?;:]$/.test(title)) add("info", "Judul diakhiri tanda baca", "Judul bab atau sub-bab umumnya ditulis tanpa tanda titik di akhir; cocokkan dengan pedoman yang dipakai.", node.id, "Struktur");
        if (node.type === "section" && !hasChapter) add("warning", "Sub-bab berada di luar bab", "Pindahkan sub-bab ini ke dalam bab yang sesuai agar penomorannya konsisten.", node.id, "Struktur");
        if (node.type === "subsection" && !hasSection) add("warning", "Anak sub-bab tanpa sub-bab induk", "Tempatkan anak sub-bab di dalam sub-bab induk atau ubah tingkat judulnya.", node.id, "Struktur");
      }
      if (node.type === "paragraph") {
        const text = plainText(node.content);
        const normalizedText = text.toLocaleLowerCase("id-ID").replace(/\s+/g, " ").trim();
        if (normalizedText) {
          paragraphTexts.push({ text, normalizedText, nodeId: node.id });
          const previous = paragraphSeen.get(normalizedText);
          if (previous) add("info", "Paragraf berulang", "Isi paragraf ini sama dengan paragraf lain. Pastikan pengulangan diperlukan.", node.id, "Isi");
          else paragraphSeen.set(normalizedText, node.id);
        }
        if (!text) add("warning", "Paragraf kosong", "Isi paragraf ini masih kosong; hapus jika tidak diperlukan atau lengkapi isinya.", node.id, "Isi");
        else {
          const placeholder = /\b(?:todo|tbd|lorem ipsum|contoh teks|tulis di sini|isi di sini|masukkan teks|nama penulis|judul penelitian|xxx+)\b/i.test(text);
          if (placeholder) add("warning", "Teks pengganti ditemukan", "Periksa apakah teks contoh atau placeholder ini sudah diganti dengan isi final.", node.id, "Isi");
          if (wordCount(text) < 15) add("info", "Paragraf sangat singkat", "Pastikan pernyataan ini cukup menjelaskan gagasan dan didukung konteks atau sumber bila diperlukan.", node.id, "Isi");
          if (wordCount(text) > 300) add("info", "Paragraf sangat panjang", "Pertimbangkan membagi paragraf ini berdasarkan pergantian gagasan agar alurnya lebih mudah diikuti.", node.id, "Isi");
          if (!/[.!?][”’\"')\]]?$/.test(text)) add("info", "Paragraf tanpa tanda akhir", "Periksa apakah kalimat terakhir memerlukan tanda baca penutup.", node.id, "Isi");
          if (/\b([\p{L}\p{N}]+)\s+\1\b/iu.test(text)) add("warning", "Kata berulang berurutan", "Ada kata yang muncul dua kali berturut-turut; periksa kemungkinan salah ketik.", node.id, "Isi");
          if (/(?:[!?.,])\1{2,}/.test(text)) add("info", "Tanda baca berulang", "Terdapat rangkaian tanda baca yang tidak umum dalam penulisan ilmiah.", node.id, "Isi");
        }
        for (const match of String(node.content ?? "").matchAll(/data-reference-id=["']([^"']+)["']/gi)) citationIds.add(match[1]);
        if (document?.citationStyle === "author-date" && hasUnlinkedAuthorDateCitation(node.content)) add("info", "Sitasi penulis–tahun belum tertaut", "Sitasi ini tampaknya diketik langsung. Gunakan tombol kutip untuk menautkannya ke data sumber dan memasukkannya ke daftar pustaka otomatis.", node.id, "Sitasi");
      }
      if (node.type === "codeBlock" && !String(node.content ?? "").trim()) add("warning", "Blok kode masih kosong", "Isi blok kode atau hapus elemen ini agar tidak muncul sebagai kotak kosong pada hasil ekspor.", node.id, "Isi");
      if (["chapter", "section", "subsection"].includes(node.type) && !String(node.title ?? "").trim()) add("warning", "Judul bagian kosong", "Isi judul atau hapus bagian kosong ini.", node.id, "Struktur");
      if (node.type === "chapter" && !hasBodyContent(node)) add("warning", "Bab belum berisi materi", "Bab ini belum memiliki paragraf, tabel, atau gambar berisi; tambahkan materi sebelum ekspor.", node.id, "Struktur");
      if (node.type === "chapter" && !(node.children ?? []).some((child) => child.type === "section")) add("info", "Bab belum memiliki sub-bab", "Pedoman kampus dapat mensyaratkan susunan sub-bab tertentu; tinjau struktur bab ini.", node.id, "Struktur");
      if (node.type === "image") {
        mediaNodes.push(node);
        const captionKey = String(node.caption ?? "").trim().toLocaleLowerCase("id-ID").replace(/\s+/g, " ");
        if (captionKey && mediaSeen.has(captionKey)) add("warning", "Caption media berulang", "Caption ini sama dengan caption media lain; bedakan keterangan sesuai isi masing-masing.", node.id, "Media");
        if (captionKey) mediaSeen.set(captionKey, node.id);
        if (!node.asset?.dataUrl) add("warning", "Gambar belum memiliki berkas", "Unggah gambar atau hapus elemen gambar yang kosong.", node.id, "Media");
        if (!String(node.caption ?? "").trim()) add("warning", "Gambar tanpa keterangan", "Tambahkan keterangan sesuai pedoman dan rujuk gambar ini di dalam paragraf.", node.id, "Media");
        if (!String(node.altText ?? "").trim()) add("info", "Teks alternatif gambar belum diisi", "Tambahkan deskripsi singkat untuk aksesibilitas.", node.id, "Media");
      }
      if (node.type === "table") {
        mediaNodes.push(node);
        const captionKey = String(node.caption ?? "").trim().toLocaleLowerCase("id-ID").replace(/\s+/g, " ");
        if (captionKey && mediaSeen.has(captionKey)) add("warning", "Caption media berulang", "Caption ini sama dengan caption media lain; bedakan keterangan sesuai isi masing-masing.", node.id, "Media");
        if (captionKey) mediaSeen.set(captionKey, node.id);
        if (!String(node.caption ?? "").trim()) add("warning", "Tabel tanpa keterangan", "Tambahkan keterangan tabel dan jelaskan rujukannya di dalam naskah.", node.id, "Media");
        if (!node.tableData?.rows?.some((row) => row.some((cell) => String(cell ?? "").trim()))) add("warning", "Tabel kosong", "Isi tabel atau hapus elemen tabel yang belum dipakai.", node.id, "Media");
        const rows = node.tableData?.rows ?? [];
        const columnCounts = new Set(rows.map((row) => row.length));
        if (columnCounts.size > 1) add("warning", "Jumlah kolom tabel tidak konsisten", "Beberapa baris memiliki jumlah sel yang berbeda; rapikan struktur tabel sebelum ekspor.", node.id, "Media");
        if (rows.some((row) => !row.some((cell) => String(cell ?? "").trim()))) add("info", "Baris tabel kosong", "Hapus baris kosong atau isi dengan data yang diperlukan.", node.id, "Media");
        const cellCount = rows.reduce((sum, row) => sum + row.length, 0);
        const filledCount = rows.reduce((sum, row) => sum + row.filter((cell) => String(cell ?? "").trim()).length, 0);
        if (cellCount >= 4 && filledCount / cellCount < 0.5) add("info", "Sebagian besar sel tabel kosong", "Periksa apakah tabel masih berupa kerangka atau ada data yang belum dimasukkan.", node.id, "Media");
      }
      visit(node.children, node.type === "chapter" || hasChapter, node.type === "section" || (node.type === "chapter" ? false : hasSection));
    }
  }
  visit(document?.sections);

  if (headingCounts.chapter && !automaticLists.tableOfContents) add("info", "Daftar isi otomatis belum ditambahkan", "Dokumen memiliki bab. Tambahkan elemen Daftar Isi Otomatis jika pedoman mensyaratkannya; nomor halaman akan mengikuti hasil tata letak.", null, "Kelengkapan");
  if (mediaNodes.some((node) => node.type === "image") && !automaticLists.listOfFigures) add("info", "Daftar gambar otomatis belum ditambahkan", "Dokumen memiliki gambar. Tambahkan Daftar Gambar Otomatis jika diperlukan oleh pedoman.", null, "Kelengkapan");
  if (mediaNodes.some((node) => node.type === "table") && !automaticLists.listOfTables) add("info", "Daftar tabel otomatis belum ditambahkan", "Dokumen memiliki tabel. Tambahkan Daftar Tabel Otomatis jika diperlukan oleh pedoman.", null, "Kelengkapan");
  if (automaticLists.tableOfContents && !headingCounts.chapter && !headingCounts.section && !headingCounts.subsection) add("info", "Daftar isi belum memiliki judul", "Tambahkan bab atau sub-bab agar daftar isi otomatis menampilkan entri.", null, "Kelengkapan");
  if (automaticLists.listOfFigures && !mediaNodes.some((node) => node.type === "image")) add("info", "Daftar gambar belum memiliki entri", "Tambahkan gambar berketerangan atau hapus daftar gambar yang belum diperlukan.", null, "Kelengkapan");
  if (automaticLists.listOfTables && !mediaNodes.some((node) => node.type === "table")) add("info", "Daftar tabel belum memiliki entri", "Tambahkan tabel berketerangan atau hapus daftar tabel yang belum diperlukan.", null, "Kelengkapan");
  if (automaticLists.tableOfContents > 1) add("warning", "Ada beberapa daftar isi otomatis", "Pertahankan satu daftar isi utama atau pastikan daftar tambahan memang diperlukan.", null, "Kelengkapan");
  if (automaticLists.listOfFigures > 1) add("warning", "Ada beberapa daftar gambar otomatis", "Pertahankan satu daftar gambar utama atau pastikan daftar tambahan memang diperlukan.", null, "Kelengkapan");
  if (automaticLists.listOfTables > 1) add("warning", "Ada beberapa daftar tabel otomatis", "Pertahankan satu daftar tabel utama atau pastikan daftar tambahan memang diperlukan.", null, "Kelengkapan");

  const combinedBodyText = paragraphTexts.map(({ text }) => text).join(" ").toLocaleLowerCase("id-ID");
  mediaNodes.forEach((node) => {
    const label = mediaLabels[node.id];
    if (label && !combinedBodyText.includes(label.toLocaleLowerCase("id-ID"))) add("info", `${node.type === "image" ? "Gambar" : "Tabel"} belum dirujuk dalam teks`, `Pastikan isi naskah menyebut ${label} sebelum atau sesudah media ditampilkan.`, node.id, "Media");
  });

  if (!String(document?.title ?? "").trim() || /dokumen tanpa judul/i.test(document.title)) add("warning", "Judul dokumen belum ditetapkan", "Beri nama berkas yang sesuai dengan judul karya tulis.", null, "Identitas");
  if (!headingCounts.chapter) add("warning", "Belum ada bab utama", "Tambahkan bab utama agar susunan naskah mudah dinavigasi dan dinomori.", null, "Struktur");
  if (!headingCounts.section) add("info", "Belum ada sub-bab", "Periksa apakah pedoman karya tulis yang dipilih mengharuskan pembagian sub-bab.", null, "Struktur");

  const profile = OUTLINE_PROFILES[document?.documentKind];
  profile?.forEach(([label, pattern]) => {
    if (!outlineTitles.some((title) => pattern.test(title))) add("info", `Komponen ${label.toLocaleLowerCase("id-ID")} belum terdeteksi`, "Periksa kerangka contoh untuk jenis dokumen ini; nama bagian yang berbeda bisa tetap memenuhi pedoman kampus.", null, "Kerangka");
  });

  const orderProfile = OUTLINE_ORDER_PROFILES[document?.documentKind];
  if (orderProfile) {
    const chapters = (document?.sections ?? []).filter((node) => node.type === "chapter");
    const positions = orderProfile.map(([label, pattern]) => ({ label, node: chapters.find((chapter) => pattern.test(String(chapter.title ?? ""))) })).filter((item) => item.node);
    for (let index = 1; index < positions.length; index += 1) {
      const previous = positions[index - 1];
      const current = positions[index];
      if (chapters.indexOf(current.node) < chapters.indexOf(previous.node)) {
        add("info", `Urutan bab ${current.label.toLocaleLowerCase("id-ID")} perlu ditinjau`, `Pada pola umum ${document.documentKind}, bagian ini biasanya ditempatkan setelah “${previous.label}”. Cocokkan dengan pedoman yang digunakan.`, current.node.id, "Kerangka");
      }
    }
  }

  const references = Array.isArray(document?.references) ? document.references : [];
  const referenceIds = new Set(references.map((reference) => reference.id));
  citationIds.forEach((id) => { if (!referenceIds.has(id)) add("warning", "Sitasi tidak punya sumber", "Tambahkan kembali sumber yang sesuai atau hapus sitasi yang sudah tidak berlaku.", null, "Sitasi"); });
  const citedCount = [...citationIds].filter((id) => referenceIds.has(id)).length;
  const doiOwners = new Map();
  references.forEach((reference) => {
    const type = reference.sourceType ?? "book";
    const title = String(reference.title ?? "").trim();
    if (!citationIds.has(reference.id)) add("info", "Sumber belum dikutip", `“${reference.title}” tidak akan masuk daftar pustaka otomatis sebelum dikutip dalam teks.`, null, "Sitasi");
    if (!title) add("warning", "Judul sumber belum diisi", "Lengkapi judul sumber agar sitasi dan daftar pustaka dapat dikenali.", null, "Sitasi");
    if (!String(reference.authors ?? "").trim()) add("info", "Penulis sumber belum diisi", `Periksa apakah “${title || "sumber tanpa judul"}” memang tidak mencantumkan penulis.`, null, "Sitasi");
    const sourceName = type === "journal" ? reference.journal || reference.source
      : type === "website" ? reference.siteName || reference.source
        : type === "thesis" || type === "report" ? reference.institution || reference.source
          : ["conference", "chapter"].includes(type) ? reference.containerTitle || reference.source
            : reference.publisher || reference.source;
    if (!String(sourceName ?? "").trim()) {
      const label = type === "journal" ? "Nama jurnal" : type === "website" ? "Nama situs" : type === "thesis" || type === "report" ? "Institusi" : type === "conference" ? "Nama prosiding konferensi" : type === "chapter" ? "Judul buku" : "Penerbit";
      add("warning", `${label} belum diisi`, `Lengkapi ${label.toLocaleLowerCase("id-ID")} untuk “${title || "sumber tanpa judul"}”.`, null, "Sitasi");
    }
    if (["conference", "chapter"].includes(type) && !String(reference.publisher ?? "").trim()) {
      add("info", "Penerbit sumber belum diisi", `Tambahkan penerbit prosiding atau buku untuk “${title || "sumber tanpa judul"}” jika informasinya tersedia.`, null, "Sitasi");
    }
    if (["conference", "chapter"].includes(type) && !String(reference.pages ?? "").trim()) {
      add("info", "Rentang halaman sumber belum diisi", `Periksa rentang halaman kontribusi “${title || "sumber tanpa judul"}” dan tambahkan jika tercantum pada sumber asli.`, null, "Sitasi");
    }
    const year = String(reference.year ?? "").trim();
    if (!year) add("info", "Tahun sumber belum diisi", `Pastikan “${title || "sumber tanpa judul"}” memang tidak memiliki tahun terbit yang dapat dicantumkan.`, null, "Sitasi");
    if (year && !/^(?:\d{4}|t\.?\s?t\.?|n\.?\s?d\.?)$/i.test(year)) add("info", "Format tahun sumber perlu ditinjau", `Tahun “${year}” tidak menggunakan format tahun empat digit atau penanda tanpa tahun yang umum.`, null, "Sitasi");
    const url = String(reference.url ?? "").trim();
    if (url && !/^(?:https?:\/\/|doi\.org\/)/i.test(url)) add("warning", "Tautan sumber tidak valid", `Tautan pada “${reference.title || "sumber tanpa judul"}” perlu diawali https:// atau doi.org/.`, null, "Sitasi");
    if (type === "website" && !url) add("warning", "URL sumber web belum diisi", `Tambahkan alamat laman untuk “${title || "sumber tanpa judul"}”.`, null, "Sitasi");
    if (type === "journal" && (!String(reference.volume ?? "").trim() || !String(reference.pages ?? "").trim())) add("info", "Detail artikel jurnal belum lengkap", `Lengkapi volume dan halaman untuk “${title || "artikel tanpa judul"}” jika tersedia.`, null, "Sitasi");
    const doi = String(reference.doi ?? "").trim();
    if (doi && !/^(?:10\.\d{4,9}\/|https?:\/\/doi\.org\/)/i.test(doi)) add("warning", "Format DOI perlu diperiksa", `DOI pada “${reference.title || "sumber tanpa judul"}” sebaiknya diawali 10.xxxx/ atau https://doi.org/.`, null, "Sitasi");
    if (doi) {
      const doiKey = doi.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").replace(/[.,;]+$/, "").toLocaleLowerCase("en-US");
      if (doiOwners.has(doiKey)) add("warning", "DOI dipakai oleh beberapa sumber", `DOI ini juga tercantum pada “${doiOwners.get(doiKey)}”; pastikan tiap entri menunjuk karya yang benar.`, null, "Sitasi");
      else doiOwners.set(doiKey, title || "sumber tanpa judul");
    }
    if (/^(?:todo|tbd|lorem ipsum|judul di sini|penulis di sini|untitled)$/i.test(title)) add("warning", "Judul sumber masih placeholder", "Ganti judul contoh pada data referensi dengan judul sumber yang sebenarnya.", null, "Sitasi");
  });
  const referenceKeys = new Set();
  references.forEach((reference) => {
    const keys = getReferenceIdentityKeys(reference);
    if (keys.some((key) => referenceKeys.has(key))) add("warning", "Sumber referensi terduplikasi", `Data “${reference.title || "sumber tanpa judul"}” tercatat lebih dari sekali. Cocokkan DOI, judul, penulis, dan tahun sebelum menghapus salah satunya.`, null, "Sitasi");
    keys.forEach((key) => referenceKeys.add(key));
  });
  if (citationIds.size > 0 && citedCount === 0) add("warning", "Sitasi perlu diperiksa", "Sitasi dalam teks tidak tertaut ke sumber yang tersimpan.", null, "Sitasi");

  const bodyPt = Number(document?.typography?.bodyPt);
  if (bodyPt && (bodyPt < 10 || bodyPt > 14)) add("warning", "Ukuran huruf isi di luar rentang umum", `Ukuran isi saat ini ${bodyPt} pt. Banyak pedoman memakai 10–14 pt; cocokkan dengan aturan kampus.`, null, "Format");
  const spacing = Number(document?.paragraph?.lineSpacing);
  if (spacing && (spacing < 1 || spacing > 2)) add("warning", "Jarak baris tidak umum", `Jarak baris saat ini ${spacing}. Banyak pedoman memakai 1,0–2,0; cocokkan dengan aturan kampus.`, null, "Format");
  const paper = document?.paper;
  const margins = document?.margins;
  if (paper && margins && (margins.leftCm + margins.rightCm >= paper.widthCm || margins.topCm + margins.bottomCm >= paper.heightCm)) add("warning", "Margin tidak menyisakan area halaman", "Jumlah margin pada salah satu arah sama dengan atau melebihi ukuran kertas.", null, "Format");

  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const infos = findings.filter((finding) => finding.severity === "info").length;
  return { findings, warnings, infos, citedCount, referenceCount: references.length, headingCounts };
}
