# CloudStream Sync Server

Cross-device watch history sync backend for the CloudStream-ffiltus fork.

## Architecture

Uses a **word-list phrase** (BIP39-based, 5 words = ~3.6e16 combinations) as a shared secret to link devices — no accounts, no passwords.

```
Device A ──→ POST /api/sync/<phrase>/<profile> ──→ Upstash KV
Device B ──→ GET  /api/sync/<phrase>/<profile> ───→ Synced history
```

## Deploy

```bash
cd sync-server
npx vercel deploy --prod
```

Requires `KV_REST_API_URL` and `KV_REST_API_TOKEN` env vars (Upstash Redis), or falls back to in-memory storage.

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/generate` | POST | Returns a new 5-word phrase |
| `/api/sync/<phrase>/<profile>` | GET | Get watch history for profile |
| `/api/sync/<phrase>/<profile>` | POST | Sync watch history |
| `/track/<phrase>/<profile>` | GET | Web UI to view history |

## Settings in CloudStream

1. Settings → Accounts → **CloudStream Sync**
2. Enter your tracking phrase (or tap generate to create one)
3. Enter the server URL (default: `https://cloudstream-sync.vercel.app`)
4. Share the same phrase on other devices
