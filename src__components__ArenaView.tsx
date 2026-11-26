import { useRef, useState } from 'react';
import { ArrowUp, RefreshCw, Square } from 'lucide-react';
import type {
  ArenaResult,
  ForgeConfig,
  LocalDocument,
  ModelId,
  ReasoningDepth,
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

interface ArenaViewProps {
  forgeConfig: ForgeConfig;
  documents: LocalDocument[];
  runtimeStatus: RuntimeStatusResponse | null;
}

export function ArenaView({
  forgeConfig,
  documents,
  runtimeStatus,
}: ArenaViewProps) {
  const [selectedModels, setSelectedModels] = useState<ModelId[]>([
    'forge',
    'gemini',
    'claude',
    'gpt',
    'grok',
  ]);
  const [prompt, setPrompt] = useState('');
  const [depth, setDepth] = useState<ReasoningDepth>('balanced');
  const [results, setResults] = useState<ArenaResult[]>([]);
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const [isRunning, setIsRunning] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const availableModels: Array<{ id: ModelId; label: string; vendor: string }> = [
    ...CORE_MODELS.map((m) => ({
      id: m.id as ModelId,
      label: m.id === 'forge' ? forgeConfig.name || 'Forge AI' : m.name,
      vendor: m.vendor,
    })),
    ...(runtimeStatus?.ollama.models ?? []).map((name) => ({
      id: `ollama:${name}` as ModelId,
      label: `Ollama (${name})`,
      vendor: 'Local Daemon',
    })),
  ];

  const toggleModel = (id: ModelId) => {
    setSelectedModels((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev;
        return prev.filter((item) => item !== id);
      }
      return [...prev, id];
    });
  };

  const handleStopAll = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
    setResults((prev) => prev.map((r) => ({ ...r, streaming: false })));
  };

  const handleRunArena = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = prompt.trim();
    if (!clean || isRunning || selectedModels.length === 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSubmittedPrompt(clean);
    setIsRunning(true);

    const localChunks = searchLocalKnowledge(clean, documents, 3);

    const initial: ArenaResult[] = selectedModels.map((id) => ({
      modelId: id,
      modelLabel: getModelLabel(id, forgeConfig.name),
      content: '',
      streaming: true,
    }));
    setResults(initial);

    await Promise.all(
      selectedModels.map(async (modelId) => {
        const effectiveModelId: ModelId =
          modelId === 'forge' && forgeConfig.preferredBackend.startsWith('ollama:')
            ? (forgeConfig.preferredBackend as ModelId)
            : modelId;

        const systemInstruction = buildSystemInstruction(
          modelId,
          forgeConfig,
          modelId === 'forge' ? localChunks : [],
        );

        let textAccum = '';

        try {
          await streamChatCompletion(
            {
              modelId: effectiveModelId,
              messages: [{ role: 'user', content: clean }],
              systemInstruction,
              reasoningDepth: depth,
              documents,
              forgeName: forgeConfig.name,
            },
            {
              onMeta: (meta) => {
                setResults((prev) =>
                  prev.map((r) =>
                    r.modelId === modelId
                      ? { ...r, runtime: meta.runtime, notice: meta.notice }
                      : r,
                  ),
                );
              },
              onDelta: (delta) => {
                textAccum += delta;
                setResults((prev) =>
                  prev.map((r) =>
                    r.modelId === modelId
                      ? {
                          ...r,
                          content: textAccum,
                          estimatedTokens: estimateTokenCount(textAccum),
                        }
                      : r,
                  ),
                );
              },
              onDone: (info) => {
                setResults((prev) =>
                  prev.map((r) =>
                    r.modelId === modelId
                      ? {
                          ...r,
                          streaming: false,
                          latencyMs: info.latencyMs,
                          estimatedTokens: estimateTokenCount(textAccum),
                        }
                      : r,
                  ),
                );
              },
              onError: (errMsg) => {
                setResults((prev) =>
                  prev.map((r) =>
                    r.modelId === modelId
                      ? { ...r, streaming: false, error: errMsg }
                      : r,
                  ),
                );
              },
            },
            controller.signal,
          );
        } catch (err: unknown) {
          if ((err as Error)?.name !== 'AbortError') {
            setResults((prev) =>
              prev.map((r) =>
                r.modelId === modelId
                  ? {
                      ...r,
                      streaming: false,
                      error: err instanceof Error ? err.message : 'Stream failed',
                    }
                  : r,
              ),
            );
          }
        }
      }),
    );

    abortRef.current = null;
    setIsRunning(false);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-slate-200 bg-white px-4 py-4 md:px-6 dark:border-slate-800 dark:bg-[#0F131B]">
        <div className="mx-auto max-w-6xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-lg font-bold text-slate-900 dark:text-slate-50">
                Multi-Model Arena
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Dispatch one prompt in parallel across Forge AI, Gemini, Claude, GPT, and Grok.
              </p>
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#161C27]">
              {(['fast', 'balanced', 'deep'] as ReasoningDepth[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDepth(d)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                    depth === d
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-[#232B3B] dark:text-slate-50'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Models in comparison">
            {availableModels.map((m) => {
              const active = selectedModels.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleModel(m.id)}
                  aria-pressed={active}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#141923] dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleRunArena} className="flex gap-2.5">
            <label htmlFor="arena-prompt-input" className="sr-only">
              Comparison prompt
            </label>
            <input
              id="arena-prompt-input"
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter a prompt to compare all selected models side-by-side..."
              className="h-10 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-[#141923] dark:text-slate-100"
            />
            {isRunning ? (
              <button
                type="button"
                onClick={handleStopAll}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 whitespace-nowrap shrink-0"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>Stop All</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!prompt.trim()}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0"
              >
                <ArrowUp className="h-4 w-4" />
                <span>Compare ({selectedModels.length})</span>
              </button>
            )}
          </form>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="mx-auto max-w-6xl">
          {results.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-[#121721]">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                No comparison run yet
              </h2>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                Select two or more models above and submit a prompt to benchmark reasoning style, speed, and clarity side-by-side.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {submittedPrompt && (
                <div className="border-b border-slate-200 pb-3 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-300">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">Prompt: </span>
                  <span>{submittedPrompt}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="arena-grid">
                {results.map((res) => (
                  <section
                    key={res.modelId}
                    className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#121721]"
                  >
                    <div className="mb-3 flex items-baseline justify-between gap-2 border-b border-slate-200 pb-2.5 dark:border-slate-800">
                      <div>
                        <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {res.modelLabel}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {getModelVendor(res.modelId)}
                          {res.runtime && (
                            <>
                              <span className="mx-1.5" aria-hidden="true">·</span>
                              <span>
                                {res.runtime === 'direct-api'
                                  ? 'Direct API'
                                  : res.runtime === 'local-ollama'
                                    ? 'Local Ollama'
                                    : res.runtime === 'local-offline'
                                      ? 'Offline Engine'
                                      : 'Unified Engine'}
                              </span>
                            </>
                          )}
                        </p>
                      </div>

                      <div className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                        {res.streaming ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : res.latencyMs ? (
                          `${res.latencyMs} ms`
                        ) : null}
                      </div>
                    </div>

                    <div className="flex-1 text-sm">
                      {res.notice && (
                        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                          {res.notice}
                        </p>
                      )}
                      {res.error ? (
                        <p className="text-sm text-red-600 dark:text-red-400">{res.error}</p>
                      ) : res.content ? (
                        <MarkdownRenderer content={res.content} />
                      ) : (
                        <p className="text-xs text-slate-400">Waiting for stream...</p>
                      )}
                    </div>

                    {typeof res.estimatedTokens === 'number' && res.estimatedTokens > 0 && (
                      <div className="mt-3 border-t border-slate-200 pt-2 font-mono text-[11px] tabular-nums text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        {res.estimatedTokens} tokens
                      </div>
                    )}
                  </section>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
