export function uniqueDownloadName(title, ext, used) {
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

export function looksLikeHtml(text) {
  const s = String(text || "").trimStart().slice(0, 16).toLowerCase();
  return s.startsWith("<!doctype") || s.startsWith("<html");
}

export function extractMessageText(content) {
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
      if ((n === "n" || n === "r" || n === "t") && !/[A-Za-z]/.test(src[i + 2] || "")) {
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
  return /\\\\[A-Za-z]/.test(s);
}

function restoreBareCommands(t) {
  return String(t || "")
    .replace(/\bfor\s+all\b/gi, "\\forall")
    .replace(/(^|[^\\A-Za-z])(forall|exists)(?![A-Za-z])/g, "$1\\$2");
}

export function repairMathText(s) {
  let t = String(s || "");
  const blocks = [];
  const stash = (inner) => {
    blocks.push(inner);
    return `\u0001${blocks.length - 1}\u0001`;
  };
  t = t.replace(/\$\$([\s\S]*?)\$\$/g, (_, inner) => stash(inner));
  if (t.includes("$$")) t += "$$";
  t = t.replace(/\$\$([\s\S]*?)\$\$/g, (_, inner) => stash(inner));
  if ((t.match(/\$/g) || []).length % 2) t += "$";
  if (!/\$|\u0001/.test(t) && /\\(frac|cdot|left|right|times|sum|int|prod|sqrt|mathrm|mathbf|begin|overline)/.test(t)) {
    const i = t.search(/\\(frac|cdot|left|right|times|sum|int|prod|sqrt|mathrm|mathbf|begin|overline)/);
    t = `${t.slice(0, i)}$${t.slice(i)}$`;
  }
  return t.replace(/\u0001(\d+)\u0001/g, (_, i) => `$$${blocks[Number(i)]}$$`);
}

function dropSpuriousBreaks(t) {
  return String(t || "")
    .replace(/\\n(?![A-Za-z])/g, "")
    .replace(/\\r(?![A-Za-z])/g, "")
    .replace(/\s*\n+\s*/g, " ")
    .trim();
}

function normalizeMixed(s) {
  let t = String(s || "");
  for (let i = 0; i < 3 && looksOverEscaped(t); i++) {
    t = t.replace(/\\\\/g, "\\");
  }
  return repairMathText(restoreBareCommands(dropSpuriousBreaks(t)));
}

export function normalizeLatex(s) {
  let t = String(s || "").trim();
  t = t.replace(/^\$+|\$+$/g, "").trim();
  for (let i = 0; i < 3 && looksOverEscaped(t); i++) {
    t = t.replace(/\\\\/g, "\\");
  }
  return restoreBareCommands(dropSpuriousBreaks(t));
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
    if (typeof step.text === "string") step.text = normalizeMixed(step.text);
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
  if (typeof draft.stem === "string") draft.stem = normalizeMixed(draft.stem);
  for (const problem of draft.problems || []) {
    if (typeof problem.stem === "string") problem.stem = normalizeMixed(problem.stem);
    problem.solution = tidySolution(problem.solution);
  }
  return draft;
}

export function parseDraft(text) {
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
