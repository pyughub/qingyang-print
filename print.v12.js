function looksLikeHtml(text) {
  const s = String(text || "").trimStart().slice(0, 16).toLowerCase();
  return s.startsWith("<!doctype") || s.startsWith("<html");
}

function extractMessageText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") return part.text || part.content || "";
        return "";
      })
      .join("");
  }
  if (typeof content === "object") return content.text || content.content || "";
  return String(content);
}

function extractObject(raw) {
  let s = String(raw || "").trim().replace(/^\uFEFF/, "");
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  if (start === -1) return "";
  const end = s.lastIndexOf("}");
  return end > start ? s.slice(start, end + 1) : s.slice(start);
}

function hasLatexControlGarbage(value) {
  if (typeof value === "string") {
    return /[\x08\x0c]/.test(value) || /[\x09\x0d][A-Za-z]/.test(value);
  }
  if (Array.isArray(value)) return value.some(hasLatexControlGarbage);
  if (value && typeof value === "object") {
    return Object.values(value).some(hasLatexControlGarbage);
  }
  return false;
}

function tryParse(src) {
  try {
    const draft = JSON.parse(src);
    if (!draft || typeof draft !== "object") return null;
    if (hasLatexControlGarbage(draft)) return null;
    return draft;
  } catch {
    return null;
  }
}

function escapeBadStrings(src) {
  let out = "";
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (!inStr) {
      if (c === '"') inStr = true;
      out += c;
      continue;
    }
    if (escaped) {
      out += c;
      escaped = false;
      continue;
    }
    if (c === "\\") {
      const n = src[i + 1];
      if (n === '"' || n === "/") {
        out += c;
        escaped = true;
        continue;
      }
      if (n === "u" && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) {
        out += c;
        escaped = true;
        continue;
      }
      out += "\\\\";
      continue;
    }
    if (c === '"') {
      inStr = false;
      out += c;
      continue;
    }
    if (c === "\n") {
      out += "\\n";
      continue;
    }
    if (c === "\r") {
      out += "\\r";
      continue;
    }
    if (c === "\t") {
      out += "\\t";
      continue;
    }
    out += c;
  }
  if (inStr) out += '"';
  return out;
}

function closeOpen(s) {
  const stack = [];
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if ((c === "}" || c === "]") && stack[stack.length - 1] === c) stack.pop();
  }
  if (inStr) s += '"';
  while (stack.length) s += stack.pop();
  return s;
}

function salvageJson(raw) {
  const extracted = extractObject(raw);
  if (!extracted) return "";
  const escaped = escapeBadStrings(extracted).replace(/,(\s*[}\]])/g, "$1");
  return closeOpen(escaped);
}

function looksOverEscaped(s) {
  return /\\\\(begin|end|frac|left|right|mathrm|mathbf|text|times|cdot|quad)/.test(s);
}

function normalizeLatex(s) {
  let t = String(s || "").trim();
  t = t.replace(/^\$+|\$+$/g, "").trim();
  for (let i = 0; i < 3 && looksOverEscaped(t); i++) {
    t = t.replace(/\\\\/g, "\\");
  }
  return t;
}

function canonLatex(s) {
  return normalizeLatex(s).replace(/\s+/g, "");
}

function tidySolution(steps) {
  const src = Array.isArray(steps) ? steps : [];
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const step = { ...src[i] };
    if (typeof step.latex === "string") step.latex = normalizeLatex(step.latex);
    if (typeof step.from === "string") step.from = normalizeLatex(step.from);
    if (typeof step.to === "string") step.to = normalizeLatex(step.to);
    if (typeof step.text === "string") step.text = normalizeLatex(step.text);
    if (Array.isArray(step.ops)) step.ops = step.ops.map((op) => normalizeLatex(op));
    if (step.kind === "text" && /\\begin\{(?:p|b)matrix\}/.test(step.text || "")) {
      step.kind = "math";
      step.latex = normalizeLatex(step.text);
      delete step.text;
    }
    const prev = out[out.length - 1];
    if (step.kind === "math") {
      if (prev?.kind === "math" && canonLatex(prev.latex) === canonLatex(step.latex)) continue;
      if (prev?.kind === "rowops" && canonLatex(prev.to) === canonLatex(step.latex)) continue;
    }
    out.push(step);
  }
  return out;
}

