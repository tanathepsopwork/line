const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(express.json({ verify: rawBodySaver }));

function rawBodySaver(req, res, buf) {
  req.rawBody = buf;
}

const PORT = process.env.PORT || 3000;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

function validateSignature(req) {
  const signature = req.headers["x-line-signature"];
  const hash = crypto
    .createHmac("SHA256", CHANNEL_SECRET)
    .update(req.rawBody)
    .digest("base64");
  return signature === hash;
}

app.get("/", (_, res) => res.send("LINE OA bot is running"));
app.get("/health", (_, res) => res.json({ ok: true }));

app.post("/webhook/line", async (req, res) => {
  try {
    if (!CHANNEL_SECRET || !CHANNEL_ACCESS_TOKEN) {
      return res.status(500).send("Missing LINE env vars");
    }

    if (!validateSignature(req)) {
      return res.status(401).send("Invalid signature");
    }

    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== "message" || event.message.type !== "text") continue;

      const userText = event.message.text;
      const replyToken = event.replyToken;
      const replyText = `รับข้อความแล้ว: ${userText}`;

      await axios.post(
        "https://api.line.me/v2/bot/message/reply",
        {
          replyToken,
          messages: [{ type: "text", text: replyText }],
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
          },
        }
      );
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("Webhook error:", error.response?.data || error.message);
    return res.status(500).send("Internal Server Error");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
