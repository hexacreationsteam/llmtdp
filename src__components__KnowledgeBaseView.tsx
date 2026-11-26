import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CloudDownload, CloudUpload, FileUp, Lock, Plus, Search, Trash2 } from 'lucide-react';
import type {
  ChatThread,
  MegaFileEntry,
  ForgeConfig,
  LocalDocument,
  MegaStatusResponse,
} from '../types/llm';
import {
  chunkDocument,
  estimateTokenCount,
  getKnowledgeStats,
  searchLocalKnowledge,
} from '../utils/localRag';

interface KnowledgeBaseViewProps {
  documents: LocalDocument[];
  threads: ChatThread[];
  forgeConfig: ForgeConfig;
  megaStatus?: MegaStatusResponse | null;
  onAddDocument: (doc: { title: string; content: string }) => void;
  onToggleDocument: (id: string) => void;
  onDeleteDocument: (id: string) => void;
  onRestoreWorkspace: (data: {
    threads: ChatThread[];
    documents: LocalDocument[];
    forgeConfig: ForgeConfig;
  }) => void;
}

export function KnowledgeBaseView({
  documents,
  threads,
  forgeConfig,
  megaStatus: initialMegaStatus = null,
  onAddDocument,
  onToggleDocument,
  onDeleteDocument,
  onRestoreWorkspace,
}: KnowledgeBaseViewProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [formError, setFormError] = useState('');
  const [testQuery, setTestQuery] = useState('');

  // MEGA cloud sync state (sync token held strictly in memory)
  const [megaStatus, setMegaStatus] = useState<MegaStatusResponse | null>(initialMegaStatus);
  const [passcode, setPasscode] = useState('');
  const [syncToken, setSyncToken] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncError, setSyncError] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const [megaFiles, setMegaFiles] = useState<MegaFileEntry[]>([]);
  const [megaFolder, setMegaFolder] = useState('root');
  const [megaFolderName, setMegaFolderName] = useState('Cloud Drive');

  useEffect(() => {
    if (initialMegaStatus) setMegaStatus(initialMegaStatus);
  }, [initialMegaStatus]);

  useEffect(() => {
    fetch('/api/storage/mega')
      .then((res) => (res.ok ? res.json() : null))
      .then((megaData: MegaStatusResponse | null) => {
        if (megaData) setMegaStatus(megaData);
      })
      .catch(() => {
        // Ignore offline status check
      });
  }, []);

  const handleUnlockSync = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim() || syncBusy) return;
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage('');
    try {
      const res = await fetch('/api/storage/mega', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlock', passcode }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setSyncError(data.error || 'Could not unlock MEGA Cloud Sync.');
      } else {
        setSyncToken(data.token);
        setPasscode('');
        setSyncMessage('Cloud sync unlocked for this session.');
      }
    } catch {
      setSyncError('Network error while unlocking MEGA Cloud Sync.');
    } finally {
      setSyncBusy(false);
    }
  };

  const handleMegaBackup = async () => {
    if (!syncToken || syncBusy) return;
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage('');
    try {
      const res = await fetch('/api/storage/mega/backup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${syncToken}`,
        },
        body: JSON.stringify({ payload: {
          version: 1,
          exportedAt: Date.now(),
          threads,
          documents,
          forgeConfig,
        } }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        fileName?: string;
        bytes?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setSyncError(data.error || 'MEGA backup failed.');
      } else {
        setSyncMessage(
          `Backed up to MEGA: ${data.fileName ?? 'workspace'} (${data.bytes ?? 0} bytes).`,
        );
      }
    } catch {
      setSyncError('Network error while backing up to MEGA.');
    } finally {
      setSyncBusy(false);
    }
  };

  const handleMegaRestore = async () => {
    if (!syncToken || syncBusy) return;
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage('');
    try {
      const res = await fetch('/api/storage/mega/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${syncToken}`,
        },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        payload?: {
          threads: ChatThread[];
          documents: LocalDocument[];
          forgeConfig: ForgeConfig;
        };
        error?: string;
      };
      if (!res.ok || !data.ok || !data.payload) {
        setSyncError(data.error || 'MEGA restore failed.');
      } else {
        onRestoreWorkspace(data.payload);
        setSyncMessage(
          `Restored ${data.payload.documents.length} docs and ${data.payload.threads.length} threads from MEGA.`,
        );
      }
    } catch {
      setSyncError('Network error while restoring from MEGA.');
    } finally {
      setSyncBusy(false);
    }
  };

  const handleBrowseMega = async (folderId = 'root') => {
    if (!syncToken || syncBusy) return;
    setSyncBusy(true); setSyncError(''); setSyncMessage('');
    try {
      const res = await fetch(`/api/storage/mega/files?folder=${encodeURIComponent(folderId)}`, {
        headers: { Authorization: `Bearer ${syncToken}` },
      });
      const data = await res.json() as { files?: MegaFileEntry[]; folder?: string; error?: string };
      if (!res.ok) throw new Error(data.error || 'Could not browse MEGA files.');
      setMegaFiles(data.files || []); setMegaFolder(folderId); setMegaFolderName(data.folder || 'Cloud Drive');
      setSyncMessage(`Loaded ${data.files?.length || 0} items from ${data.folder || 'MEGA'}.`);
    } catch (error) { setSyncError(error instanceof Error ? error.message : 'MEGA browsing failed.'); }
    finally { setSyncBusy(false); }
  };

  const handleImportMegaFile = async (file: MegaFileEntry) => {
    if (!syncToken || syncBusy || file.directory) return;
    setSyncBusy(true); setSyncError(''); setSyncMessage('');
    try {
      const res = await fetch(`/api/storage/mega/files/${encodeURIComponent(file.id)}`, {
        headers: { Authorization: `Bearer ${syncToken}` },
      });
      const data = await res.json() as { name?: string; contentBase64?: string; error?: string };
      if (!res.ok || !data.contentBase64) throw new Error(data.error || 'Could not import this MEGA file.');
      const binary = atob(data.contentBase64);
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      const textContent = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      const printable = textContent.replace(/\u0000/g, '').trim();
      if (!printable) throw new Error('This file does not contain readable text for the knowledge base.');
      onAddDocument({ title: data.name || file.name, content: printable.slice(0, 1_000_000) });
      setSyncMessage(`Imported ${data.name || file.name} into the local knowledge base.`);
    } catch (error) { setSyncError(error instanceof Error ? error.message : 'MEGA import failed.'); }
    finally { setSyncBusy(false); }
  };

  const stats = useMemo(() => getKnowledgeStats(documents), [documents]);

  const retrievalPreview = useMemo(() => {
    if (!testQuery.trim()) return [];
    return searchLocalKnowledge(testQuery, documents, 4);
  }, [testQuery, documents]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    const cleanContent = content.trim();
    if (!cleanTitle || !cleanContent) {
      setFormError('Both document title and content are required.');
      return;
    }
    setFormError('');
    onAddDocument({ title: cleanTitle, content: cleanContent });
    setTitle('');
    setContent('');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (!text.trim()) {
        setFormError('Uploaded file is empty.');
        return;
      }
      setFormError('');
      onAddDocument({
        title: file.name,
        content: text.slice(0, 60_000),
      });
    } catch {
      setFormError('Could not read the selected file.');
    } finally {
      e.target.value = '';
    }
  };

  const barColorClass =
    stats.status === 'critical'
      ? 'bg-red-600 dark:bg-red-500'
      : stats.status === 'warning'
        ? 'bg-amber-600 dark:bg-amber-500'
        : 'bg-blue-600 dark:bg-blue-500';

  const statusLabel =
    stats.status === 'critical'
      ? 'Near or over limit'
      : stats.status === 'warning'
        ? 'Approaching limit'
        : 'Nominal';

  const statusTextClass =
    stats.status === 'critical'
      ? 'text-red-600 dark:text-red-400'
      : stats.status === 'warning'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-emerald-600 dark:text-emerald-400';

  const visualBarWidth =
    stats.totalTokens > 0 ? Math.max(2, stats.usagePercent) : 0;

  return (
    <div className="h-full overflow-y-auto px-4 py-6 md:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="space-y-4 border-b border-slate-200 pb-5 dark:border-slate-800">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
                Local Knowledge Base
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Documents stay in your browser and are indexed on-device with BM25 for Forge AI and RAG-enabled chats.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-5 text-xs text-slate-600 dark:text-slate-400">
              <div>
                <span>Total Indexed </span>
                <span
                  data-testid="kb-total-docs"
                  className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100"
                >
                  {stats.totalDocs} {stats.totalDocs === 1 ? 'doc' : 'docs'}
                </span>
              </div>
              <div>
                <span>Active </span>
                <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {stats.enabledDocs}/{stats.totalDocs}
                </span>
              </div>
              <div>
                <span>Chunks </span>
                <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {stats.totalChunks}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-[#121721]">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  RAG Memory Capacity
                </span>
                <span aria-hidden="true" className="text-slate-400">
                  ·
                </span>
                <span className={`inline-flex items-center gap-1 font-medium ${statusTextClass}`}>
                  {stats.status !== 'nominal' && <AlertTriangle className="h-3.5 w-3.5" />}
                  <span>{statusLabel}</span>
                </span>
              </div>

              <div className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                <span data-testid="kb-total-tokens" className="font-semibold text-slate-900 dark:text-slate-100">
                  {stats.totalTokens.toLocaleString()}
                </span>
                <span> / {stats.tokenLimit.toLocaleString()} tokens</span>
                <span className="mx-1.5" aria-hidden="true">
                  ·
                </span>
                <span>{stats.usagePercent}%</span>
                {stats.activeTokens !== stats.totalTokens && (
                  <>
                    <span className="mx-1.5" aria-hidden="true">
                      ·
                    </span>
                    <span>{stats.activeTokens.toLocaleString()} active</span>
                  </>
                )}
              </div>
            </div>

            <div
              role="progressbar"
              aria-label="RAG memory token usage"
              aria-valuenow={stats.totalTokens}
              aria-valuemin={0}
              aria-valuemax={stats.tokenLimit}
              className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-[#1A2130]"
            >
              <div
                style={{ width: `${visualBarWidth}%` }}
                className={`h-full rounded-full transition-all duration-200 ${barColorClass}`}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: Add Local Document */}
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-5 dark:border-slate-800 dark:bg-[#121721]"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Add Local Document
              </h2>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                <FileUp className="h-3.5 w-3.5" />
                <span>Import File</span>
                <input
                  type="file"
                  accept=".txt,.md,.json,.ts,.tsx,.js,.py,.csv"
                  onChange={handleFileUpload}
                  className="sr-only"
                />
              </label>
            </div>

            <div>
              <label
                htmlFor="kb-doc-title"
                className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Document Title
              </label>
              <input
                id="kb-doc-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Product Roadmap Q4"
                className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-[#0D1118] dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="kb-doc-content"
                className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Content
              </label>
              <textarea
                id="kb-doc-content"
                rows={6}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Paste notes, specifications, or code snippets to index locally..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-[#0D1118] dark:text-slate-100"
              />
            </div>

            {formError && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {formError}
              </p>
            )}

            <button
              type="submit"
              className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              <span>Index Document Locally</span>
            </button>
          </form>

          {/* Right: Live BM25 Tester & Indexed Document List */}
          <div className="space-y-5 lg:col-span-7">
            <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#121721]">
              <label
                htmlFor="kb-retrieval-query"
                className="mb-2 block font-display text-sm font-semibold text-slate-900 dark:text-slate-100"
              >
                Test Local BM25 Retrieval
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="kb-retrieval-query"
                  type="search"
                  value={testQuery}
                  onChange={(e) => setTestQuery(e.target.value)}
                  placeholder="Type a test question to inspect ranked local chunks..."
                  className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-[#0D1118] dark:text-slate-100"
                />
              </div>

              {testQuery.trim() && (
                <div className="mt-3 space-y-2">
                  {retrievalPreview.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      No matching enabled chunks found for that query.
                    </p>
                  ) : (
                    retrievalPreview.map((hit) => (
                      <div
                        key={`${hit.docId}-${hit.chunkIndex}`}
                        className="rounded-lg bg-slate-100/80 p-3 text-xs dark:bg-[#0D1118]"
                      >
                        <div className="mb-1 flex items-center justify-between font-medium text-slate-900 dark:text-slate-100">
                          <span>{hit.docTitle}</span>
                          <span className="font-mono tabular-nums text-blue-600 dark:text-blue-400">
                            BM25 {hit.score}
                          </span>
                        </div>
                        <p className="text-slate-600 dark:text-slate-400">{hit.text}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#121721]">
              <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Indexed Documents ({documents.length})
                </h2>
              </div>

              {documents.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  No local documents indexed yet. Add a note or import a file on the left.
                </div>
              ) : (
                <ul className="divide-y divide-slate-200 dark:divide-slate-800" data-testid="kb-doc-list">
                  {documents.map((doc) => {
                    const chunks = chunkDocument(doc).length;
                    const tokens = estimateTokenCount(doc.content);
                    return (
                      <li key={doc.id} className="flex items-start justify-between gap-4 px-5 py-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-3">
                            <input
                              id={`toggle-doc-${doc.id}`}
                              type="checkbox"
                              checked={doc.enabled}
                              onChange={() => onToggleDocument(doc.id)}
                              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            <label
                              htmlFor={`toggle-doc-${doc.id}`}
                              className="truncate font-display text-sm font-medium text-slate-900 dark:text-slate-100"
                            >
                              {doc.title}
                            </label>
                          </div>
                          <p className="mt-1 line-clamp-2 pl-7 text-xs text-slate-600 dark:text-slate-400">
                            {doc.content}
                          </p>
                          <div className="mt-1.5 flex items-center gap-2 pl-7 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                            <span>
                              {chunks} {chunks === 1 ? 'chunk' : 'chunks'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{tokens} tokens</span>
                            <span aria-hidden="true">·</span>
                            <span>{doc.enabled ? 'Enabled' : 'Paused'}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => onDeleteDocument(doc.id)}
                          aria-label={`Delete '${doc.title}'`}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800 dark:hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#121721]">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    MEGA Cloud Storage Sync
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {megaStatus?.configured
                      ? `Server-connected account: ${megaStatus.accountHint}`
                      : 'Configure MEGA_EMAIL, MEGA_PASSWORD, and SYNC_PASSCODE in server environment variables to enable cloud backup.'}
                  </p>
                </div>
                <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {megaStatus?.configured ? 'Configured' : 'Standby'}
                </span>
              </div>

              {megaStatus?.configured && megaStatus.lockConfigured && !syncToken && (
                <form onSubmit={handleUnlockSync} className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <label htmlFor="mega-sync-passcode" className="sr-only">
                      {megaStatus.lockMode === 'passcode'
                        ? 'Sync Passcode'
                        : 'MEGA Password Verification'}
                    </label>
                    <input
                      id="mega-sync-passcode"
                      type="password"
                      value={passcode}
                      onChange={(e) => setPasscode(e.target.value)}
                      placeholder={
                        megaStatus.lockMode === 'passcode'
                          ? 'Enter server SYNC_PASSCODE to unlock...'
                          : 'Enter your MEGA password to unlock cloud sync...'
                      }
                      className="h-9 min-w-[200px] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-[#0D1118] dark:text-slate-100"
                    />
                    <button
                      type="submit"
                      disabled={syncBusy || !passcode.trim()}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-45 dark:bg-slate-200 dark:text-slate-900"
                    >
                      <Lock className="h-3.5 w-3.5" />
                      <span>Unlock Sync</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Verified server-side against your saved secret and held in memory for this session only.
                  </p>
                </form>
              )}

              {syncToken && megaStatus?.configured && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleMegaBackup}
                    disabled={syncBusy}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-45"
                  >
                    <CloudUpload className="h-3.5 w-3.5" />
                    <span>Backup to MEGA</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleMegaRestore}
                    disabled={syncBusy}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-45 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <CloudDownload className="h-3.5 w-3.5" />
                    <span>Restore from MEGA</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBrowseMega('root')}
                    disabled={syncBusy}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-45 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Search className="h-3.5 w-3.5" />
                    <span>Browse MEGA files</span>
                  </button>
                </div>
              )}

              {syncToken && megaFiles.length > 0 && (
                <div className="mt-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{megaFolderName}</p>
                    {megaFolder !== 'root' && <button type="button" onClick={() => handleBrowseMega('root')} className="text-xs text-blue-600">Back to Cloud Drive</button>}
                  </div>
                  <ul className="max-h-56 space-y-1 overflow-auto">
                    {megaFiles.map(file => (
                      <li key={file.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                        <button type="button" onClick={() => file.directory && handleBrowseMega(file.id)} disabled={!file.directory || syncBusy} className="min-w-0 truncate text-left text-xs text-slate-700 disabled:cursor-default dark:text-slate-200">
                          {file.directory ? '📁 ' : '📄 '}{file.name}
                        </button>
                        {!file.directory && <button type="button" onClick={() => handleImportMegaFile(file)} disabled={syncBusy || file.size > 10 * 1024 * 1024 || !file.textReadable} title={!file.textReadable ? 'Only text-based files can be imported into the knowledge base' : undefined} className="shrink-0 text-xs font-medium text-blue-600 disabled:opacity-40">{file.textReadable ? 'Import' : 'Not text'}</button>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {syncMessage && (
                <p className="mt-2.5 text-xs text-emerald-600 dark:text-emerald-400">
                  {syncMessage}
                </p>
              )}
              {syncError && (
                <p role="alert" className="mt-2.5 text-xs text-red-600 dark:text-red-400">
                  {syncError}
                </p>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
