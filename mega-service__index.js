import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Storage } from 'megajs';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '12mb' }));
const PORT = Number(process.env.PORT || 8788);
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || '';
const MEGA_EMAIL = process.env.MEGA_EMAIL || '';
const MEGA_PASSWORD = process.env.MEGA_PASSWORD || '';
const SYNC_PASSCODE = process.env.SYNC_PASSCODE || '';
const sessions = new Map();
let storagePromise;
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

const send = (res, status, data) => res.status(status).set('Cache-Control', 'no-store').set('X-Content-Type-Options', 'nosniff').json(data);
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
function serviceAuth(req, res, next) {
  if (!SERVICE_TOKEN || !safeEqual(req.get('x-service-token') || '', SERVICE_TOKEN)) return send(res, 401, { error: 'Unauthorized service request.' });
  next();
}
async function getStorage() {
  if (!MEGA_EMAIL || !MEGA_PASSWORD) throw new Error('MEGA_EMAIL and MEGA_PASSWORD are not configured on the private service.');
  if (!storagePromise) {
    storagePromise = new Storage({ email: MEGA_EMAIL, password: MEGA_PASSWORD, userAgent: 'LocalForgeAI/1.0' }).ready;
  }
  try { return await storagePromise; }
  catch (error) { storagePromise = undefined; throw error; }
}
function requireSession(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const expires = sessions.get(token);
  if (!token || !expires || expires < Date.now()) {
    if (token) sessions.delete(token);
    return send(res, 401, { error: 'Your MEGA session expired. Unlock sync again.' });
  }
  next();
}
function safeFileName(name) {
  return String(name || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 180);
}

app.use('/api/storage/mega', serviceAuth);
app.get('/api/storage/mega', (_req, res) => {
  const configured = Boolean(MEGA_EMAIL && MEGA_PASSWORD);
  const accountHint = configured ? `${MEGA_EMAIL.slice(0, 2)}***@${MEGA_EMAIL.split('@')[1] || '***'}` : null;
  return send(res, 200, { configured, accountHint, lockConfigured: Boolean(SYNC_PASSCODE), lockMode: SYNC_PASSCODE ? 'passcode' : 'unconfigured' });
});
app.post('/api/storage/mega', async (req, res) => {
  const { action } = req.body || {};
  if (action === 'unlock') {
    if (!SYNC_PASSCODE) return send(res, 503, { error: 'Set SYNC_PASSCODE on the private MEGA service first.' });
    if (!safeEqual(req.body?.passcode || '', SYNC_PASSCODE)) return send(res, 401, { error: 'Incorrect sync passcode.' });
    try {
      await getStorage();
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, Date.now() + SESSION_TTL_MS);
      return send(res, 200, { token, expiresIn: SESSION_TTL_MS / 1000 });
    } catch (error) {
      return send(res, 502, { error: error instanceof Error ? error.message : 'Could not sign in to MEGA.' });
    }
  }
  return send(res, 400, { error: 'Unsupported MEGA action.' });
});

app.post('/api/storage/mega/backup', requireSession, async (req, res) => {
  try {
    const payload = req.body?.payload;
    if (!payload || !Array.isArray(payload.threads) || !Array.isArray(payload.documents)) return send(res, 400, { error: 'Invalid LocalForge backup payload.' });
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, 'utf8') > 10 * 1024 * 1024) return send(res, 413, { error: 'Backup exceeds the 10 MB limit.' });
    const storage = await getStorage();
    let folder = storage.root.children.find(item => item.directory && item.name === 'LocalForge Backups');
    if (!folder) folder = await storage.root.mkdir('LocalForge Backups');
    const fileName = `localforge-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const uploaded = await folder.upload(fileName, Buffer.from(serialized, 'utf8')).complete;
    return send(res, 200, { ok: true, fileName, bytes: Buffer.byteLength(serialized, 'utf8'), nodeId: uploaded.nodeId });
  } catch (error) {
    return send(res, 502, { error: error instanceof Error ? error.message : 'MEGA backup failed.' });
  }
});

app.post('/api/storage/mega/restore', requireSession, async (_req, res) => {
  try {
    const storage = await getStorage();
    const folder = storage.root.children.find(item => item.directory && item.name === 'LocalForge Backups');
    if (!folder) return send(res, 404, { error: 'No LocalForge Backups folder exists in this MEGA account yet.' });
    const backups = (folder.children || []).filter(item => !item.directory && /^localforge-backup-.*\.json$/i.test(item.name)).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (!backups.length) return send(res, 404, { error: 'No LocalForge backup files were found.' });
    const data = await backups[0].downloadBuffer();
    const payload = JSON.parse(data.toString('utf8'));
    if (!payload || !Array.isArray(payload.threads) || !Array.isArray(payload.documents)) return send(res, 422, { error: 'The newest backup file has an invalid format.' });
    return send(res, 200, { ok: true, payload });
  } catch (error) {
    return send(res, 502, { error: error instanceof Error ? error.message : 'MEGA restore failed.' });
  }
});

app.get('/api/storage/mega/files', requireSession, async (req, res) => {
  try {
    const storage = await getStorage();
    const folderId = req.query.folder;
    const folder = !folderId || folderId === 'root' ? storage.root : storage.files[String(folderId)];
    if (!folder || !folder.directory) return send(res, 404, { error: 'MEGA folder not found.' });
    const files = (folder.children || []).slice(0, 200).map(item => ({
      id: item.nodeId,
      name: item.name,
      size: Number(item.size || 0),
      directory: Boolean(item.directory),
      modifiedAt: item.timestamp ? item.timestamp * 1000 : null,
      textReadable: /\.(txt|md|markdown|csv|json|html|htm|xml|js|jsx|ts|tsx|css|py|java|c|cpp|h|sql|yaml|yml|log)$/i.test(item.name || ''),
    }));
    return send(res, 200, { folder: folder.name || 'Cloud Drive', parentId: folder.parent?.nodeId || 'root', files });
  } catch (error) {
    return send(res, 502, { error: error instanceof Error ? error.message : 'Could not list MEGA files.' });
  }
});

app.get('/api/storage/mega/files/:id', requireSession, async (req, res) => {
  try {
    const storage = await getStorage();
    const file = storage.files[String(req.params.id)];
    if (!file || file.directory) return send(res, 404, { error: 'MEGA file not found.' });
    if (Number(file.size || 0) > MAX_IMPORT_BYTES) return send(res, 413, { error: 'This file is larger than the 10 MB import limit.' });
    const data = await file.downloadBuffer();
    if (data.length > MAX_IMPORT_BYTES) return send(res, 413, { error: 'This file is larger than the 10 MB import limit.' });
    return send(res, 200, { name: safeFileName(file.name), size: data.length, contentBase64: data.toString('base64') });
  } catch (error) {
    return send(res, 502, { error: error instanceof Error ? error.message : 'Could not download MEGA file.' });
  }
});

app.get('/health', (_req, res) => send(res, 200, { status: 'ok', service: 'localforge-mega' }));
app.listen(PORT, '0.0.0.0', () => console.log(`LocalForge MEGA service listening on ${PORT}`));
