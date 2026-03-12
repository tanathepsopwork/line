# LINE OA Support Bot (MVP)

## Run locally

1. Install dependencies
```bash
npm install
```
2. Create `.env` from `.env.example`
3. Start server
```bash
npm start
```

## Endpoints
- `GET /health`
- `POST /webhook/line`

## Behavior (MVP RAG-lite)
- อ่านฐานความรู้จาก `data/faq.json`
- ถ้าความมั่นใจ >= 0.75 จะตอบอัตโนมัติ
- ถ้าความมั่นใจ < 0.75 จะสร้าง ticket ลง `tickets.jsonl` และแจ้งลูกค้าว่าส่งต่อเจ้าหน้าที่แล้ว

## Deploy (Render)
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Set env vars:
  - `LINE_CHANNEL_SECRET`
  - `LINE_CHANNEL_ACCESS_TOKEN`

Webhook URL example:
`https://your-service.onrender.com/webhook/line`