function normalizeDraft(draft) {
  if (!draft || typeof draft !== "object") return draft;
  if (typeof draft.stem === "string") draft.stem = normalizeLatex(draft.stem);
  for (const problem of draft.problems || []) {
    if (typeof problem.stem === "string") problem.stem = normalizeLatex(problem.stem);
    problem.solution = tidySolution(problem.solution);
  }
  return draft;
}

function parseDraft(text) {
  const trimmed = String(text || "").trim();
  if (looksLikeHtml(trimmed)) {
    throw new Error("排版接口返回了网页。请关掉这一页，重新打开后再付印。");
  }
  const extracted = extractObject(trimmed);
  if (!extracted) {
    throw new Error("没有认出可排版的结构。请换一张更清晰、只含一题的照片。");
  }
  const draft =
    tryParse(extracted) ||
    tryParse(extracted.replace(/,(\s*[}\]])/g, "$1")) ||
    tryParse(salvageJson(trimmed));
  if (draft) return normalizeDraft(draft);
  throw new Error("认出来了，但结果损坏。请再点一次付印。");
}

function uniqueDownloadName(title, ext, used) {
  const base = String(title || "qingyang").replace(/\s+/g, "") || "qingyang";
  const suffix = String(ext || "pdf").replace(/^\./, "");
  let name = `${base}.${suffix}`;
  let n = 2;
  while (used.includes(name)) {
    name = `${base}-${n}.${suffix}`;
    n += 1;
  }
  used.push(name);
  return name;
}

const KEYS = {
  provider: "qingyang.provider",
  key: "qingyang.key",
  model: "qingyang.model",
  base: "qingyang.base",
};

const PRESETS = {
  qwen: {
    base: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-vl-plus",
  },
  siliconflow: {
    base: "https://api.siliconflow.cn/v1",
    model: "Qwen/Qwen2.5-VL-32B-Instruct",
  },
  gemini: { base: "", model: "gemini-3.6-flash" },
  openai: { base: "https://api.openai.com/v1", model: "" },
};

const COMPOSE_PROMPT = `你是中文理科作业排版员。用户会给你一张手写解题过程的照片（通常只含一题）。

任务：读懂手写内容，整理成工整印刷体所需的结构化数据。不要发明没写过的步骤；数字、行变换、符号必须与照片一致。若题干被裁掉，根据解答过程补一句简短题干。

只输出一个 JSON 对象，不要 markdown。latex 写真正的公式，例如 \\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}。JSON 会自己转义，不要再把反斜杠加倍。同一矩阵不要重复写两遍。

字段：
- course 默认「线性代数」
- title 用「第 n 题」
- problems[].number / stem / solution
- solution[].kind 只能是 text、math、rowops
- text：中文说明，可含 $行内公式$
- math.latex：不含 $$ 的公式，矩阵用 pmatrix
- rowops：from / to 是矩阵 latex，ops 是行变换，例如 ["r_2+(-4)r_1"]`;

const glass = document.getElementById("glass");
const thumbs = document.getElementById("thumbs");
const hint = document.getElementById("hint");
const fileInput = document.getElementById("file");
const printBtn = document.getElementById("print-btn");
const pdfBtn = document.getElementById("pdf-btn");
const texBtn = document.getElementById("tex-btn");
const statusEl = document.getElementById("status");
const emptySheet = document.getElementById("empty-sheet");
const sheetStack = document.getElementById("sheet-stack");
const seal = document.getElementById("seal");

let images = [];
let lastDrafts = [];

function setStatus(text, bad = false) {
  statusEl.textContent = text || "";
  statusEl.classList.toggle("bad", Boolean(bad));
}

function applyPreset(fillEmptyOnly) {
  const provider = document.getElementById("provider").value;
  const preset = PRESETS[provider] || PRESETS.qwen;
  const modelEl = document.getElementById("model");
  const baseEl = document.getElementById("base-url");
  if (!fillEmptyOnly || !modelEl.value) modelEl.value = preset.model;
  if (!fillEmptyOnly || !baseEl.value) baseEl.value = preset.base;
}

