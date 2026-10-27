const SUPERSCRIPT = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ" };
const SUBSCRIPT = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", i: "ᵢ", o: "ₒ", x: "ₓ", n: "ₙ" };
const COMMANDS = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", theta: "θ", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", phi: "φ", omega: "ω", times: "×", cdot: "·", pm: "±", approx: "≈", neq: "≠", le: "≤", leq: "≤", ge: "≥", geq: "≥", infty: "∞" };

function readGroup(source, start) {
  if (source[start] !== "{") return [source[start] ?? "", Math.min(start + 1, source.length)];
  let depth = 1;
  let index = start + 1;
  for (; index < source.length && depth; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") depth -= 1;
  }
  return [source.slice(start + 1, depth ? index : index - 1), index];
}

function scriptText(value, mapping, fallback) {
  const text = value.replace(/\\text\s*/g, "").replace(/[{}]/g, "").trim();
  if (text && [...text].every((character) => mapping[character])) return [...text].map((character) => mapping[character]).join("");
  return `${fallback}(${text})`;
}

export function renderLatexText(source) {
  const text = String(source ?? "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  let result = "";
  for (let index = 0; index < text.length;) {
    const character = text[index];
    if (character === "\\") {
      const match = text.slice(index + 1).match(/^[A-Za-z]+/);
      if (!match) { result += text[index + 1] ?? ""; index += 2; continue; }
      const command = match[0];
      index += command.length + 1;
      if (command === "frac") {
        while (/\s/.test(text[index] ?? "")) index += 1;
        const [numerator, afterNumerator] = readGroup(text, index); index = afterNumerator;
        while (/\s/.test(text[index] ?? "")) index += 1;
        const [denominator, afterDenominator] = readGroup(text, index); index = afterDenominator;
        result += `${renderLatexText(numerator)} / ${renderLatexText(denominator)}`;
      } else if (command === "text" || command === "mathrm" || command === "mathbf") {
        while (/\s/.test(text[index] ?? "")) index += 1;
        const [group, next] = readGroup(text, index); index = next;
        result += renderLatexText(group);
      } else if (command === "sqrt") {
        while (/\s/.test(text[index] ?? "")) index += 1;
        const [group, next] = readGroup(text, index); index = next;
        result += `√(${renderLatexText(group)})`;
      } else if (["left", "right", "quad", "qquad", "displaystyle"].includes(command)) {
        if (["quad", "qquad"].includes(command)) result += " ";
      } else result += COMMANDS[command] ?? `\\${command}`;
      continue;
    }
    if (character === "^" || character === "_") {
      const [group, next] = readGroup(text, index + 1);
      result += scriptText(group, character === "^" ? SUPERSCRIPT : SUBSCRIPT, character);
      index = next;
      continue;
    }
    if (character === "{" || character === "}") { index += 1; continue; }
    result += character;
    index += 1;
  }
  return result.replace(/\s+/g, " ").trim();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export function renderMathNotationHtml(html) {
  return String(html ?? "").replace(/\$([^$\n]+)\$/g, (_, formula) => {
    const rendered = escapeHtml(renderLatexText(formula));
    const source = escapeHtml(formula);
    return `<span class="dc-inline-math" data-dc-math-source="${source}" contenteditable="false">${rendered}</span>`;
  });
}
