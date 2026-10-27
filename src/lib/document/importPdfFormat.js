import { createEmptyDocument, PAPER_PRESETS } from "./schema";

const PT_PER_CM = 72 / 2.54;

function within(value, low, high) {
  return Number.isFinite(value) && value >= low && value <= high;
}

/** Extract common PDF page geometry and best-effort text defaults for a user-reviewed preset. */
export async function formatPresetFromPdfFile(file) {
  if (file.size > 40 * 1024 * 1024) throw new Error("Ukuran PDF maksimal 40 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const source = new TextDecoder("latin1").decode(bytes);
  if (!source.startsWith("%PDF-")) throw new Error("Berkas ini tidak memiliki header PDF yang valid.");
  const pageBox = source.match(/\/(?:MediaBox|CropBox)\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/);
  if (!pageBox) throw new Error("Ukuran halaman PDF tidak dapat dibaca. PDF terenkripsi atau struktur berkasnya tidak didukung.");
  const [, x1, y1, x2, y2] = pageBox.map(Number);
  const widthPt = Math.abs(x2 - x1);
  const heightPt = Math.abs(y2 - y1);
  if (!within(widthPt, 280, 1700) || !within(heightPt, 280, 2200)) throw new Error("Ukuran halaman PDF di luar rentang kertas yang didukung.");
  const paper = { size: "Custom", widthCm: Number((widthPt / PT_PER_CM).toFixed(2)), heightCm: Number((heightPt / PT_PER_CM).toFixed(2)) };
  const knownPaper = Object.entries(PAPER_PRESETS).find(([, item]) => Math.abs(item.widthCm - paper.widthCm) < 0.2 && Math.abs(item.heightCm - paper.heightCm) < 0.2);
  if (knownPaper) Object.assign(paper, { size: knownPaper[0], ...knownPaper[1] });

  const positions = [...source.matchAll(/(?:^|\s)(-?[\d.]+)\s+(-?[\d.]+)\s+Tm\b/g)].slice(0, 120).map((match) => ({ x: Number(match[1]), y: Number(match[2]) })).filter((point) => within(point.x, x1, x2) && within(point.y, y1, y2));
  const base = createEmptyDocument();
  const margins = { ...base.margins };
  let geometryNote = "Margin dan tipografi memakai nilai awal DocCraft karena posisi teks PDF tidak tersedia sebagai data yang dapat dibaca.";
  if (positions.length >= 4) {
    const left = Math.min(...positions.map((point) => point.x)) - x1;
    const right = x2 - Math.max(...positions.map((point) => point.x));
    const top = y2 - Math.max(...positions.map((point) => point.y));
    const bottom = Math.min(...positions.map((point) => point.y)) - y1;
    const estimates = { leftCm: left / PT_PER_CM, rightCm: right / PT_PER_CM, topCm: top / PT_PER_CM, bottomCm: bottom / PT_PER_CM };
    if (Object.values(estimates).every((value) => within(value, 0, 10))) {
      Object.entries(estimates).forEach(([key, value]) => { margins[key] = Number(value.toFixed(1)); });
      geometryNote = "Margin diperkirakan dari posisi teks yang terdeteksi pada PDF. Periksa kembali karena header, footer, dan halaman khusus dapat memengaruhi perkiraan.";
    }
  }
  const fontSizes = [...source.matchAll(/(?:^|\s)(\d{1,2}(?:\.\d+)?)\s+Tf\b/g)].map((match) => Number(match[1])).filter((value) => within(value, 6, 36));
  const bodySize = fontSizes.length ? fontSizes.sort((a, b) => a - b)[Math.floor(fontSizes.length / 2)] : null;
  const fontMatch = source.match(/\/BaseFont\s*\/([A-Za-z0-9+_-]+)/);
  if (bodySize) base.typography.bodyPt = bodySize;
  if (fontMatch) {
    const family = fontMatch[1].replace(/^[A-Z]{6}\+/, "").replace(/[-_,](Bold|Italic|Regular|Roman).*$/i, "");
    if (family.length <= 80) base.typography.fontFamily = family.replace(/([a-z])([A-Z])/g, "$1 $2");
  }
  return {
    sourceName: file.name,
    sourceType: "PDF",
    paper,
    margins,
    typography: base.typography,
    paragraph: base.paragraph,
    extractionNote: `${geometryNote} PDF tidak menyimpan semua aturan paragraf seperti DOCX; jarak baris, indentasi, dan perataan perlu diperiksa manual.`,
  };
}