function loadSeal() {
  document.getElementById("provider").value = localStorage.getItem(KEYS.provider) || "qwen";
  document.getElementById("api-key").value = localStorage.getItem(KEYS.key) || "";
  document.getElementById("model").value = localStorage.getItem(KEYS.model) || "";
  document.getElementById("base-url").value = localStorage.getItem(KEYS.base) || "";
  applyPreset(true);
}

function saveSeal() {
  localStorage.setItem(KEYS.provider, document.getElementById("provider").value);
  localStorage.setItem(KEYS.key, document.getElementById("api-key").value.trim());
  localStorage.setItem(KEYS.model, document.getElementById("model").value.trim());
  localStorage.setItem(KEYS.base, document.getElementById("base-url").value.trim());
}

function compressFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1280;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
      URL.revokeObjectURL(url);
      resolve({
        mime: "image/jpeg",
        data: dataUrl.split(",")[1],
        preview: dataUrl,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("照片读不出来"));
    };
    img.src = url;
  });
}

function renderThumbs() {
  thumbs.innerHTML = "";
  hint.classList.toggle("hidden", images.length > 0);
  for (const [i, img] of images.entries()) {
    const el = document.createElement("img");
    el.src = img.preview;
    el.alt = `稿面 ${i + 1}`;
    el.title = "点一下撤下这张";
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      images.splice(i, 1);
      renderThumbs();
    });
    thumbs.appendChild(el);
  }
}

async function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith("image/"));
  for (const file of files) {
    images.push(await compressFile(file));
  }
  renderThumbs();
}

function katexHtml(latex, display = true) {
  try {
    return window.katex.renderToString(normalizeLatex(latex), {
      displayMode: display,
      throwOnError: false,
      trust: false,
      output: "html",
    });
  } catch {
    const span = document.createElement("span");
    span.textContent = latex;
    return span.outerHTML;
  }
}

function mixedToFragment(text) {
  const frag = document.createDocumentFragment();
  const re = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$|\\\((.+?)\\\)/g;
  let last = 0;
  let m;
  const src = String(text || "");
  while ((m = re.exec(src))) {
    if (m.index > last) frag.append(src.slice(last, m.index));
    const latex = m[1] || m[2] || m[3] || m[4];
    const display = Boolean(m[1] || m[2]);
    const wrap = document.createElement(display ? "div" : "span");
    if (display) wrap.className = "math";
    wrap.innerHTML = katexHtml(latex, display);
    frag.append(wrap);
    last = m.index + m[0].length;
  }
  if (last < src.length) frag.append(src.slice(last));
  return frag;
}

function buildSheet(draft) {
  const article = document.createElement("article");
  article.className = "sheet";

  const name = document.getElementById("name").value.trim();
  const sid = document.getElementById("sid").value.trim();
  const courseIn = document.getElementById("course").value.trim();
  const course = courseIn || draft.course || "线性代数";
  const title = draft.title || "作业";

  const head = document.createElement("div");
  head.className = "sheet-head";
  head.append(Object.assign(document.createElement("span"), { textContent: course }));
  head.append(Object.assign(document.createElement("span"), { textContent: title }));
  article.append(head);

  const h = document.createElement("h2");
  h.className = "sheet-title";
  h.textContent = `${course}　${title}`;
  article.append(h);

  if (name || sid) {
    const who = document.createElement("p");
    who.className = "who";
    who.textContent = [name, sid].filter(Boolean).join("　");
    article.append(who);
  }

  for (const problem of draft.problems || []) {
    const box = document.createElement("section");
    box.className = "problem";
    const stem = document.createElement("p");
    if (problem.number) {
      const no = document.createElement("span");
      no.className = "stem-no";
      no.textContent = `${problem.number}.`;
      stem.append(no);
    }
    stem.append(mixedToFragment(problem.stem || ""));
    box.append(stem);

    const lab = document.createElement("div");
    lab.className = "label";
    lab.textContent = "解答";
    box.append(lab);

    for (const step of problem.solution || []) {
      if (step.kind === "math") {
        const div = document.createElement("div");
        div.className = "math";
        div.innerHTML = katexHtml(step.latex || "", true);
        box.append(div);
      } else if (step.kind === "rowops") {
        const row = document.createElement("div");
        row.className = "rowops";
        if (step.from) {
          const from = document.createElement("div");
          from.innerHTML = katexHtml(step.from, true);
          row.append(from);
        }
        const ops = document.createElement("div");
        ops.className = "ops";
        const list = step.ops && step.ops.length ? step.ops : [""];
        for (const op of list) {
          const line = document.createElement("div");
          line.className = "line";
          line.innerHTML = katexHtml(op || "", false);
          ops.append(line);
        }
        const arrow = document.createElement("div");
        arrow.className = "arrow";
        arrow.textContent = "→";
        ops.append(arrow);
        row.append(ops);
        if (step.to) {
          const to = document.createElement("div");
          to.innerHTML = katexHtml(step.to, true);
          row.append(to);
        }
        box.append(row);
      } else {
        const p = document.createElement("p");
        p.append(mixedToFragment(step.text || ""));
        box.append(p);
      }
    }
    article.append(box);
  }

  const foot = document.createElement("div");
  foot.className = "sheet-foot";
  foot.textContent = "第 1 页";
  article.append(foot);
  return article;
}

