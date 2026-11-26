import { useCallback, useEffect, useState } from 'react';
import { ArenaView } from './components/ArenaView';
import { ChatView } from './components/ChatView';
import { KnowledgeBaseView } from './components/KnowledgeBaseView';
import { LiveVoiceView } from './components/LiveVoiceView';
import { OwnAiStudio } from './components/OwnAiStudio';
import { OfflineBanner } from './components/PWAControls';
import { SceneStudioView } from './components/SceneStudioView';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import type {
  AppView,
  ChatThread,
  ForgeConfig,
  LocalDocument,
  MegaStatusResponse,
  RuntimeStatusResponse,
} from './types/llm';
import {
  probeBrowserOllama,
  setServerOllamaModels,
} from './utils/browserOllama';
import {
  loadDocuments,
  loadForgeConfig,
  loadTheme,
  loadThreads,
  saveDocuments,
  saveForgeConfig,
  saveTheme,
  saveThreads,
} from './utils/storage';

function createFreshThread(forgeConfig: ForgeConfig): ChatThread {
  return {
    id: `thread-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: 'New Conversation',
    activeModelId: 'forge',
    reasoningDepth: forgeConfig.reasoningDepth,
    messages: [],
    updatedAt: Date.now(),
  };
}

export default function App() {
  const [forgeConfig, setForgeConfig] = useState<ForgeConfig>(() => loadForgeConfig());
  const [threads, setThreads] = useState<ChatThread[]>(() => {
    const saved = loadThreads();
    if (saved.length === 1 && saved[0].id === 'seed-thread-1') {
      return [createFreshThread(loadForgeConfig()), ...saved];
    }
    return saved;
  });
  const [activeThreadId, setActiveThreadId] = useState<string>(() => {
    const saved = loadThreads();
    if (saved.length === 1 && saved[0].id === 'seed-thread-1') {
      return '';
    }
    const sorted = [...saved].sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted[0]?.id ?? '';
  });

  const [documents, setDocuments] = useState<LocalDocument[]>(() => loadDocuments());
  const [theme, setTheme] = useState<'dark' | 'light'>(() => loadTheme());
  const [activeView, setActiveView] = useState<AppView>('chat');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatusResponse | null>(null);
  const [megaStatus, setMegaStatus] = useState<MegaStatusResponse | null>(null);

  // Ensure activeThreadId always points to a valid thread
  const effectiveThread =
    threads.find((t) => t.id === activeThreadId) ?? threads[0];

  useEffect(() => {
    if (effectiveThread && effectiveThread.id !== activeThreadId) {
      setActiveThreadId(effectiveThread.id);
    }
  }, [effectiveThread, activeThreadId]);

  useEffect(() => {
    saveThreads(threads);
  }, [threads]);

  useEffect(() => {
    saveDocuments(documents);
  }, [documents]);

  useEffect(() => {
    saveForgeConfig(forgeConfig);
  }, [forgeConfig]);

  useEffect(() => {
    saveTheme(theme);
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  const fetchRuntimeStatus = useCallback(async (forceBrowserProbe = false) => {
    try {
      const [modelsRes, megaRes] = await Promise.all([
        fetch('/api/models/status'),
        fetch('/api/storage/mega'),
      ]);
      if (modelsRes.ok) {
        const data = (await modelsRes.json()) as RuntimeStatusResponse;
        setServerOllamaModels(data.ollama.connected ? data.ollama.models : []);

        if (!data.ollama.connected || forceBrowserProbe) {
          const browserOllama = await probeBrowserOllama();
          if (browserOllama.connected) {
            const mergedModels = Array.from(
              new Set([
                ...(data.ollama.connected ? data.ollama.models : []),
                ...browserOllama.models,
              ]),
            );
            setRuntimeStatus({
              ...data,
              ollama: {
                connected: true,
                url: data.ollama.connected ? data.ollama.url : browserOllama.url,
                models: mergedModels,
              },
            });
          } else {
            setRuntimeStatus(data);
          }
        } else {
          setRuntimeStatus(data);
        }
      }
      if (megaRes.ok) {
        const megaData = (await megaRes.json()) as MegaStatusResponse;
        setMegaStatus(megaData);
      }
    } catch {
      // Keep previous runtime status if offline
    }
  }, []);

  useEffect(() => {
    fetchRuntimeStatus();
  }, [fetchRuntimeStatus]);

  const handleNewChat = () => {
    const next = createFreshThread(forgeConfig);
    setThreads((prev) => [next, ...prev]);
    setActiveThreadId(next.id);
    setActiveView('chat');
    setMobileSidebarOpen(false);
  };

  const handleSelectThread = (threadId: string) => {
    setActiveThreadId(threadId);
    setActiveView('chat');
  };

  const handleDeleteThread = (threadId: string) => {
    setThreads((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((t) => t.id !== threadId);
      if (threadId === effectiveThread?.id && next[0]) {
        setActiveThreadId(next[0].id);
      }
      return next;
    });
  };

  const handleUpdateThread = useCallback(
    (updater: (prev: ChatThread) => ChatThread) => {
      if (!effectiveThread) return;
      const targetId = effectiveThread.id;
      setThreads((prev) =>
        prev.map((t) => (t.id === targetId ? updater(t) : t)),
      );
    },
    [effectiveThread],
  );

  const handleAddDocument = (doc: { title: string; content: string }) => {
    const newDoc: LocalDocument = {
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: doc.title,
      content: doc.content,
      enabled: true,
      updatedAt: Date.now(),
    };
    setDocuments((prev) => [newDoc, ...prev]);
  };

  const handleToggleDocument = (id: string) => {
    setDocuments((prev) =>
      prev.map((d) => (d.id === id ? { ...d, enabled: !d.enabled } : d)),
    );
  };

  const handleDeleteDocument = (id: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-[#0B0E14] dark:text-slate-100">
      <TopBar
        activeView={activeView}
        onSelectView={setActiveView}
        onNewChat={handleNewChat}
        onToggleMobileSidebar={() => setMobileSidebarOpen((v) => !v)}
      />

      <OfflineBanner />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          activeView={activeView}
          threads={threads}
          activeThreadId={effectiveThread?.id ?? ''}
          forgeName={forgeConfig.name}
          theme={theme}
          runtimeStatus={runtimeStatus}
          megaStatus={megaStatus}
          mobileOpen={mobileSidebarOpen}
          onSelectView={setActiveView}
          onCloseMobile={() => setMobileSidebarOpen(false)}
          onSelectThread={handleSelectThread}
          onDeleteThread={handleDeleteThread}
          onToggleTheme={() =>
            setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
          }
        />

        <main className="min-w-0 flex-1 overflow-hidden">
          {activeView === 'chat' && effectiveThread && (
            <ChatView
              thread={effectiveThread}
              forgeConfig={forgeConfig}
              documents={documents}
              runtimeStatus={runtimeStatus}
              onUpdateThread={handleUpdateThread}
              onOpenKnowledge={() => setActiveView('knowledge')}
            />
          )}

          {activeView === 'arena' && (
            <ArenaView
              forgeConfig={forgeConfig}
              documents={documents}
              runtimeStatus={runtimeStatus}
            />
          )}

          {activeView === 'scene' && <SceneStudioView />}

          {activeView === 'voice' && (
            <LiveVoiceView forgeConfig={forgeConfig} documents={documents} />
          )}

          {activeView === 'own-ai' && (
            <OwnAiStudio
              config={forgeConfig}
              runtimeStatus={runtimeStatus}
              onSaveConfig={setForgeConfig}
              onRefreshRuntime={() => fetchRuntimeStatus(true)}
            />
          )}

          {activeView === 'knowledge' && (
            <KnowledgeBaseView
              documents={documents}
              threads={threads}
              forgeConfig={forgeConfig}
              megaStatus={megaStatus}
              onAddDocument={handleAddDocument}
              onToggleDocument={handleToggleDocument}
              onDeleteDocument={handleDeleteDocument}
              onRestoreWorkspace={(restored) => {
                if (Array.isArray(restored.threads) && restored.threads.length > 0) {
                  setThreads(restored.threads);
                  setActiveThreadId(restored.threads[0].id);
                }
                if (Array.isArray(restored.documents)) {
                  setDocuments(restored.documents);
                }
                if (restored.forgeConfig) {
                  setForgeConfig(restored.forgeConfig);
                }
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
