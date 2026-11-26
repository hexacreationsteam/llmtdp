import { useMemo, useState } from 'react';
import { MessageSquare, Moon, Search, Sun, Trash2, X } from 'lucide-react';
import type {
  AppView,
  ChatThread,
  MegaStatusResponse,
  RuntimeStatusResponse,
} from '../types/llm';
import { getModelLabel } from '../utils/modelCatalog';

interface SidebarProps {
  activeView: AppView;
  threads: ChatThread[];
  activeThreadId: string;
  forgeName: string;
  theme: 'dark' | 'light';
  runtimeStatus: RuntimeStatusResponse | null;
  megaStatus: MegaStatusResponse | null;
  mobileOpen: boolean;
  onSelectView: (view: AppView) => void;
  onCloseMobile: () => void;
  onSelectThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onToggleTheme: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function Sidebar({
  activeView,
  threads,
  activeThreadId,
  forgeName,
  theme,
  runtimeStatus,
  megaStatus,
  mobileOpen,
  onSelectView,
  onCloseMobile,
  onSelectThread,
  onDeleteThread,
  onToggleTheme,
}: SidebarProps) {
  const [query, setQuery] = useState('');

  const filteredThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!q) return sorted;
    return sorted.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.messages.some((m) => m.content.toLowerCase().includes(q)),
    );
  }, [threads, query]);

  const directKeysCount = runtimeStatus
    ? [
        runtimeStatus.providers.gemini,
        runtimeStatus.providers.openai,
        runtimeStatus.providers.xai,
      ].filter(Boolean).length
    : 0;

  const content = (
    <aside
      aria-label="Conversations and local runtime"
      className="flex h-full w-64 flex-col border-r border-slate-200 bg-slate-100/70 dark:border-slate-800 dark:bg-[#0E1219]"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-3.5 py-3 md:hidden dark:border-slate-800">
        <span className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
          Workspace
        </span>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close sidebar"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav aria-label="Mobile navigation" className="grid grid-cols-2 gap-1.5 border-b border-slate-200 p-3 md:hidden dark:border-slate-800">
        {(['chat', 'arena', 'scene', 'voice', 'own-ai', 'knowledge'] as AppView[]).map((viewId) => {
          const label =
            viewId === 'chat'
              ? 'Chat'
              : viewId === 'arena'
                ? 'Arena'
                : viewId === 'scene'
                  ? '3D Studio'
                  : viewId === 'voice'
                    ? 'Voice'
                    : viewId === 'own-ai'
                      ? 'Own AI'
                      : 'Knowledge';
          const selected = activeView === viewId;
          return (
            <button
              key={viewId}
              type="button"
              onClick={() => {
                onSelectView(viewId);
                onCloseMobile();
              }}
              className={`rounded-md px-2.5 py-2 text-xs font-medium text-left transition-colors ${
                selected
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-700 hover:bg-slate-200/70 dark:bg-[#141923] dark:text-slate-300'
              }`}
            >
              {label}
            </button>
          );
        })}
      </nav>

      <div className="p-3">
        <label htmlFor="thread-search-input" className="sr-only">
          Search conversations
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id="thread-search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter threads..."
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-[#141923] dark:text-slate-100"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <div className="px-2 pb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
          Recent Threads ({filteredThreads.length})
        </div>

        {filteredThreads.length === 0 ? (
          <p className="px-2 py-4 text-xs text-slate-500 dark:text-slate-400">
            No matching conversations.
          </p>
        ) : (
          <ul className="space-y-1">
            {filteredThreads.map((thread) => {
              const isSelected = thread.id === activeThreadId;
              return (
                <li key={thread.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectThread(thread.id);
                      onCloseMobile();
                    }}
                    className={`flex min-w-0 flex-1 flex-col items-start rounded-lg px-2.5 py-2 text-left transition-colors ${
                      isSelected
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-[#19202D] dark:text-slate-50'
                        : 'text-slate-700 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex w-full items-center gap-2">
                      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="truncate text-sm font-medium">{thread.title}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 pl-5 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="truncate">
                        {getModelLabel(thread.activeModelId, forgeName)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums shrink-0">
                        {formatRelativeTime(thread.updatedAt)}
                      </span>
                    </div>
                  </button>

                  {threads.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onDeleteThread(thread.id)}
                      aria-label={`Delete '${thread.title}'`}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 opacity-0 transition-opacity hover:bg-slate-200 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-slate-800 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-slate-200 p-3 dark:border-slate-800">
        <div className="mb-2.5 space-y-1 text-xs text-slate-600 dark:text-slate-400">
          <div className="flex items-center justify-between">
            <span>Unified Engine</span>
            <span className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-200">
              {runtimeStatus?.unifiedAvailable ? 'Ready' : 'Checking'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Local Ollama</span>
            <span className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-200">
              {runtimeStatus?.ollama.connected
                ? `${runtimeStatus.ollama.models.length} models`
                : 'Offline'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Direct Keys</span>
            <span className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-200">
              {directKeysCount}/3 active
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>MEGA Storage</span>
            <button
              type="button"
              onClick={() => {
                onSelectView('knowledge');
                onCloseMobile();
              }}
              className="font-mono tabular-nums font-medium text-slate-900 underline-offset-2 hover:underline dark:text-slate-200"
            >
              {megaStatus?.configured ? 'Ready' : 'Standby'}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          className="flex h-9 w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-[#141923] dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <span>{theme === 'dark' ? 'Dark Mode' : 'Light Mode'}</span>
          {theme === 'dark' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
        </button>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden h-full md:block shrink-0">{content}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            onClick={onCloseMobile}
            className="fixed inset-0 bg-black/50"
            aria-hidden="true"
          />
          <div className="relative z-50 h-full">{content}</div>
        </div>
      )}
    </>
  );
}