function renderSheets(drafts) {
  lastDrafts = drafts;
  emptySheet.classList.toggle("hidden", drafts.length > 0);
  sheetStack.replaceChildren();
  for (const draft of drafts) {
    const frame = document.createElement("div");
    frame.className = "sheet-frame";
    frame.append(buildSheet(draft));
    sheetStack.append(frame);
  }
  const ready = drafts.length > 0;
  pdfBtn.disabled = !ready;
  texBtn.disabled = !ready;
  fitSheets();
}

function toTex(draft) {
  const name = document.getElementById("name").value.trim();
  const sid = document.getElementById("sid").value.trim();
  const course = document.getElementById("course").value.trim() || draft.course || "线性代数";
  const title = draft.title || "作业";
  const body = [];
  for (const problem of draft.problems || []) {
    body.push(`\\noindent\\textbf{${problem.number || ""}.}\\quad ${problem.stem || ""}`);
    body.push("");
    body.push("\\noindent\\textbf{解答}");
    body.push("");
    for (const step of problem.solution || []) {
      if (step.kind === "math") {
        body.push("\\[");
        body.push(step.latex || "");
        body.push("\\]");
      } else if (step.kind === "rowops") {
        const ops = (step.ops || []).join("\\\\");
        body.push("\\[");
        if (step.from) body.push(`${step.from}`);
        if (ops) body.push(`\\xrightarrow[${ops}]{}`);
        if (step.to) body.push(step.to);
        body.push("\\]");
      } else {
        body.push(step.text || "");
      }
      body.push("");
    }
  }
  return `% !TEX program = xelatex
\\documentclass[12pt,a4paper]{ctexart}
\\usepackage{amsmath,amssymb,mathtools,array,geometry,fancyhdr}
\\geometry{a4paper,margin=2.2cm}
\\pagestyle{fancy}
\\fancyhf{}
\\lhead{${course}}
\\rhead{${title}}
\\lfoot{${name} ${sid}}
\\rfoot{第\\thepage 页}
\\begin{document}
\\begin{center}
{\\LARGE\\bfseries ${course}\\quad ${title}}\\\\[0.4em]
{\\large ${name}\\quad ${sid}}
\\end{center}
\\vspace{0.8em}
${body.join("\n")}
\\end{document}
`;
}

async function readBody(res) {
  const text = await res.text();
  if (looksLikeHtml(text)) return { html: true, text };
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { text };
  }
}

