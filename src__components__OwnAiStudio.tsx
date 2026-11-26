import { useState } from 'react';
import { Check, RefreshCw, RotateCcw } from 'lucide-react';
import type {
  ForgeArchetype,
  ForgeConfig,
  ReasoningDepth,
  RuntimeStatusResponse,
} from '../types/llm';
import {
  ARCHETYPE_DIRECTIVES,
  buildSystemInstruction,
  DEFAULT_FORGE_CONFIG,
} from '../utils/modelCatalog';

interface OwnAiStudioProps {
  config: ForgeConfig;
  runtimeStatus: RuntimeStatusResponse | null;
  onSaveConfig: (next: ForgeConfig) => void;
  onRefreshRuntime: () => Promise<void>;
}

const ARCHETYPES: Array<{ id: ForgeArchetype; label: string; summary: string }> = [
  { id: 'architect', label: 'Systems Architect', summary: 'Trade-offs, interfaces, failure modes' },
  { id: 'analyst', label: 'Research Analyst', summary: 'Evidence-bound tables and precision' },
  { id: 'creative', label: 'Creative Director', summary: 'Vivid framing and editorial prose' },
  { id: 'tutor', label: 'Engineering Mentor', summary: 'Intuition first, clear step-by-step' },
  { id: 'truthseeker', label: 'Truthseeker', summary: 'First-principles, epistemic honesty, no sacred cows' },
  { id: 'custom', label: 'Pure Custom', summary: 'Strictly your custom directives only' },
];

export function OwnAiStudio({
  config,
  runtimeStatus,
  onSaveConfig,
  onRefreshRuntime,
}: OwnAiStudioProps) {
  const [draft, setDraft] = useState<ForgeConfig>(config);
  const [savedNotice, setSavedNotice] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const compiledPrompt = buildSystemInstruction('forge', draft, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned: ForgeConfig = {
      ...draft,
      name: draft.name.trim() || 'Forge AI',
    };
    setDraft(cleaned);
    onSaveConfig(cleaned);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 1800);
  };

  const handleReset = () => {
    setDraft(DEFAULT_FORGE_CONFIG);
    onSaveConfig(DEFAULT_FORGE_CONFIG);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await onRefreshRuntime();
    setRefreshing(false);
  };

  const ollamaModels = runtimeStatus?.ollama.models ?? [];

  return (
    <div className="h-full overflow-y-auto px-4 py-6 md:px-6">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 lg:grid-cols-12">
        <form onSubmit={handleSave} className="space-y-6 lg:col-span-7">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Own AI Studio
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Define your personal local AI’s identity, cognitive archetype, reasoning behavior, and execution backend.
            </p>
          </div>

          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#121721]">
            <div>
              <label
                htmlFor="forge-ai-name"
                className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                AI Model Name
              </label>
              <input
                id="forge-ai-name"
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Forge AI"
                className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-[#0D1118] dark:text-slate-100"
              />
            </div>

            <div>
              <span className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Cognitive Archetype
              </span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ARCHETYPES.map((arch) => {
                  const active = draft.archetype === arch.id;
                  return (
                    <button
                      key={arch.id}
                      type="button"
                      onClick={() => setDraft({ ...draft, archetype: arch.id })}
                      aria-pressed={active}
                      className={`flex flex-col items-start rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? 'border-blue-600 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-950/30'
                          : 'border-slate-200 bg-slate-50 hover:bg-slate-100 dark:border-slate-800 dark:bg-[#0D1118] dark:hover:bg-slate-800/70'
                      }`}
                    >
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {arch.label}
                      </span>
                      <span className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {arch.summary}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="forge-reasoning-select"
                  className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Default Reasoning Depth
                </label>
                <select
                  id="forge-reasoning-select"
                  value={draft.reasoningDepth}
                  onChange={(e) =>
                    setDraft({ ...draft, reasoningDepth: e.target.value as ReasoningDepth })
                  }
                  className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-[#0D1118] dark:text-slate-100"
                >
                  <option value="fast">Fast (Low latency)</option>
                  <option value="balanced">Balanced (Recommended)</option>
                  <option value="deep">Deep (Maximum reasoning)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="forge-backend-select"
                  className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Inference Runtime
                </label>
                <select
                  id="forge-backend-select"
                  value={draft.preferredBackend}
                  onChange={(e) => setDraft({ ...draft, preferredBackend: e.target.value })}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-[#0D1118] dark:text-slate-100"
                >
                  <option value="unified-engine">Unified Server Engine (Gemini-4)</option>
                  {ollamaModels.map((modelName) => (
                    <option key={modelName} value={`ollama:${modelName}`}>
                      Local Ollama ({modelName})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="forge-directives"
                className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Custom System Directives
              </label>
              <textarea
                id="forge-directives"
                rows={4}
                value={draft.customDirectives}
                onChange={(e) => setDraft({ ...draft, customDirectives: e.target.value })}
                placeholder="Instruct your AI on formatting, tone, coding standards, or local priorities..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:bg-[#0D1118] dark:text-slate-100"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset Defaults</span>
              </button>

              <button
                type="submit"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                {savedNotice && <Check className="h-4 w-4" />}
                <span>{savedNotice ? 'Saved Locally' : 'Save Configuration'}</span>
              </button>
            </div>
          </div>
        </form>

        <div className="space-y-6 lg:col-span-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#121721]">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Compiled System Prompt
              </h2>
              <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {compiledPrompt.length} chars
              </span>
            </div>
            <pre className="whitespace-pre-wrap rounded-lg bg-slate-100/80 p-3.5 font-mono text-xs leading-relaxed text-slate-700 dark:bg-[#0D1118] dark:text-slate-300">
              {compiledPrompt}
            </pre>
            <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400">
              Archetype rule: {ARCHETYPE_DIRECTIVES[draft.archetype]}
            </p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#121721]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Local & Direct Runtimes
              </h2>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                aria-label="Refresh runtime status"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                <span>Probe</span>
              </button>
            </div>

            <dl className="divide-y divide-slate-200 text-xs dark:divide-slate-800">
              <div className="flex items-center justify-between py-2">
                <dt className="text-slate-600 dark:text-slate-400">Unified Server Engine</dt>
                <dd className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                  {runtimeStatus?.unifiedAvailable ? runtimeStatus.unifiedModel : 'Unavailable'}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2">
                <dt className="text-slate-600 dark:text-slate-400">Local Ollama Daemon</dt>
                <dd className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                  {runtimeStatus?.ollama.connected
                    ? `Connected (${ollamaModels.length})`
                    : 'Not running'}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2">
                <dt className="text-slate-600 dark:text-slate-400">Direct Gemini / OpenAI / xAI</dt>
                <dd className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                  {[
                    runtimeStatus?.providers.gemini ? 'Gemini' : null,
                    runtimeStatus?.providers.openai ? 'GPT' : null,
                    runtimeStatus?.providers.xai ? 'Grok' : null,
                  ]
                    .filter(Boolean)
                    .join(', ') || 'Via Unified Engine'}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              For a local daemon on your computer (<span className="font-mono">http://localhost:11434/api</span>) accessed from this web app, run Ollama with{' '}
              <span className="font-mono">OLLAMA_ORIGINS=&quot;*&quot;</span>, or set <span className="font-mono">OLLAMA_API_KEY</span> for Ollama Cloud.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
