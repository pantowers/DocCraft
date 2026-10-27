export const FRONT_MATTER_PROFILE_DEFAULTS = {
  thesisTitle: "",
  author: "",
  studentId: "",
  institution: "",
  faculty: "",
  department: "",
  concentration: "",
  programLevel: "",
  workType: "TUGAS AKHIR",
  city: "",
  year: String(new Date().getFullYear()),
};

export const FRONT_MATTER_TEMPLATE_FIELDS = {
  approval: [
    ["approvalDate", "Tanggal pengesahan"],
    ["deanName", "Nama dekan"], ["deanId", "NIP/NID dekan"],
    ["programHeadName", "Nama ketua program studi"], ["programHeadId", "NIP/NID ketua program studi"],
    ["rectorName", "Nama rektor"], ["rectorId", "NIP/NID rektor"],
  ],
  advisorApproval: [
    ["approvalDate", "Tanggal persetujuan"],
    ["advisorOneName", "Nama pembimbing I"], ["advisorOneId", "NID/NIP pembimbing I"],
    ["advisorTwoName", "Nama pembimbing II"], ["advisorTwoId", "NID/NIP pembimbing II"],
  ],
  examApproval: [
    ["approvalDate", "Tanggal ujian"],
    ["examinerOneName", "Nama penguji I"], ["examinerOneId", "NID/NIP penguji I"],
    ["examinerTwoName", "Nama penguji II"], ["examinerTwoId", "NID/NIP penguji II"],
    ["chiefExaminerName", "Nama ketua penguji"], ["chiefExaminerId", "NID/NIP ketua penguji"],
  ],
  originality: [["declarationDate", "Tanggal pernyataan"]],
};

export const FRONT_MATTER_TEMPLATE_TITLES = {
  approval: "LEMBAR PENGESAHAN TUGAS AKHIR",
  advisorApproval: "LEMBAR PERSETUJUAN PEMBIMBING",
  examApproval: "LEMBAR PERSETUJUAN PENGUJI",
  originality: "LEMBAR KEASLIAN TUGAS AKHIR",
  preface: "KATA PENGANTAR",
};

const value = (input, fallback = "") => String(input ?? fallback).trim();

