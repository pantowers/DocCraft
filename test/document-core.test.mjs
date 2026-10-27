import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function sourceModule(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const encoded = Buffer.from(source).toString("base64");
  return import("data:text/javascript;base64," + encoded);
}

const hanging = await sourceModule("../src/lib/document/hanging.js");
const code = await sourceModule("../src/lib/document/codeHighlight.js");
const stats = await sourceModule("../src/lib/document/stats.js");
const paragraphs = await sourceModule("../src/lib/document/paragraphFormat.js");

test("hanging markers support decimal, alphabetic rollover and bullets", () => {
  assert.equal(hanging.formatHangingMarker("decimal", 3), "3");
  assert.equal(hanging.formatHangingMarker("lower-alpha", 26), "z");
  assert.equal(hanging.formatHangingMarker("lower-alpha", 27), "aa");
  assert.equal(hanging.formatHangingMarker("upper-alpha", 28), "AB");
  assert.equal(hanging.formatHangingMarker("bullet", 1), "•");
});

test("hanging list counters continue across nested nodes by list id", () => {
  const result = hanging.collectHangingNumbers([{ id: "p1", hangingList: { listId: "a" } }, { id: "chapter", children: [{ id: "p2", hangingList: { listId: "a" } }, { id: "p3", hangingList: { listId: "b" } }] }]);
  assert.deepEqual(result, { p1: 1, p2: 2, p3: 1 });
});

test("code language detection and tokenization produce syntax categories", () => {
  assert.equal(code.resolveCodeLanguage("auto", "const total = 42;"), "javascript");
  const tokens = code.tokenizeCodeLine("const total = 42;", "javascript");
  assert.ok(tokens.some((token) => token.kind === "keyword" && token.text === "const"));
  assert.ok(tokens.some((token) => token.kind === "number" && token.text === "42"));
  const escapedCode = code.highlightCodeHtml("<script>", "text");
  assert.match(escapedCode, /&lt;/);
  assert.match(escapedCode, /&gt;/);
  assert.doesNotMatch(escapedCode, /<script>/i);
});

test("document statistics traverse headings, rich paragraphs and table cells", () => {
  const nodes = [{ type: "chapter", title: "BAB I PENDAHULUAN", children: [{ type: "paragraph", content: "<p>Kalimat <strong>akademik</strong></p>" }, { type: "table", caption: "Tabel data", tableData: { rows: [["Nilai", "Dua"]] } }] }];
  assert.equal(stats.getDocumentWordCount(nodes), 9);
  assert.equal(stats.getDocumentHeadingCount(nodes), 1);
  assert.equal(stats.getDocumentStructureCounts(nodes).tables, 1);
});

test("outline paragraph styles combine defaults and custom overrides", () => {
  const style = paragraphs.getOutlineStyle({ outlineStyles: { section: { alignment: "center", beforePt: 18 } } }, "section");
  assert.equal(style.alignment, "center");
  assert.equal(style.beforePt, 18);
  assert.equal(style.keepWithNext, true);
  assert.equal(paragraphs.getParagraphTextIndentCm({ specialIndentType: "firstLine", specialIndentCm: 1.25 }), 1.25);
});
