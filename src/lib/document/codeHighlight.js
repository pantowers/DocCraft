const KEYWORDS = new Set(("and as assert async await break class const continue def del elif else except false finally for from function global if import in is lambda let nonlocal not or pass raise return self static try while with yield true var void public private protected interface implements extends new this null undefined switch case default do enum export package super throw throws catch finally using namespace select insert update delete into values where join on group by order having limit create table drop alter primary key foreign references int float double char string boolean return print").split(/\s+/));
const BUILTINS = new Set(("print len range enumerate zip map filter sum min max abs open input isinstance type list dict set tuple str int float bool object super self console log require include include_once echo count array var_dump plt imread imshow cvtColor axis show predict fit transform load read_csv to_csv").split(/\s+/));
const COLORS = {
  dark: { comment: "#858585", string: "#6bdc75", number: "#f2b880", keyword: "#c792ea", callable: "#82cfff", operator: "#89ddff", plain: "#e6e6e6" },
  light: { comment: "#64748b", string: "#15803d", number: "#b45309", keyword: "#7e22ce", callable: "#0369a1", operator: "#0284c7", plain: "#1f2937" },
};
const CODE_THEMES = {
  dark: { background: "#181818", header: "#202020", foreground: "#e6e6e6", border: "#333333", label: "#aaaaaa" },
  light: { background: "#f1f5f9", header: "#e2e8f0", foreground: "#1f2937", border: "#cbd5e1", label: "#64748b" },
};

export function resolveCodeLanguage(language, source = "") {
  if (language === "plain") return "text";
  if (language && !["auto", "text"].includes(language)) return language;
  const code = String(source ?? "");
  if (/^\s*(?:from\s+[\w.]+\s+import\s+|import\s+[\w.]+|def\s+\w+\s*\(|class\s+\w+\s*(?:\(|:)|if\s+__name__\s*==|print\s*\()/m.test(code)) return "python";
  if (/^\s*(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|CREATE\s+TABLE|DELETE\s+FROM)\b/im.test(code)) return "sql";
  if (/<(?:!doctype|html|head|body|div|section|script|style)\b/i.test(code)) return "html";
  if (/^\s*(?:const|let|var|function|export\s+default|import\s+.+\s+from\s+["']|console\.(?:log|error))\b/m.test(code) || /=>/.test(code)) return "javascript";
  if (/^\s*(?:interface|type)\s+\w+\s*(?:=|\{)/m.test(code)) return "typescript";
  return "text";
}

function tokenKind(token, language, remainder) {
  if (!language || language === "text") return "plain";
  if (/^(#|\/\/|--|\/\*)/.test(token)) return "comment";
  if (/^(?:"|'|`)/.test(token)) return "string";
  if (/^\d/.test(token)) return "number";
  const lower = token.toLowerCase();
  if (KEYWORDS.has(token) || ((language === "python" || language === "sql") && KEYWORDS.has(lower))) return "keyword";
  if (BUILTINS.has(token) || /^[$\w]+(?=\s*\()/.test(`${token}${remainder}`)) return "callable";
  if (/^(?:[=+*/%<>!&|^~:-]+|[{}()[\].,;])$/.test(token)) return "operator";
  return "plain";
}

/** Lightweight, dependency-free syntax coloring for common thesis code languages. */
export function tokenizeCodeLine(line, language = "text") {
  const activeLanguage = resolveCodeLanguage(language, line);
  const tokens = [];
  const pattern = /#.*$|\/\/.*$|--.*$|\/\*[\s\S]*?\*\/|"""[\s\S]*?"""|'''[\s\S]*?'''|`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|[A-Za-z_$][\w$]*|[^\w\s]+|\s+/gi;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    const token = match[0];
    const remainder = line.slice(pattern.lastIndex);
    tokens.push({ text: token, kind: tokenKind(token, activeLanguage, remainder) });
  }
  return tokens;
}

export function codeTokenColor(kind, theme = "dark") {
  const palette = COLORS[theme] ?? COLORS.dark;
  return palette[kind] ?? palette.plain;
}

export function getCodeTheme(theme = "dark") {
  return CODE_THEMES[theme] ?? CODE_THEMES.dark;
}

export function highlightCodeHtml(code, language = "text", theme = "dark") {
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const activeLanguage = resolveCodeLanguage(language, code);
  return String(code ?? "").split("\n").map((line) => tokenizeCodeLine(line, activeLanguage).map(({ text, kind }) => `<span style="color:${codeTokenColor(kind, theme)}">${escape(text)}</span>`).join("") || " ").join("\n");
}
