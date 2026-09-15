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

const COMPOSE_PROMPT =
  "你是中文理科作业排版员。把照片中的手写解题过程整理成 JSON。solution 的 kind 只能是 text、math、rowops。矩阵用 pmatrix。只输出 JSON。";

const glass = document.getElementById("glass");
const thumbs = document.getElementById("thumbs");
const hint = document.getElementById("hint");
const fileInput = document.getElementById("file");
const printBtn = document.getElementById("print-btn");
const pdfBtn = document.getElementById("pdf-btn");
const texBtn = document.getElementById("tex-btn");
const statusEl = document.getElementById("status");
const sheetBody = document.getElementById("sheet-body");
const emptySheet = document.getElementById("empty-sheet");
const sheet = document.getElementById("sheet");
const seal = document.getElementById("seal");

let images = [];
let lastDraft = null;

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
    return katex.renderToString(latex, {
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

function renderSheet(draft) {
  lastDraft = draft;
  emptySheet.classList.add("hidden");
  sheetBody.classList.remove("hidden");
  sheetBody.replaceChildren();

  const name = document.getElementById("name").value.trim();
  const sid = document.getElementById("sid").value.trim();
  const courseIn = document.getElementById("course").value.trim();
  const course = courseIn || draft.course || "线性代数";
  const title = draft.title || "作业";

  const head = document.createElement("div");
  head.className = "sheet-head";
  head.append(Object.assign(document.createElement("span"), { textContent: course }));
  head.append(Object.assign(document.createElement("span"), { textContent: title }));
  sheetBody.append(head);

  const h = document.createElement("h2");
  h.className = "sheet-title";
  h.textContent = `${course}　${title}`;
  sheetBody.append(h);

  if (name || sid) {
    const who = document.createElement("p");
    who.className = "who";
    who.textContent = [name, sid].filter(Boolean).join("　");
    sheetBody.append(who);
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
    sheetBody.append(box);
  }

  const foot = document.createElement("div");
  foot.className = "sheet-foot";
  foot.textContent = "第 1 页";
  sheetBody.append(foot);

  pdfBtn.disabled = false;
  texBtn.disabled = false;
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

function looksLikeHtml(text) {
  const s = String(text || "").trimStart().slice(0, 16).toLowerCase();
  return s.startsWith("<!doctype") || s.startsWith("<html");
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

function parseDraft(text) {
  const trimmed = String(text || "").trim();
  if (looksLikeHtml(trimmed)) {
    throw new Error("排版接口返回了网页。请关掉这一页，重新打开后再付印。");
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fence ? fence[1] : trimmed;
  const start = src.indexOf("{");
  const end = src.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("没有认出可排版的结构。请换一张更清晰、只含一题的照片。");
  }
  try {
    return JSON.parse(src.slice(start, end + 1));
  } catch {
    throw new Error("认出来了，但结果损坏。请再点一次付印。");
  }
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
  let res;
  try {
    res = await fetch(`${root}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: model || PRESETS.qwen.model,
        temperature: 0.1,
        messages: [{ role: "user", content }],
      }),
    });
  } catch {
    throw new Error("连不上该接口。请检查 Base URL，或换一个网络。");
  }
  const body = await readBody(res);
  if (body.html) {
    throw new Error("接口返回了网页而不是数据。请核对 Base URL。");
  }
  const data = body.json;
  if (!data) throw new Error("接口返回无法识别。");
  if (!res.ok) {
    throw new Error(data.error?.message || data.message || "接口拒绝了这次稿件。");
  }
  const text = data.choices?.[0]?.message?.content || "";
  return parseDraft(text);
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
    const provider = localStorage.getItem(KEYS.provider) || "qwen";
    const draft =
      provider === "gemini"
        ? await composeViaGemini(key, localStorage.getItem(KEYS.model) || "", images)
        : await composeViaOpenAI(
            key,
            localStorage.getItem(KEYS.base) || PRESETS[provider]?.base || PRESETS.qwen.base,
            localStorage.getItem(KEYS.model) || PRESETS[provider]?.model || "",
            images
          );
    renderSheet(draft);
    fitSheet();
    setStatus("清样已出，可以从出纸口取件。");
  } catch (err) {
    let msg = err.message || "付印失败";
    if (/Unexpected token|is not valid JSON/i.test(msg)) {
      msg = "浏览器还在用旧页面。请关掉标签，用下面这个地址重新打开：https://pyughub.github.io/qingyang-print/";
    }
    setStatus(msg, true);
  } finally {
    printBtn.disabled = false;
  }
}

function fitSheet() {
  const frame = document.getElementById("sheet-frame");
  const well = document.querySelector(".paper-well");
  if (!frame || !well) return;
  sheet.style.transform = "none";
  const scale = Math.min(1, frame.clientWidth / sheet.offsetWidth);
  sheet.style.transform = `scale(${scale})`;
  frame.style.height = `${Math.ceil(sheet.offsetHeight * scale)}px`;
}

async function downloadPdf() {
  if (!lastDraft) return;
  setStatus("正在装订 PDF…");
  const prev = sheet.style.transform;
  try {
    sheet.style.transform = "none";
    const canvas = await html2canvas(sheet, {
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
    const title = (lastDraft.title || "qingyang").replace(/\s+/g, "");
    pdf.save(`${title}.pdf`);
    setStatus("PDF 已下载。");
  } catch (err) {
    setStatus(err.message || "装订失败", true);
  } finally {
    sheet.style.transform = prev;
  }
}

function downloadTex() {
  if (!lastDraft) return;
  const blob = new Blob([toTex(lastDraft)], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "hw.tex";
  a.click();
  URL.revokeObjectURL(a.href);
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
window.addEventListener("resize", fitSheet);
fitSheet();
