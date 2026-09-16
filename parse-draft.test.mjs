import assert from "node:assert/strict";
import { test } from "node:test";
import { extractMessageText, parseDraft, repairMathText, uniqueDownloadName } from "./parse-draft.mjs";

test("parses Qwen-style JSON with raw LaTeX backslashes", () => {
  const raw = String.raw`{"course":"线性代数","title":"第8题","problems":[{"number":"8","stem":"化为RREF","solution":[{"kind":"math","latex":"\begin{pmatrix} 1 & 0 \\ 0 & 1 \end{pmatrix}"}]}]}`;
  const draft = parseDraft(raw);
  assert.equal(draft.title, "第8题");
  assert.equal(draft.problems[0].solution[0].latex, String.raw`\begin{pmatrix} 1 & 0 \\ 0 & 1 \end{pmatrix}`);
});

test("keeps already-valid JSON latex", () => {
  const raw = JSON.stringify({
    course: "线性代数",
    title: "第8题",
    problems: [
      {
        number: "8",
        stem: "化为RREF",
        solution: [{ kind: "math", latex: String.raw`\begin{pmatrix} 1 & 0 \\ 0 & 1 \end{pmatrix}` }],
      },
    ],
  });
  const draft = parseDraft(raw);
  assert.equal(draft.problems[0].solution[0].latex, String.raw`\begin{pmatrix} 1 & 0 \\ 0 & 1 \end{pmatrix}`);
});

test("parses fenced JSON with trailing comma and frac/times", () => {
  const raw = String.raw`好的，这是结果：
` + "```json\n" + String.raw`{"problems":[{"stem":"求 $\frac{1}{2}$","solution":[{"kind":"text","text":"用 $\times$ 与 $\right)$"},],}]}` + "\n```";
  const draft = parseDraft(raw);
  assert.match(draft.problems[0].stem, /frac/);
  assert.match(draft.problems[0].solution[0].text, /times/);
});

test("reads OpenAI-style array message content", () => {
  const text = extractMessageText([
    { type: "text", text: '{"problems":[{"stem":"1","solution":[{"kind":"text","text":"ok"}]}]}' },
  ]);
  const draft = parseDraft(text);
  assert.equal(draft.problems[0].stem, "1");
});

test("repairs frac that JSON would silently mangle", () => {
  const raw = String.raw`{"problems":[{"stem":"求 \frac{1}{2}","solution":[{"kind":"math","latex":"\times 2"}]}]}`;
  const draft = parseDraft(raw);
  assert.equal(draft.problems[0].stem, String.raw`求 $\frac{1}{2}$`);
  assert.equal(draft.problems[0].solution[0].latex, String.raw`\times 2`);
});

test("collapses over-escaped pmatrix latex", () => {
  const raw = JSON.stringify({
    problems: [
      {
        stem: "化为RREF",
        solution: [
          {
            kind: "math",
            latex: String.raw`\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}`,
          },
        ],
      },
    ],
  });
  const draft = parseDraft(raw);
  assert.equal(
    draft.problems[0].solution[0].latex,
    String.raw`\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}`
  );
});

test("drops consecutive duplicate matrices", () => {
  const matrix = String.raw`\begin{pmatrix} 1 \end{pmatrix}`;
  const raw = JSON.stringify({
    problems: [
      {
        stem: "x",
        solution: [
          { kind: "math", latex: matrix },
          { kind: "math", latex: matrix },
          { kind: "rowops", from: matrix, ops: ["r_2"], to: String.raw`\begin{pmatrix} 2 \end{pmatrix}` },
        ],
      },
    ],
  });
  const draft = parseDraft(raw);
  assert.equal(draft.problems[0].solution.length, 2);
  assert.equal(draft.problems[0].solution[0].kind, "math");
  assert.equal(draft.problems[0].solution[1].kind, "rowops");
});

test("unique download names increment on collision", () => {
  const used = [];
  assert.equal(uniqueDownloadName("第 8 题", "pdf", used), "第8题.pdf");
  assert.equal(uniqueDownloadName("第 8 题", "pdf", used), "第8题-2.pdf");
  assert.equal(uniqueDownloadName("第8题", "tex", used), "第8题.tex");
  assert.equal(uniqueDownloadName("", "pdf", used), "qingyang.pdf");
});

test("closes unclosed display math in induction text", () => {
  const src = String.raw`假设当 n = k 时成立, 即 $$S_k = \frac{1}{6} \cdot k \cdot (k+1) \cdot (2k+1)`;
  const out = repairMathText(src);
  assert.match(out, /\$\$S_k[\s\S]*\$\$$/);
  const draft = parseDraft(
    JSON.stringify({
      problems: [{ stem: "归纳", solution: [{ kind: "text", text: src }] }],
    })
  );
  assert.match(draft.problems[0].solution[0].text, /\$\$S_k[\s\S]*\$\$$/);
});

test("strips leftover \\n from latex so KaTeX does not show it", () => {
  const raw = JSON.stringify({
    problems: [
      {
        stem: "x",
        solution: [
          {
            kind: "math",
            latex: String.raw`\frac{1}{6}(k+1)(k+2)(2k+3)\n`,
          },
        ],
      },
    ],
  });
  const draft = parseDraft(raw);
  assert.equal(draft.problems[0].solution[0].latex, String.raw`\frac{1}{6}(k+1)(k+2)(2k+3)`);
  assert.doesNotMatch(draft.problems[0].solution[0].latex, /\\n/);
});
