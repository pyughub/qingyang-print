const GEMINI_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    course: { type: "STRING" },
    title: { type: "STRING" },
    problems: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          number: { type: "STRING" },
          stem: { type: "STRING" },
          solution: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                kind: { type: "STRING" },
                text: { type: "STRING" },
                latex: { type: "STRING" },
                from: { type: "STRING" },
                to: { type: "STRING" },
                ops: { type: "ARRAY", items: { type: "STRING" } },
              },
            },
          },
        },
        required: ["stem", "solution"],
      },
    },
  },
  required: ["problems"],
};

const PROMPT = `你是中文理科作业排版员。用户会给你手写解题过程的照片（可能多张、同一道题）。

任务：读懂手写内容，整理成工整印刷体所需的结构化数据。不要发明没写过的步骤；数字、行变换、符号必须与照片一致。若题干被裁掉，根据解答过程补一句简短题干。

solution 数组的 kind 只能是：
- "text"：中文说明，可含 $行内公式$
- "math"：独立公式，latex 字段写不含 $$ 的内容，例如 \\begin{pmatrix}...\\end{pmatrix}
- "rowops"：初等行变换。from / to 是矩阵的 latex（pmatrix 或 array{rrrr}），ops 是箭头上下的操作，例如 ["r_2+(-4)r_1","r_4+(-2)r_1"]

矩阵用 pmatrix 或 \\left(\\begin{array}{rrrr}...\\end{array}\\right)。行变换箭头文字用 latex，如 r_2+(-4)r_1。
course 默认为「线性代数」，title 用「第 n 题」。
只输出 JSON。`;

function json(status, body) {
  return {
    statusCode: status,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((p) => p.text || "").join("");
}

async function callGemini({ key, model, images }) {
  const parts = [{ text: PROMPT }];
  for (const img of images) {
    parts.push({
      inline_data: {
        mime_type: img.mime || "image/jpeg",
        data: img.data,
      },
    });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": key,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
  const raw = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { raw };
  }
  return { ok: res.ok, status: res.status, parsed, raw };
}

async function callOpenAI({ key, baseUrl, model, images }) {
  const content = [{ type: "text", text: PROMPT }];
  for (const img of images) {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${img.mime || "image/jpeg"};base64,${img.data}`,
      },
    });
  }
  const root = (baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${root}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content }],
    }),
  });
  const raw = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { raw };
  }
  return { ok: res.ok, status: res.status, parsed, raw };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "access-control-allow-origin": "*" } };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "只用 POST。" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "请求不是 JSON。" });
  }

  const images = Array.isArray(payload.images) ? payload.images.slice(0, 6) : [];
  if (!images.length) {
    return json(400, { error: "玻璃台上还没有照片。" });
  }
  for (const img of images) {
    if (!img?.data || typeof img.data !== "string") {
      return json(400, { error: "照片数据不完整。" });
    }
  }

  const provider = payload.provider === "openai" ? "openai" : "gemini";
  const headerKey = event.headers["x-print-key"] || event.headers["X-Print-Key"] || "";
  const key =
    headerKey ||
    (provider === "openai" ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY) ||
    "";
  if (!key) {
    return json(401, {
      error: "需要印鉴。在本页填写 Google AI Studio 密钥，或让站长配置 GEMINI_API_KEY。",
      needKey: true,
    });
  }

  try {
    if (provider === "openai") {
      const result = await callOpenAI({
        key,
        baseUrl: payload.baseUrl,
        model: payload.model,
        images,
      });
      if (!result.ok) {
        return json(result.status >= 400 ? result.status : 502, {
          error: "排版接口拒绝了这次稿件。请检查密钥、模型名或 Base URL。",
          detail: (result.parsed && (result.parsed.error?.message || result.parsed.error)) || "",
        });
      }
      const text = result.parsed?.choices?.[0]?.message?.content || "";
      return json(200, { draft: JSON.parse(text) });
    }

    const preferred = payload.model && String(payload.model).trim();
    const models = preferred ? [preferred, ...GEMINI_MODELS.filter((m) => m !== preferred)] : GEMINI_MODELS;
    let last = null;
    for (const model of models) {
      const result = await callGemini({ key, model, images });
      last = result;
      if (result.ok) {
        const text = extractGeminiText(result.parsed);
        return json(200, { draft: JSON.parse(text), model });
      }
      if (result.status !== 404) break;
    }
    const msg =
      last?.parsed?.error?.message ||
      (last?.status === 400 ? "印鉴无效，或照片格式不被接受。" : "排版机没有回稿。");
    return json(last?.status >= 400 ? last.status : 502, { error: msg });
  } catch (err) {
    const message = String(err?.message || err);
    if (message.includes("JSON")) {
      return json(502, { error: "稿面认出来了，但结构不完整。请换一张更清晰、只含一题的照片。" });
    }
    return json(500, { error: "付印中断。请稍后再试，或只拍一题。" });
  }
}