async function composeViaGemini(key, model, images) {
  const parts = [
    {
      text: COMPOSE_PROMPT,
    },
  ];
  for (const img of images) {
    parts.push({ inline_data: { mime_type: img.mime, data: img.data } });
  }
  const preferred = String(model || "").trim();
  const defaults = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
  const models = [];
  if (preferred && !/gemini-2\./.test(preferred)) models.push(preferred);
  for (const name of defaults) {
    if (!models.includes(name)) models.push(name);
  }
  let lastErr = "排版机没有回稿。";
  for (const m of models) {
    let res;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
          }),
        }
      );
    } catch {
      throw new Error("连不上 Gemini。请确认能打开 Google，或在印鉴里改用校园兼容接口。");
    }
    const body = await readBody(res);
    if (body.html) {
      throw new Error("Gemini 接口被拦截了。可换网络，或在印鉴里改用 OpenAI 兼容网关。");
    }
    const data = body.json;
    if (!data) {
      lastErr = "Gemini 返回了无法识别的内容。";
      continue;
    }
    if (!res.ok) {
      lastErr = data.error?.message || lastErr;
      if (/denied access/i.test(lastErr)) {
        throw new Error("Google 拒绝了当前项目。请打开印鉴，改用通义千问。");
      }
      continue;
    }
    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    return parseDraft(text);
  }
  throw new Error(lastErr);
}

async function postChat(root, key, payload) {
  let res;
  try {
    res = await fetch(`${root}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("连不上该接口。请检查 Base URL，或换一个网络。");
  }
  return { res, body: await readBody(res) };
}

async function composeViaOpenAI(key, baseUrl, model, images) {
  const root = (baseUrl || PRESETS.qwen.base).replace(/\/$/, "");
  const content = [{ type: "text", text: COMPOSE_PROMPT }];
  for (const img of images) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${img.mime || "image/jpeg"};base64,${img.data}` },
    });
  }
  const payload = {
    model: model || PRESETS.qwen.model,
    temperature: 0.1,
    max_tokens: 8192,
    messages: [{ role: "user", content }],
  };
  let { res, body } = await postChat(root, key, {
    ...payload,
    response_format: { type: "json_object" },
  });
  const detail = JSON.stringify(body.json || body.text || "");
  if (!res.ok && /response_format|json_object/i.test(detail)) {
    ({ res, body } = await postChat(root, key, payload));
  }
  if (body.html) {
    throw new Error("接口返回了网页而不是数据。请核对 Base URL。");
  }
  const data = body.json;
  if (!data) throw new Error("接口返回无法识别。");
  if (!res.ok) {
    throw new Error(data.error?.message || data.message || "接口拒绝了这次稿件。");
  }
  const msg = data.choices?.[0]?.message;
  const text = extractMessageText(msg?.content) || extractMessageText(msg?.reasoning_content);
  try {
    return parseDraft(text);
  } catch (err) {
    if (data.choices?.[0]?.finish_reason === "length") {
      throw new Error("稿子太长被截断了。请一次只放一题，或换更清晰的照片。");
    }
    throw err;
  }
}

async function composeOne(batch) {
  const provider = localStorage.getItem(KEYS.provider) || "qwen";
  const key = localStorage.getItem(KEYS.key) || "";
  return provider === "gemini"
    ? composeViaGemini(key, localStorage.getItem(KEYS.model) || "", batch)
    : composeViaOpenAI(
        key,
        localStorage.getItem(KEYS.base) || PRESETS[provider]?.base || PRESETS.qwen.base,
        localStorage.getItem(KEYS.model) || PRESETS[provider]?.model || "",
        batch
      );
}

async function compose() {
  if (!images.length) {
    setStatus("先把照片放到玻璃台上。", true);
    return;
  }
  const key = localStorage.getItem(KEYS.key) || "";
  printBtn.disabled = true;
  setStatus("正在认手写、排铅字…");
  try {
    if (!key) {
      seal.showModal();
      throw new Error("需要印鉴。推荐用通义千问密钥。");
    }
    const drafts = [];
    const errors = [];
    for (let i = 0; i < images.length; i++) {
      setStatus(`正在认第 ${i + 1}/${images.length} 张…`);
      try {
        drafts.push(await composeOne([images[i]]));
      } catch (err) {
        errors.push(`第${i + 1}张：${err.message || "失败"}`);
      }
    }
    if (!drafts.length) throw new Error(errors.join(" ") || "付印失败");
    renderSheets(drafts);
    if (errors.length) {
      setStatus(`出了 ${drafts.length} 份。${errors.join(" ")}`, true);
    } else {
      setStatus(`清样已出 ${drafts.length} 份，可以从出纸口取件。`);
    }
  } catch (err) {
    let msg = err.message || "付印失败";
    if (/Unexpected token|is not valid JSON/i.test(msg)) {
      msg = "浏览器还在用旧页面。请关掉标签，用下面这个地址重新打开：https://pyughub.github.io/qingyang-print/duo.html";
    }
    setStatus(msg, true);
  } finally {
    printBtn.disabled = false;
  }
}

