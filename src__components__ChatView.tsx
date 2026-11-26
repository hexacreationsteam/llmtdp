import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  BookOpen,
  Check,
  Copy,
  Database,
  Globe,
  RefreshCw,
  Square,
} from 'lucide-react';
import type {
  ChatMessage,
  ChatThread,
  ForgeConfig,
  LocalDocument,
  ModelId,
  ReasoningDepth,
  RetrievedChunk,
  RuntimeStatusResponse,
} from '../types/llm';
import { estimateTokenCount, searchLocalKnowledge } from '../utils/localRag';
import {
  buildSystemInstruction,
  CORE_MODELS,
  getModelLabel,
  getModelVendor,
} from '../utils/modelCatalog';
import { streamChatCompletion } from '../utils/streamClient';
import { MarkdownRenderer } from './MarkdownRenderer';

interface ChatViewProps {
  thread: ChatThread;
  forgeConfig: ForgeConfig;
  documents: LocalDocument[];
  runtimeStatus: RuntimeStatusResponse | null;
  onUpdateThread: (updater: (prev: ChatThread) => ChatThread) => void;
  onOpenKnowledge: () => void;
}

const STARTER_PROMPTS = [
  {
    title: 'First-principles architecture',
    prompt:
      'From first principles, compare SQLite vs PostgreSQL for a local-first desktop app that must stay usable offline and sync later. Call out failure modes.',
  },
  {
    title: 'Query your local knowledge',
    prompt:
      'Using only my enabled local documents, summarize the architecture and engineering standards. Cite each source by title.',
  },
  {
    title: 'Clean TypeScript under constraints',
    prompt:
      'Write a zero-dependency TypeScript token-bucket rate limiter with unit tests. Keep it under 80 lines of production code.',
  },
  {
    title: 'Truth-seeking critique',
    prompt:
      'Steel-man both microservices and a modular monolith for a 4-person team. Then give a clear recommendation with the risks of being wrong.',
  },
];

const DEPTH_OPTIONS: Array<{ id: ReasoningDepth; label: string }> = [
  { id: 'fast', label: 'Fast' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'deep', label: 'Deep' },
];

