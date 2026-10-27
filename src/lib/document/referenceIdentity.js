function normalizeIdentityText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("id-ID")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeDoi(value) {
  return String(value ?? "")
    .trim()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "")
    .replace(/[.,;]+$/, "")
    .toLocaleLowerCase("en-US");
}

export function getReferenceIdentityKeys(reference) {
  const keys = [];
  const doi = normalizeDoi(reference?.doi);
  if (doi) keys.push(`doi:${doi}`);

  const title = normalizeIdentityText(reference?.title);
  if (title) {
    const authors = normalizeIdentityText(reference?.authors);
    const year = normalizeIdentityText(reference?.year);
    keys.push(`work:${authors}| ${year}| ${title}`);
  }
  return keys;
}

export function areReferencesDuplicates(left, right) {
  const rightKeys = new Set(getReferenceIdentityKeys(right));
  return getReferenceIdentityKeys(left).some((key) => rightKeys.has(key));
}
