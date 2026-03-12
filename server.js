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
const FAQ_PATH = path.join(__dirname, "data", "faq.json");
const TICKETS_PATH = path.join(__dirname, "tickets.jsonl");
const AUTO_REPLY_THRESHOLD = 0.75;

let FAQS = [];

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

app.get("/", (_, res) => res.send("LINE OA bot is running"));
app.get("/health", (_, res) => res.json({ ok: true, faqCount: FAQS.length }));

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

      const { best, confidence } = findBestAnswer(userText);

      if (best && confidence >= AUTO_REPLY_THRESHOLD) {
        const message = `${best.answer}\n\n(ความมั่นใจ: ${confidence})`;
        await replyToLine(replyToken, message);
        console.log(`AUTO_REPLY user=${userId} confidence=${confidence} faq=${best.id}`);
      } else {
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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
