import type { StreamHandlers } from './streamClient';

export interface BrowserOllamaStatus {
  connected: boolean;
  url: string;
  models: string[];
}

interface DetectedOllamaState {
  url: string;
  models: string[];
}

let detectedBrowserOllama: DetectedOllamaState | null = null;
let serverOllamaModels = new Set<string>();

export function normalizeBrowserOllamaUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed.replace(/\/(?:api|v1)$/i, '');
}

export function parseOllamaTagsResponse(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const models = (data as { models?: Array<{ name?: string; model?: string }> }).models;
  if (!Array.isArray(models)) return [];
  return models
    .map((m) => (typeof m?.name === 'string' && m.name) || (typeof m?.model === 'string' && m.model) || '')
    .filter((name): name is string => Boolean(name));
}

export function parseOllamaNdjsonLine(
  line: string,
): { content?: string; done?: boolean; error?: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as {
      message?: { content?: string };
      done?: boolean;
      error?: string;
    };
    return {
      content: parsed.message?.content,
      done: parsed.done,
      error: parsed.error,
    };
  } catch {
    return null;
  }
}

export function setServerOllamaModels(models: string[]): void {
  serverOllamaModels = new Set(models);
}

export function getDetectedBrowserOllama(): DetectedOllamaState | null {
  return detectedBrowserOllama;
}

export function shouldUseBrowserOllama(modelName: string): boolean {
  if (!detectedBrowserOllama) return false;
  if (serverOllamaModels.has(modelName)) return false;
  return detectedBrowserOllama.models.includes(modelName) || serverOllamaModels.size === 0;
}

export async function probeBrowserOllama(
  candidates: string[] = ['http://localhost:11434', 'http://127.0.0.1:11434'],
): Promise<BrowserOllamaStatus> {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') {
    return { connected: false, url: 'http://localhost:11434', models: [] };
  }

  const normalizedCandidates = candidates
    .map(normalizeBrowserOllamaUrl)
    .filter(Boolean);

  const checks = await Promise.allSettled(
    normalizedCandidates.map(async (baseUrl) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 750);
      try {
        const res = await fetch(`${baseUrl}/api/tags`, {
          method: 'GET',
          signal: controller.signal,
        });
        if (!res.ok) return null;
        const json = await res.json();
        return {
          url: baseUrl,
          models: parseOllamaTagsResponse(json),
        };
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  for (const result of checks) {
    if (result.status === 'fulfilled' && result.value) {
      detectedBrowserOllama = result.value;
      return {
        connected: true,
        url: result.value.url,
        models: result.value.models,
      };
    }
  }

  detectedBrowserOllama = null;
  return {
    connected: false,
    url: normalizedCandidates[0] ?? 'http://localhost:11434',
    models: [],
  };
}

export async function streamBrowserOllama(
  params: {
    modelName: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    systemInstruction: string;
  },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const baseUrl = detectedBrowserOllama?.url ?? 'http://localhost:11434';
  const startTime = Date.now();

  handlers.onMeta?.({
    runtime: 'local-ollama',
    backendModel: params.modelName,
  });

  const ollamaMessages = [
    ...(params.systemInstruction
      ? [{ role: 'system', content: params.systemInstruction }]
      : []),
    ...params.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: params.modelName,
      messages: ollamaMessages,
      stream: true,
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => response.statusText);
    handlers.onError(`Local Ollama error (${response.status}): ${errText}`);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const parsed = parseOllamaNdjsonLine(line);
      if (!parsed) continue;
      if (parsed.error) {
        handlers.onError(`Local Ollama error: ${parsed.error}`);
        return;
      }
      if (parsed.content) {
        handlers.onDelta(parsed.content);
      }
    }
  }

  if (buffer.trim()) {
    const tail = parseOllamaNdjsonLine(buffer);
    if (tail?.error) {
      handlers.onError(`Local Ollama error: ${tail.error}`);
      return;
    }
    if (tail?.content) {
      handlers.onDelta(tail.content);
    }
  }

  handlers.onDone?.({ latencyMs: Date.now() - startTime });
}
