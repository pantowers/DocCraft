import { createId } from "@/lib/document/schema";

const storageKey = "doccraft-custom-presets";

export function readCustomPresets() {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(value) ? value.filter((item) => item && typeof item.id === "string" && typeof item.name === "string" && item.paper && item.margins) : [];
  } catch {
    return [];
  }
}

export function saveCustomPreset(name, paper, margins, typography = null, paragraph = null, styleSettings = {}) {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Masukkan nama preset.");
  const presets = readCustomPresets();
  if (presets.some((preset) => preset.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) {
    throw new Error("Nama preset tersebut sudah digunakan.");
  }
  const preset = {
    id: createId(), name: cleanName, paper: { ...paper }, margins: { ...margins },
    ...(typography ? { typography: { ...typography } } : {}),
    ...(paragraph ? { paragraph: { ...paragraph } } : {}),
    ...(styleSettings.outlineStyles ? { outlineStyles: structuredClone(styleSettings.outlineStyles) } : {}),
    ...(styleSettings.pageNumbering ? { pageNumbering: { ...styleSettings.pageNumbering } } : {}),
  };
  window.localStorage.setItem(storageKey, JSON.stringify([...presets, preset]));
  return preset;
}

export function removeCustomPreset(id) {
  const presets = readCustomPresets().filter((preset) => preset.id !== id);
  window.localStorage.setItem(storageKey, JSON.stringify(presets));
  return presets;
}

export function validateCustomPresets(importedPresets) {
  if (!Array.isArray(importedPresets)) throw new Error("Daftar preset di backup tidak valid.");
  for (const source of importedPresets) {
    if (!source || typeof source.name !== "string" || !source.name.trim() || !source.paper || !source.margins) {
      throw new Error("Ada preset di backup yang tidak valid.");
    }
    const validPaper = typeof source.paper.size === "string" && Number.isFinite(source.paper.widthCm) && source.paper.widthCm > 0 && Number.isFinite(source.paper.heightCm) && source.paper.heightCm > 0;
    const marginValues = [source.margins.topCm, source.margins.rightCm, source.margins.bottomCm, source.margins.leftCm];
    if (!validPaper || marginValues.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("Ukuran kertas atau margin pada preset backup tidak valid.");
  }
  return true;
}

export function importCustomPresets(importedPresets) {
  validateCustomPresets(importedPresets);
  const presets = readCustomPresets();
  const imported = [];
  for (const source of importedPresets) {
    const nameBase = source.name.trim();
    let name = nameBase;
    let suffix = 2;
    while ([...presets, ...imported].some((preset) => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      name = `${nameBase} (${suffix})`;
      suffix += 1;
    }
    imported.push({ id: createId(), name, paper: { ...source.paper }, margins: { ...source.margins }, ...(source.typography ? { typography: { ...source.typography } } : {}), ...(source.paragraph ? { paragraph: { ...source.paragraph } } : {}), ...(source.outlineStyles ? { outlineStyles: structuredClone(source.outlineStyles) } : {}), ...(source.pageNumbering ? { pageNumbering: { ...source.pageNumbering } } : {}) });
  }
  const merged = [...presets, ...imported];
  window.localStorage.setItem(storageKey, JSON.stringify(merged));
  return { presets: merged, importedCount: imported.length };
}