function fitSheets() {
  const frames = sheetStack.querySelectorAll(".sheet-frame");
  for (const frame of frames) {
    const page = frame.querySelector(".sheet");
    if (!page) continue;
    page.style.transform = "none";
    const scale = Math.min(1, frame.clientWidth / page.offsetWidth);
    page.style.transform = `scale(${scale})`;
    frame.style.height = `${Math.ceil(page.offsetHeight * scale)}px`;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sheetToPdf(sheetEl) {
  const prev = sheetEl.style.transform;
  sheetEl.style.transform = "none";
  try {
    const canvas = await window.html2canvas(sheetEl, {
      scale: 2,
      backgroundColor: "#fffaf2",
      useCORS: true,
    });
    const img = canvas.toDataURL("image/jpeg", 0.93);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = 210;
    const pageH = 297;
    const imgH = (pageW * canvas.height) / canvas.width;
    let heightLeft = imgH;
    let position = 0;
    pdf.addImage(img, "JPEG", 0, position, pageW, imgH);
    heightLeft -= pageH;
    while (heightLeft > 0.5) {
      position = heightLeft - imgH;
      pdf.addPage();
      pdf.addImage(img, "JPEG", 0, position, pageW, imgH);
      heightLeft -= pageH;
    }
    return pdf;
  } finally {
    sheetEl.style.transform = prev;
  }
}

async function downloadPdf() {
  if (!lastDrafts.length) return;
  setStatus("正在装订 PDF…");
  const used = [];
  const sheets = [...sheetStack.querySelectorAll(".sheet")];
  try {
    for (let i = 0; i < lastDrafts.length; i++) {
      setStatus(`正在装订第 ${i + 1}/${lastDrafts.length} 份 PDF…`);
      const pdf = await sheetToPdf(sheets[i]);
      pdf.save(uniqueDownloadName(lastDrafts[i].title || `清样${i + 1}`, "pdf", used));
      if (i < lastDrafts.length - 1) await sleep(450);
    }
    setStatus(
      lastDrafts.length === 1
        ? "PDF 已下载。"
        : `已下载 ${lastDrafts.length} 份 PDF。若浏览器拦截，请允许本页下载多个文件。`
    );
  } catch (err) {
    setStatus(err.message || "装订失败", true);
  }
}

async function downloadTex() {
  if (!lastDrafts.length) return;
  const used = [];
  for (let i = 0; i < lastDrafts.length; i++) {
    const blob = new Blob([toTex(lastDrafts[i])], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = uniqueDownloadName(lastDrafts[i].title || `清样${i + 1}`, "tex", used);
    a.click();
    URL.revokeObjectURL(a.href);
    if (i < lastDrafts.length - 1) await sleep(450);
  }
}

glass.addEventListener("click", () => fileInput.click());
glass.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener("change", async (e) => {
  await addFiles(e.target.files);
  fileInput.value = "";
});
["dragenter", "dragover"].forEach((type) => {
  glass.addEventListener(type, (e) => {
    e.preventDefault();
    glass.classList.add("is-hot");
  });
});
["dragleave", "drop"].forEach((type) => {
  glass.addEventListener(type, (e) => {
    e.preventDefault();
    glass.classList.remove("is-hot");
  });
});
glass.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
document.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) addFiles(files);
});

printBtn.addEventListener("click", compose);
pdfBtn.addEventListener("click", downloadPdf);
texBtn.addEventListener("click", downloadTex);
document.getElementById("provider").addEventListener("change", () => applyPreset(false));
document.getElementById("open-seal").addEventListener("click", () => {
  loadSeal();
  seal.showModal();
});
document.getElementById("seal-form").addEventListener("submit", (e) => {
  if (e.submitter && e.submitter.value === "save") saveSeal();
});

loadSeal();
window.addEventListener("resize", fitSheets);
fitSheets();
