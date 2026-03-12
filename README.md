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

## Deploy (Render)
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Set env vars:
  - `LINE_CHANNEL_SECRET`
  - `LINE_CHANNEL_ACCESS_TOKEN`

Webhook URL example:
`https://your-service.onrender.com/webhook/line`
