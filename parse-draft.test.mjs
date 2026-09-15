import assert from "node:assert/strict";
import { test } from "node:test";
import { extractMessageText, parseDraft } from "./parse-draft.mjs";

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
  assert.equal(draft.problems[0].stem, String.raw`求 \frac{1}{2}`);
  assert.equal(draft.problems[0].solution[0].latex, String.raw`\times 2`);
});
