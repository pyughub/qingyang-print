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
  if (draft) return draft;
  throw new Error("认出来了，但结果损坏。请再点一次付印。");
}
