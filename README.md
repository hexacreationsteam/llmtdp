# LocalForge AI — Cloudflare Edition

LocalForge AI v3 keeps the existing React/Vite interface and browser-local workspace while moving cloud inference behind a Cloudflare Worker.

## What changed

- Cloudflare Worker API gateway replaces the Express/Node API runtime.
- Server-side provider secrets for Gemini, OpenAI, xAI and Anthropic.
- SSE streaming for Gemini, OpenAI-compatible providers and Anthropic.
- Provider selection follows the existing UI model IDs: `gemini`, `forge`, `gpt`, `grok`, `claude`.
- If a selected provider key is missing, the Worker uses Gemini when configured.
- If a non-Gemini provider rejects a request before streaming, Gemini is tried once.
- Input-size and message-count validation, same-origin API checks, no-store API responses.
- Existing React UI, browser Ollama, IndexedDB/local RAG, PWA and offline speech fallback are retained.

## Requirements

- Node.js 20.19+ (or a current supported LTS)
- npm
- A Cloudflare account
- API keys from the AI providers you intend to use

## Local setup

```bash
npm install
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` and add the provider keys you own. Do not put keys in `src/`, `VITE_*` variables, HTML, or client-side local storage.

Run the full app locally (Vite frontend + Cloudflare Worker runtime):

```bash
npm run dev
```

The Cloudflare Vite plugin runs the Worker in the local development environment and reads `.dev.vars`. For a production-like build:

```bash
npm run build
npx wrangler dev
```

## Deploy to Cloudflare Workers

This project uses the official Cloudflare Vite plugin, Workers Static Assets, an SPA fallback and Worker-first `/api/*` routes.

1. Authenticate:

   ```bash
   npx wrangler login
   ```

2. Add the provider keys as encrypted Worker secrets:

   ```bash
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put OPENAI_API_KEY
   npx wrangler secret put XAI_API_KEY
   npx wrangler secret put ANTHROPIC_API_KEY
   ```

   Only add the keys for providers you plan to use. Wrangler prompts for each value.

3. Optional model overrides are regular Worker variables. Add them in the Cloudflare dashboard under **Workers & Pages → localforge-ai → Settings → Variables and Secrets**, or edit the `vars` section in `wrangler.jsonc`:

   - `GEMINI_MODEL` (default `gemini-2.5-flash`)
   - `OPENAI_MODEL` (default `gpt-4o`)
   - `XAI_MODEL` (default `grok-3-mini`)
   - `ANTHROPIC_MODEL` (default `claude-sonnet-4-5`)

4. Build and deploy:

   ```bash
   npm run deploy
   ```

5. Open the `https://localforge-ai.<your-subdomain>.workers.dev` URL printed by Wrangler.

For a custom domain, attach it to the Worker from the Cloudflare dashboard.

## Cloudflare dashboard deployment

If using Workers Builds with GitHub:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Root directory: `/`
- Add the provider keys as Worker secrets in the dashboard, not as frontend build variables.

## Provider routing

| UI selection | Provider | Secret |
|---|---|---|
| Forge / Gemini | Google Gemini | `GEMINI_API_KEY` |
| GPT | OpenAI | `OPENAI_API_KEY` |
| Grok | xAI | `XAI_API_KEY` |
| Claude | Anthropic | `ANTHROPIC_API_KEY` |

The Worker returns only boolean provider availability in `/api/models/status`; it never returns secret values.

## Important feature notes

- **Conversations and Knowledge Base:** remain in browser storage (IndexedDB/localStorage), as in the original project. They are not automatically synced across devices.
- **Ollama:** continues to run from the user's browser/device when reachable. A hosted Cloudflare Worker cannot access `localhost` on the user's computer.
- **Live Voice:** the original Node WebSocket bridge is not deployed in this Worker edition. The existing UI falls back to browser speech/offline mode.
- **MEGA sync:** the Node-specific MEGA integration is not included in this Cloudflare edition. Local workspace storage remains available. A future Cloudflare R2 integration can replace it.
- **Search grounding:** Gemini requests can use Google Search grounding. Other providers do not automatically gain web search.
- **Model names:** defaults are configurable Worker variables. Change them to model IDs enabled for your provider account.

## Production safety checklist

- Keep all keys in Worker Secrets. Never commit `.dev.vars`.
- Set provider-side usage budgets and alerts.
- Configure Cloudflare WAF/rate limiting for `/api/chat/stream` before sharing the public URL. This endpoint can incur provider charges.
- Review provider terms and privacy settings before sending personal or sensitive data.
- Use a custom domain and enable Cloudflare security controls if this is a public app.

## Health checks

- `GET /api/health`
- `GET /api/models/status`
- `POST /api/chat/stream` (Server-Sent Events)



## MEGA backup + file browsing (additional private service)

The Cloudflare Worker cannot run the Node-only MEGA client. This project includes `mega-service/`, a separate Node.js service using the community `megajs` SDK. Deploy that folder as a private Railway/Render service and enter the blank fields from `mega-service/.env.example` in the service's private environment settings. MEGA does not provide a standard API key for this integration: it uses your MEGA email and password. Never paste credentials into source files or commit `.env`.

Set the Worker secrets `MEGA_SERVICE_URL` (the service HTTPS origin) and `MEGA_SERVICE_TOKEN` (same random value as `SERVICE_TOKEN` on the Node service). Blank placeholders are provided in `.dev.vars.example`; fill them locally or use Cloudflare secrets for production. The existing Knowledge Base screen supports workspace backup, restore, browsing MEGA folders, and importing text-readable files up to 10 MB. Sessions expire after 30 minutes.

Detailed setup: `mega-service/README.md`. The MEGAJS package is unofficial; check MEGA's terms before use.
