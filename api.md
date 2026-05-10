# CougSpot API Reference

## Cloak AI

Cloak is a public AI API with no authentication required. CougSpot uses it to power the Cloak chat panel.

**Base URL:** `https://api.usecloak.org`

### Endpoints

| Endpoint | Format |
|---|---|
| `POST /v1/chat` | Native (used by CougSpot) |
| `POST /v1/chat/completions` | OpenAI-compatible |
| `POST /v1/messages` | Anthropic-compatible |

### Models

| Model | Description |
|---|---|
| `pneuma` | Default general-purpose model (used by CougSpot) |
| `logos` | Reasoning-focused |
| `kairos` | Fast/lightweight |
| `linus` | Code-focused |

### Native Endpoint (`/v1/chat`)

**Request:**
```json
{
  "model": "pneuma",
  "messages": [
    { "role": "system", "content": "System prompt here." },
    { "role": "user",   "content": "User message here." },
    { "role": "assistant", "content": "Previous reply (for multi-turn)." },
    { "role": "user",   "content": "Follow-up message." }
  ]
}
```

**Response:**
```json
{ "response": "The model's reply text." }
```

### CougSpot Integration (`app.js`)

| Constant | Value |
|---|---|
| `CLOAK_API` | `https://api.usecloak.org/v1/chat` |
| `CLOAK_MODEL` | `pneuma` |
| `CLOAK_SYSTEM` | Norco High School assistant system prompt |

The `sendChatMessage()` function builds the full `messages` array from `chatHistory` + `CLOAK_SYSTEM` and posts to `CLOAK_API`. The response is read from `json.response`.

---

## Supabase Edge Function: `cloak-chat`

A server-side proxy to `api.usecloak.org/v1/chat` (native endpoint), deployed to Supabase project `dqcyecscdelfikbimnpw`. Available as a fallback or for server-side callers; the frontend calls Cloak directly.

**URL:** `https://dqcyecscdelfikbimnpw.supabase.co/functions/v1/cloak-chat`

**File:** `supabase/functions/cloak-chat/index.ts`

**Auth:** `verify_jwt: false` (no Authorization header required)

**Request:** same native format as the direct Cloak API
```json
{
  "model": "pneuma",
  "messages": [
    { "role": "system", "content": "System prompt." },
    { "role": "user", "content": "User message." }
  ]
}
```

**Response:**
```json
{ "response": "The model's reply text." }
```

**Deploy:**
```bash
supabase functions deploy cloak-chat --project-ref dqcyecscdelfikbimnpw
```

No secrets or API keys required — Cloak is a public API.