export function ChatView({
  thread,
  forgeConfig,
  documents,
  runtimeStatus,
  onUpdateThread,
  onOpenKnowledge,
}: ChatViewProps) {
  const [input, setInput] = useState('');
  const [useLocalRag, setUseLocalRag] = useState(true);
  const [useSearchGrounding, setUseSearchGrounding] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const activeDocCount = useMemo(
    () => documents.filter((d) => d.enabled && d.content.trim().length > 0).length,
    [documents],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread.messages.length, isStreaming]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleSelectModel = (modelId: ModelId) => {
    onUpdateThread((prev) => ({
      ...prev,
      activeModelId: modelId,
    }));
  };

  const handleSelectDepth = (depth: ReasoningDepth) => {
    onUpdateThread((prev) => ({
      ...prev,
      reasoningDepth: depth,
    }));
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  };

  const submitPrompt = async (rawPrompt: string) => {
    const prompt = rawPrompt.trim();
    if (!prompt || isStreaming) return;

    const activeModel = thread.activeModelId;
    const effectiveModelId: ModelId =
      activeModel === 'forge' && forgeConfig.preferredBackend.startsWith('ollama:')
        ? (forgeConfig.preferredBackend as ModelId)
        : activeModel;

    const modelLabel = getModelLabel(activeModel, forgeConfig.name);
    const shouldRetrieve = useLocalRag && (activeModel === 'forge' || activeDocCount > 0);
    const citations: RetrievedChunk[] = shouldRetrieve
      ? searchLocalKnowledge(prompt, documents, 3)
      : [];

    const systemInstruction = buildSystemInstruction(
      activeModel,
      forgeConfig,
      citations,
    );

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-u`,
      role: 'user',
      content: prompt,
      modelId: activeModel,
      modelLabel,
      createdAt: Date.now(),
    };

    const assistantId = `msg-${Date.now()}-a`;
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      modelId: activeModel,
      modelLabel,
      citations: citations.length > 0 ? citations : undefined,
      createdAt: Date.now(),
    };

    const historyForApi = [
      ...thread.messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: prompt },
    ];

    const isFirstMessage = thread.messages.length === 0;
    const nextTitle = isFirstMessage
      ? prompt.slice(0, 44) + (prompt.length > 44 ? '…' : '')
      : thread.title;

    onUpdateThread((prev) => ({
      ...prev,
      title: nextTitle,
      updatedAt: Date.now(),
      messages: [...prev.messages, userMsg, assistantMsg],
    }));

    setInput('');
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    let accumulated = '';

    try {
      await streamChatCompletion(
        {
          modelId: effectiveModelId,
          messages: historyForApi,
          systemInstruction,
          reasoningDepth: thread.reasoningDepth,
          useSearchGrounding:
            useSearchGrounding && !effectiveModelId.startsWith('ollama:'),
          documents,
          forgeName: forgeConfig.name,
        },
        {
          onMeta: (meta) => {
            onUpdateThread((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === assistantId
                  ? { ...m, runtime: meta.runtime, notice: meta.notice }
                  : m,
              ),
            }));
          },
          onDelta: (delta) => {
            accumulated += delta;
            onUpdateThread((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: accumulated,
                      estimatedTokens: estimateTokenCount(accumulated),
                    }
                  : m,
              ),
            }));
          },
          onSources: (webSources) => {
            onUpdateThread((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === assistantId ? { ...m, webSources } : m,
              ),
            }));
          },
          onDone: (info) => {
            onUpdateThread((prev) => ({
              ...prev,
              updatedAt: Date.now(),
              messages: prev.messages.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      latencyMs: info.latencyMs,
                      estimatedTokens: estimateTokenCount(accumulated),
                    }
                  : m,
              ),
            }));
          },
          onError: (errMsg) => {
            onUpdateThread((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === assistantId ? { ...m, error: errMsg } : m,
              ),
            }));
          },
        },
        controller.signal,
      );
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        const message =
          err instanceof Error ? err.message : 'Streaming connection interrupted.';
        onUpdateThread((prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === assistantId ? { ...m, error: message } : m,
          ),
        }));
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  };

  const handleCopyMessage = async (msg: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedId(msg.id);
      setTimeout(() => setCopiedId(null), 1600);
    } catch {
      // Ignore clipboard failure
    }
  };

  const activeDef = CORE_MODELS.find((m) => m.id === thread.activeModelId);
  const ollamaModels = runtimeStatus?.ollama.models ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* Workspace Toolbar: Model Switcher & Controls */}
      <div className="border-b border-slate-200 bg-white px-4 py-3 md:px-6 dark:border-slate-800 dark:bg-[#0F131B]">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Select AI model"
            className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#161C27]"
          >
            {CORE_MODELS.map((model) => {
              const selected = thread.activeModelId === model.id;
              const label = model.id === 'forge' ? forgeConfig.name || 'Forge AI' : model.name;
              return (
                <button
                  key={model.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => handleSelectModel(model.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-500 ${
                    selected
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-[#232B3B] dark:text-slate-50'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              );
            })}

            {ollamaModels.length > 0 && (
              <div className="flex items-center pl-1">
                <label htmlFor="ollama-model-select" className="sr-only">
                  Select local Ollama model
                </label>
                <select
                  id="ollama-model-select"
                  value={
                    thread.activeModelId.startsWith('ollama:')
                      ? thread.activeModelId
                      : ''
                  }
                  onChange={(e) => {
                    if (e.target.value) {
                      handleSelectModel(e.target.value as ModelId);
                    }
                  }}
                  className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 focus:outline-none dark:border-slate-700 dark:bg-[#1E2533] dark:text-slate-200"
                >
                  <option value="">Ollama ({ollamaModels.length})</option>
                  {ollamaModels.map((name) => (
                    <option key={name} value={`ollama:${name}`}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div
              role="group"
              aria-label="Reasoning depth"
              className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#161C27]"
            >
              {DEPTH_OPTIONS.map((opt) => {
                const selected = thread.reasoningDepth === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelectDepth(opt.id)}
                    aria-pressed={selected}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      selected
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-[#232B3B] dark:text-slate-50'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setUseSearchGrounding((v) => !v)}
              aria-pressed={useSearchGrounding}
              title="Ground answers with live Google Search via gemini-4-hydrogen"
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                useSearchGrounding
                  ? 'border-emerald-600/40 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-[#141923] dark:text-slate-400'
              }`}
            >
              <Globe className="h-3.5 w-3.5" />
              <span>{useSearchGrounding ? 'Web On' : 'Web Off'}</span>
            </button>

            <button
              type="button"
              onClick={() => setUseLocalRag((v) => !v)}
              aria-pressed={useLocalRag}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                useLocalRag
                  ? 'border-blue-600/40 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-950/40 dark:text-blue-300'
                  : 'border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-[#141923] dark:text-slate-400'
              }`}
            >
              <Database className="h-3.5 w-3.5" />
              <span className="font-mono tabular-nums">
                RAG {useLocalRag ? `On (${activeDocCount})` : 'Off'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Message Viewport */}
      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="mx-auto max-w-4xl">
          {thread.messages.length === 0 ? (
            <div className="py-10">
              <div className="mb-8 max-w-2xl">
                <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  {getModelVendor(thread.activeModelId)}
                  <span className="mx-1.5" aria-hidden="true"> · </span>
                  <span>{getModelLabel(thread.activeModelId, forgeConfig.name)}</span>
                </p>
                <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 text-balance md:text-3xl dark:text-slate-50">
                  Local-first intelligence. Five minds. One private workspace.
                </h1>
                <p className="mt-2.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {activeDef?.tagline ??
                    'Grok, Gemini, Claude, GPT, and your own Forge AI — grounded in on-device RAG with optional local Ollama.'}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {STARTER_PROMPTS.map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => submitPrompt(item.prompt)}
                    className="flex flex-col items-start rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#121721] dark:hover:border-slate-700 dark:hover:bg-[#171D2A]"
                  >
                    <span className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {item.title}
                    </span>
                    <span className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                      {item.prompt}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6" data-testid="message-list">
              {thread.messages.map((msg, idx) => {
                const isLastAssistant =
                  msg.role === 'assistant' && idx === thread.messages.length - 1;
                const showLoading = isLastAssistant && isStreaming && !msg.content && !msg.error;

                if (msg.role === 'user') {
                  return (
                    <div key={msg.id} className="flex justify-end">
                      <div className="max-w-2xl rounded-xl border border-slate-200 bg-white px-4 py-3 text-[15px] leading-relaxed text-slate-900 dark:border-slate-800 dark:bg-[#171E2B] dark:text-slate-100">
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  );
                }

                return (
                  <article
                    key={msg.id}
                    className="border-b border-slate-200/80 pb-6 last:border-b-0 dark:border-slate-800/80"
                  >
                    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {msg.modelLabel}
                        </span>
                        {msg.runtime && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {msg.runtime === 'direct-api'
                                ? 'Direct API'
                                : msg.runtime === 'local-ollama'
                                  ? 'Local Ollama'
                                  : msg.runtime === 'local-offline'
                                    ? 'Offline Engine'
                                    : 'Unified Engine'}
                            </span>
                          </>
                        )}
                        {typeof msg.latencyMs === 'number' && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">{msg.latencyMs} ms</span>
                          </>
                        )}
                        {typeof msg.estimatedTokens === 'number' && msg.estimatedTokens > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {msg.estimatedTokens} tokens
                            </span>
                          </>
                        )}
                      </div>

                      {msg.content && (
                        <button
                          type="button"
                          onClick={() => handleCopyMessage(msg)}
                          aria-label={`Copy response from ${msg.modelLabel}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                        >
                          {copiedId === msg.id ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                          <span>{copiedId === msg.id ? 'Copied' : 'Copy'}</span>
                        </button>
                      )}
                    </div>

                    {msg.citations && msg.citations.length > 0 && (
                      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <BookOpen className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                        <span>Local Memory:</span>
                        {msg.citations.map((cit, cIdx) => (
                          <button
                            key={`${cit.docId}-${cit.chunkIndex}`}
                            type="button"
                            onClick={onOpenKnowledge}
                            className="underline decoration-slate-300 underline-offset-2 hover:text-slate-900 dark:decoration-slate-700 dark:hover:text-slate-100"
                          >
                            {cit.docTitle} ({cit.score})
                            {cIdx < (msg.citations?.length ?? 0) - 1 ? ',' : ''}
                          </button>
                        ))}
                      </div>
                    )}

                    {msg.webSources && msg.webSources.length > 0 && (
                      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <Globe className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        <span>Search Sources:</span>
                        {msg.webSources.map((src, sIdx) => (
                          <a
                            key={src.uri}
                            href={src.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline decoration-emerald-500/40 underline-offset-2 hover:text-slate-900 dark:hover:text-slate-100"
                          >
                            {src.title}
                            {sIdx < (msg.webSources?.length ?? 0) - 1 ? ',' : ''}
                          </a>
                        ))}
                      </div>
                    )}

                    {msg.notice && (
                      <p className="mb-2.5 text-xs text-slate-500 dark:text-slate-400">
                        {msg.notice}
                      </p>
                    )}

                    {showLoading && (
                      <div className="flex items-center gap-2 py-2 text-sm text-slate-500 dark:text-slate-400">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>Generating response...</span>
                      </div>
                    )}

                    {msg.error && (
                      <div
                        role="alert"
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                      >
                        <span>
                          <strong className="font-semibold">Error:</strong> {msg.error}
                        </span>
                        {idx > 0 && thread.messages[idx - 1]?.role === 'user' && !isStreaming && (
                          <button
                            type="button"
                            onClick={() => submitPrompt(thread.messages[idx - 1].content)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-300 bg-white px-2.5 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200 dark:hover:bg-red-900/60"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            <span>Retry</span>
                          </button>
                        )}
                      </div>
                    )}

                    {msg.content && <MarkdownRenderer content={msg.content} />}
                  </article>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>

      {/* Bottom Composer */}
      <div className="border-t border-slate-200 bg-white px-4 py-3.5 md:px-6 dark:border-slate-800 dark:bg-[#0F131B]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitPrompt(input);
          }}
          className="mx-auto max-w-4xl"
        >
          <div className="flex items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5 focus-within:border-blue-500 dark:border-slate-800 dark:bg-[#141923]">
            <label htmlFor="chat-composer-input" className="sr-only">
              Prompt message
            </label>
            <textarea
              id="chat-composer-input"
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitPrompt(input);
                }
              }}
              placeholder={`Message ${getModelLabel(thread.activeModelId, forgeConfig.name)}...`}
              className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-1.5 py-1 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
            />

            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                aria-label="Stop generation"
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap shrink-0"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label="Send message"
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0"
              >
                <ArrowUp className="h-4 w-4" />
                <span>Send</span>
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            Enter to send · Shift+Enter for newline · Conversations stay stored locally in your browser.
          </p>
        </form>
      </div>
    </div>
  );
}
