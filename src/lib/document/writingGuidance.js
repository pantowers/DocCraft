const SECTION_GUIDANCE = [
  { pattern: /latar belakang|pendahuluan|introduction/i, title: "Bangun alasan penelitian", points: ["Jelaskan konteks dan kondisi yang sedang terjadi.", "Dukung masalah dengan data atau sumber yang dapat ditelusuri.", "Tunjukkan kesenjangan atau alasan topik ini perlu dikaji.", "Arahkan uraian menuju fokus dan tujuan penelitian."] },
  { pattern: /rumusan masalah|pertanyaan penelitian|research question/i, title: "Rumuskan masalah dengan jelas", points: ["Tuliskan pertanyaan yang spesifik dan dapat dijawab oleh data.", "Pastikan cakupannya sesuai dengan batas penelitian.", "Gunakan istilah yang konsisten dengan tujuan dan metode."] },
  { pattern: /tujuan penelitian|tujuan penulisan|objective|aim/i, title: "Selaraskan tujuan", points: ["Gunakan kata kerja yang menunjukkan hasil yang ingin dicapai.", "Pastikan setiap tujuan menjawab rumusan masalah yang terkait.", "Hindari tujuan yang tidak dapat diperiksa melalui metode penelitian."] },
  { pattern: /manfaat|kontribusi|significance/i, title: "Jelaskan manfaat secara terarah", points: ["Bedakan manfaat teoretis dan praktis jika keduanya relevan.", "Sebutkan penerima manfaat dan bentuk kegunaannya.", "Hindari klaim dampak yang belum didukung hasil penelitian."] },
  { pattern: /tinjauan pustaka|landasan teori|kajian pustaka|literature review|theoretical/i, title: "Sintesis sumber dan teori", points: ["Bandingkan temuan sumber yang relevan, jangan hanya merangkum satu per satu.", "Gunakan sumber yang dapat ditelusuri dan cantumkan sitasi.", "Hubungkan konsep dan penelitian terdahulu dengan fokus penelitian ini."] },
  { pattern: /metode|metodologi|method/i, title: "Buat metode dapat ditelusuri", points: ["Jelaskan desain, subjek atau sumber data, dan cara pemilihannya.", "Uraikan instrumen, prosedur pengumpulan, serta langkah analisis.", "Sebutkan pertimbangan etik atau keterbatasan metode bila relevan."] },
  { pattern: /hasil|temuan|result|finding/i, title: "Sajikan temuan dengan tertib", points: ["Susun hasil mengikuti tujuan atau pertanyaan penelitian.", "Laporkan data secara akurat dan jelaskan tabel atau gambar yang digunakan.", "Pisahkan temuan yang diamati dari penafsiran penulis."] },
  { pattern: /pembahasan|diskusi|discussion|analisis/i, title: "Tafsirkan temuan", points: ["Jelaskan arti temuan dan kaitannya dengan pertanyaan penelitian.", "Bandingkan dengan teori atau penelitian terdahulu yang relevan.", "Bahas kemungkinan penjelasan dan batas interpretasi data."] },
  { pattern: /kesimpulan|penutup|conclusion/i, title: "Tarik kesimpulan dari hasil", points: ["Jawab tujuan atau rumusan masalah secara langsung.", "Pastikan setiap pernyataan didukung hasil yang telah dibahas.", "Jangan memasukkan data atau klaim baru pada bagian ini."] },
  { pattern: /saran|rekomendasi|recommendation/i, title: "Buat saran yang dapat ditindaklanjuti", points: ["Tautkan setiap saran pada temuan atau keterbatasan penelitian.", "Sebutkan pihak yang dituju dan langkah yang disarankan.", "Hindari saran umum yang tidak berkaitan dengan hasil."] },
];

function wordCount(html) {
  const text = String(html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
  return text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function getWritingGuidance(node) {
  if (!node) return null;
  if (node.type === "abstract") {
    const count = wordCount(node.content);
    const minWords = Number.isFinite(Number(node.minWords)) && Number(node.minWords) > 0 ? Number(node.minWords) : null;
    const maxWords = Number.isFinite(Number(node.maxWords)) && Number(node.maxWords) > 0 ? Number(node.maxWords) : null;
    const invalidRange = minWords !== null && maxWords !== null && minWords > maxWords;
    return {
      title: "Panduan abstrak",
      points: ["Ringkas tujuan atau masalah, metode, hasil utama, dan kesimpulan.", "Gunakan kalimat padat dan pastikan abstrak dapat dipahami tanpa membaca seluruh naskah.", "Ikuti batas kata dan format kata kunci dari pedoman kampus atau jurnal."],
      wordCount: count,
      minWords,
      maxWords,
      invalidRange,
      outsideLimit: !invalidRange && ((minWords !== null && count < minWords) || (maxWords !== null && count > maxWords)),
    };
  }
  if (!["chapter", "section", "subsection"].includes(node.type)) return null;
  const match = SECTION_GUIDANCE.find((item) => item.pattern.test(node.title ?? ""));
  return match ? { title: match.title, points: match.points } : null;
}