export function getFrontMatterModel(node, profile = {}, documentTitle = "") {
  const template = node?.frontMatterTemplate;
  const data = node?.frontMatterData ?? {};
  const person = { ...FRONT_MATTER_PROFILE_DEFAULTS, ...profile };
  const thesisTitle = value(person.thesisTitle) || value(documentTitle, "Judul karya tulis");
  const institution = value(person.institution, "Nama perguruan tinggi");
  const faculty = value(person.faculty, "Nama fakultas");
  const department = value(person.department, "Nama program studi");
  const concentration = value(person.concentration, "Nama konsentrasi");
  const author = value(person.author, "Nama penulis");
  const studentId = value(person.studentId, "Nomor induk mahasiswa");
  const city = value(person.city, "Kota");
  const year = value(person.year, "Tahun");
  const date = value(data.approvalDate ?? data.declarationDate) || [city, year].filter(Boolean).join(", ");
  const item = (label, text) => value(text) ? { label, text: value(text) } : null;
  const signer = (role, name, id) => ({ role, name: value(name), id: value(id) });

  if (!FRONT_MATTER_TEMPLATE_TITLES[template]) return null;
  if (template === "preface") return {
    template,
    title: node.title || FRONT_MATTER_TEMPLATE_TITLES.preface,
    body: node.content ?? "",
    signature: {
      city: value(data.signatureCity) || city,
      date: value(data.signatureDate),
      name: value(data.signatureName) || author,
    },
  };
  if (template === "originality") return {
    template,
    title: node.title || FRONT_MATTER_TEMPLATE_TITLES.originality,
    centered: [thesisTitle],
    paragraphs: [value(data.declarationText, "Saya yang bertanda tangan di bawah ini menyatakan bahwa tugas akhir ini merupakan karya tulis saya sendiri, bukan hasil tiruan atau plagiarisme, dan belum pernah diajukan untuk memperoleh gelar akademik di perguruan tinggi lain.")],
    info: [item("Nama", author), item("NIM", studentId), item("Program Studi", department), item("Konsentrasi", concentration)].filter(Boolean),
    date,
    signers: [[signer("Yang menyatakan", author, studentId ? `NIM: ${studentId}` : "")]],
  };

  const identity = [
    item("Nama", author), item("NIM", studentId), item("Fakultas", faculty),
    ...(person.programLevel ? [item("Program Pendidikan", person.programLevel)] : []),
    item("Program Studi", department), item("Konsentrasi", concentration),
  ].filter(Boolean);
  if (template === "approval") return {
    template,
    title: node.title || FRONT_MATTER_TEMPLATE_TITLES.approval,
    institution,
    centered: [thesisTitle],
    lead: "Disusun oleh",
    info: identity,
    sublead: "Disahkan Oleh:",
    date,
    signers: [
      [signer("Dekan", data.deanName, data.deanId), signer("Ketua Program Studi", data.programHeadName, data.programHeadId)],
      [signer("Rektor", data.rectorName, data.rectorId)],
    ],
  };
  if (template === "advisorApproval") return {
    template,
    title: node.title || FRONT_MATTER_TEMPLATE_TITLES.advisorApproval,
    institution,
    centered: [thesisTitle],
    lead: "Disusun oleh",
    info: [item("Nama", author), item("NIM", studentId)],
    paragraphs: [`Telah disetujui untuk dipertahankan di hadapan Tim Penguji ${value(person.workType, "Ujian")}`, department, concentration, faculty].filter(Boolean),
    sublead: "Disetujui Oleh:",
    date,
    signers: [[signer("Pembimbing I", data.advisorOneName, data.advisorOneId), signer("Pembimbing II", data.advisorTwoName, data.advisorTwoId)]],
  };
  return {
    template,
    title: node.title || FRONT_MATTER_TEMPLATE_TITLES.examApproval,
    institution,
    centered: [thesisTitle],
    lead: "Disusun oleh",
    info: [item("Nama", author), item("NIM", studentId)],
    paragraphs: [`Telah dipertahankan di hadapan Tim Penguji ${value(person.workType, "Ujian")}`, department, concentration, faculty].filter(Boolean),
    sublead: "Disetujui Oleh:",
    date,
    signers: [
      [signer("Penguji I", data.examinerOneName, data.examinerOneId), signer("Penguji II", data.examinerTwoName, data.examinerTwoId)],
      [signer("Ketua Penguji", data.chiefExaminerName, data.chiefExaminerId)],
    ],
  };
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export function renderFrontMatterModelHtml(model) {
  if (!model) return "";
  if (model.template === "preface") return `<section class="front-matter-template front-matter-template--preface" style="display:flex;flex-direction:column;min-height:20cm"><h2 class="fm-title" align="center">${escapeHtml(model.title)}</h2><div class="fm-preface-body">${sanitizeEditorHtml(model.body)}</div><div class="fm-preface-signature" style="width:50%;margin-left:auto;margin-top:auto;padding-top:20pt;text-align:right;break-inside:avoid">${model.signature.city || model.signature.date ? `<p align="right">${escapeHtml([model.signature.city, model.signature.date].filter(Boolean).join(", "))}</p>` : ""}<p align="right">Penulis,</p><p align="right"><br><br><br><strong><u>${escapeHtml(model.signature.name || "\u00a0")}</u></strong></p></div></section>`;
  const lines = [];
  if (model.institution) lines.push(`<p class="fm-center fm-institution"><strong>${escapeHtml(model.institution)}</strong></p>`);
  lines.push(`<h2 class="fm-title" align="center">${escapeHtml(model.title)}</h2>`);
  (model.centered ?? []).forEach((line) => lines.push(`<p class="fm-center"><strong>${escapeHtml(line)}</strong></p>`));
  if (model.lead) lines.push(`<p class="fm-center fm-lead">${escapeHtml(model.lead)}</p>`);
  if (model.info?.length) lines.push(`<div class="fm-info">${model.info.map((entry) => `<p><span>${escapeHtml(entry.label)}</span><span>: ${escapeHtml(entry.text)}</span></p>`).join("")}</div>`);
  (model.paragraphs ?? []).forEach((line) => lines.push(`<p class="fm-center">${escapeHtml(line)}</p>`));
  if (model.sublead) lines.push(`<p class="fm-center fm-sublead">${escapeHtml(model.sublead)}</p>`);
  if (model.date) lines.push(`<p class="fm-date" align="right">${escapeHtml(model.date)}</p>`);
  (model.signers ?? []).forEach((group) => {
    lines.push(`<div class="fm-signers fm-signers--${group.length}">${group.map((entry) => `<div><p>${escapeHtml(entry.role)}</p><div class="fm-signature-space"></div><p><strong><u>${escapeHtml(entry.name || "\u00a0")}</u></strong>${entry.id ? `<br><strong>${escapeHtml(entry.id)}</strong>` : ""}</p></div>`).join("")}</div>`);
  });
  return `<section class="front-matter-template front-matter-template--${escapeHtml(model.template)}">${lines.join("")}</section>`;
}

export function renderFrontMatterTemplateHtml(node, profile, documentTitle) {
  return renderFrontMatterModelHtml(getFrontMatterModel(node, profile, documentTitle));
}

export function createThesisFrontMatterNodes() {
  return [
    { type: "titlePage", title: "Cover", coverData: {} },
    ...Object.entries(FRONT_MATTER_TEMPLATE_TITLES).map(([frontMatterTemplate, title]) => ({
      type: "frontMatter", title, frontMatterTemplate, frontMatterData: {},
      content: frontMatterTemplate === "preface" ? "<p>Puji syukur penulis panjatkan kepada Tuhan Yang Maha Esa atas rahmat dan karunia-Nya sehingga tugas akhir ini dapat diselesaikan.</p><p>Penulis menyampaikan terima kasih kepada semua pihak yang telah memberikan bantuan, bimbingan, dan dukungan selama proses penyusunan tugas akhir ini.</p><p>Penulis menyadari bahwa karya ini masih memiliki kekurangan. Kritik dan saran yang membangun sangat diharapkan.</p>" : "",
    })),
    { type: "abstract", title: "ABSTRAK" },
    { type: "tableOfContents", title: "DAFTAR ISI" },
    { type: "listOfFigures", title: "DAFTAR GAMBAR" },
    { type: "listOfTables", title: "DAFTAR TABEL" },
  ];
}
import { sanitizeEditorHtml } from "@/lib/document/sanitizeHtml";

