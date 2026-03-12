const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ verify: rawBodySaver }));

function rawBodySaver(req, res, buf) {
  req.rawBody = buf;
}

const PORT = process.env.PORT || 3000;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
const FAQ_PATH = path.join(__dirname, "data", "faq.json");
const CATALOG_PATH = path.join(__dirname, "data", "catalog.txt");
const TICKETS_PATH = path.join(__dirname, "tickets.jsonl");
const AUTO_REPLY_THRESHOLD = 0.75;

let FAQS = [];
let CATALOG_LINES = [];

function loadFaqs() {
  try {
    const raw = fs.readFileSync(FAQ_PATH, "utf8");
    FAQS = JSON.parse(raw);
    console.log(`Loaded FAQ entries: ${FAQS.length}`);
  } catch (err) {
    console.error("Failed to load FAQ:", err.message);
    FAQS = [];
  }
}

function loadCatalog() {
  try {
    const raw = fs.readFileSync(CATALOG_PATH, "utf8");
    CATALOG_LINES = raw
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    console.log(`Loaded catalog lines: ${CATALOG_LINES.length}`);
  } catch (err) {
    console.error("Failed to load catalog:", err.message);
    CATALOG_LINES = [];
  }
}

function validateSignature(req) {
  const signature = req.headers["x-line-signature"];
  const hash = crypto
    .createHmac("SHA256", CHANNEL_SECRET)
    .update(req.rawBody)
    .digest("base64");
  return signature === hash;
}

function normalizeText(text = "") {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function scoreFaqMatch(userText, faq) {
  const normalized = normalizeText(userText);
  if (!normalized) return 0;

  let hit = 0;
  for (const keyword of faq.keywords || []) {
    const k = normalizeText(keyword);
    if (k && normalized.includes(k)) hit += 1;
  }

  if (hit === 0) return 0;
  return Math.min(1, hit / Math.max(2, (faq.keywords || []).length * 0.4));
}

function findBestAnswer(userText) {
  let best = null;
  let bestScore = 0;

  for (const faq of FAQS) {
    const score = scoreFaqMatch(userText, faq);
    if (score > bestScore) {
      bestScore = score;
      best = faq;
    }
  }

  return {
    best,
    confidence: Number(bestScore.toFixed(2)),
  };
}

function tokenize(text = "") {
  return normalizeText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function retrieveCatalogAnswer(userText) {
  const qTokens = tokenize(userText);
  if (!qTokens.length || !CATALOG_LINES.length) {
    return { answer: null, confidence: 0 };
  }

  const scored = CATALOG_LINES.map((line) => {
    const lineNorm = normalizeText(line);
    let hit = 0;
    for (const t of qTokens) {
      if (lineNorm.includes(t)) hit += 1;
    }
    const score = hit / Math.max(2, qTokens.length);
    return { line, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (!scored.length) return { answer: null, confidence: 0 };

  const confidence = Number(Math.min(1, scored[0].score).toFixed(2));
  const answer = scored.map((x) => `- ${x.line}`).join("\n");
  return { answer, confidence };
}

function createTicket({ userId, question, confidence }) {
  const ticket = {
    ticket_id: `T${Date.now()}`,
    user_id: userId,
    question,
    ai_summary: "ไม่พบคำตอบที่มั่นใจจากฐานความรู้อัตโนมัติ",
    confidence,
    status: "open",
    created_at: new Date().toISOString(),
  };

  fs.appendFileSync(TICKETS_PATH, `${JSON.stringify(ticket)}\n`, "utf8");
  return ticket;
}

async function replyToLine(replyToken, text) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages: [{ type: "text", text }],
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      },
    }
  );
}

async function generateWithOpenRouter(userText, contextText) {
  if (!OPENROUTER_API_KEY) return null;

  const payload = {
    model: OPENROUTER_MODEL,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "คุณคือผู้ช่วยตอบลูกค้าเกี่ยวกับคอร์สฝึกอบรม ให้ตอบสั้น กระชับ สุภาพ และยึดเฉพาะข้อมูลที่ให้มาเท่านั้น ถ้าข้อมูลไม่พอให้ตอบว่า 'ขอส่งต่อเจ้าหน้าที่เพื่อตรวจสอบข้อมูลเพิ่มเติม'",
      },
      {
        role: "user",
        content: `คำถามลูกค้า: ${userText}\n\nข้อมูลอ้างอิง:\n${contextText}`,
      },
    ],
  };

  const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", payload, {
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/tanathepsopwork/line",
      "X-Title": "line-oa-support-bot",
    },
    timeout: 30000,
  });

  return response.data?.choices?.[0]?.message?.content?.trim() || null;
}

app.get("/", (_, res) => res.send("LINE OA bot is running"));
app.get("/health", (_, res) => res.json({ ok: true, faqCount: FAQS.length, catalogLineCount: CATALOG_LINES.length, openrouter: !!OPENROUTER_API_KEY, model: OPENROUTER_MODEL }));

app.post("/webhook/line", async (req, res) => {
  try {
    if (!CHANNEL_SECRET || !CHANNEL_ACCESS_TOKEN) {
      return res.status(500).send("Missing LINE env vars");
    }

    if (!validateSignature(req)) {
      console.error("Invalid signature");
      return res.status(401).send("Invalid signature");
    }

    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== "message" || event.message.type !== "text") continue;

      const userText = event.message.text;
      const replyToken = event.replyToken;
      const userId = event.source?.userId || "unknown";

      const { best, confidence: faqConfidence } = findBestAnswer(userText);
      const { answer: catalogAnswer, confidence: catalogConfidence } = retrieveCatalogAnswer(userText);

      const useFaq = best && faqConfidence >= AUTO_REPLY_THRESHOLD;
      const useCatalog = !useFaq && catalogAnswer && catalogConfidence >= 0.5;

      if (useFaq || useCatalog) {
        const confidence = Math.max(faqConfidence || 0, catalogConfidence || 0);
        const contextParts = [];
        if (best?.answer) contextParts.push(`FAQ: ${best.answer}`);
        if (catalogAnswer) contextParts.push(`CATALOG:\n${catalogAnswer}`);

        let finalMessage = best?.answer || catalogAnswer;

        if (OPENROUTER_API_KEY) {
          try {
            const aiMessage = await generateWithOpenRouter(userText, contextParts.join("\n\n"));
            if (aiMessage) finalMessage = aiMessage;
            console.log(`AUTO_REPLY_OPENROUTER user=${userId} confidence=${confidence} model=${OPENROUTER_MODEL}`);
          } catch (err) {
            console.error("OpenRouter error:", err.response?.data || err.message);
          }
        }

        await replyToLine(replyToken, `${finalMessage}\n\n(ความมั่นใจ: ${confidence})`);
      } else {
        const confidence = Math.max(faqConfidence || 0, catalogConfidence || 0);
        const ticket = createTicket({ userId, question: userText, confidence });
        const message = `ขอบคุณสำหรับคำถามครับ ตอนนี้กำลังส่งต่อเจ้าหน้าที่ดูแลให้เรียบร้อยแล้ว\nเลขที่คำขอ: ${ticket.ticket_id}`;
        await replyToLine(replyToken, message);
        console.log(`TICKET_CREATED user=${userId} ticket=${ticket.ticket_id} confidence=${confidence}`);
      }
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("Webhook error:", error.response?.data || error.message);
    return res.status(500).send("Internal Server Error");
  }
});

loadFaqs();
loadCatalog();
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
