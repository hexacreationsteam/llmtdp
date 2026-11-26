# LocalForge MEGA service

This private Node.js service provides the MEGA account connection that cannot run inside a Cloudflare Worker. It uses `megajs` (an unofficial community SDK; review MEGA's terms before use).

## Deploy privately

1. Create a private service on Railway or Render from this folder (or deploy the repository with the service root set to `mega-service`).
2. Set `MEGA_EMAIL`, `MEGA_PASSWORD`, `SYNC_PASSCODE`, and `SERVICE_TOKEN` in the service's private environment settings. The `.env.example` file intentionally leaves these values blank for you to fill in privately. Use a newly changed MEGA password, not a password posted in chat.
3. Generate `SERVICE_TOKEN` with a secure random generator. Use the exact same value as a Cloudflare Worker secret named `MEGA_SERVICE_TOKEN`.
4. Set Cloudflare Worker secret `MEGA_SERVICE_URL` to the service's HTTPS origin, without a trailing API path.
5. Deploy the Worker again. Keep the Node service private where your host supports private networking; otherwise it is protected by the long service token and should be restricted to HTTPS.

## Local test

```bash
npm install
cp .env.example .env
# Fill the values in .env locally; never commit it.
npm start
```

The Cloudflare Worker proxies `/api/storage/mega` requests to this service. The browser never receives the MEGA account password or the service token. The UI's separate sync passcode unlocks a short-lived in-memory session (30 minutes).

## Features

- Workspace backup to `LocalForge Backups/` in MEGA.
- Restore from the newest JSON backup in that folder.
- Browse one MEGA folder at a time and import files up to 10 MB into LocalForge's local knowledge base.

MEGA does not provide a standard API key for this `megajs` account-login integration. It uses your MEGA email and password, stored only in the private service environment. Do not add an invented `MEGA_API_KEY` variable; it will not authenticate. The MEGAJS library is unofficial. It is not an official MEGA SDK. Confirm that your use complies with MEGA's terms.
