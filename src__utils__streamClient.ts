import type { LocalDocument, ModelId, ReasoningDepth, RuntimeSource, WebSource } from '../types/llm';
import {
  getDetectedBrowserOllama,
  probeBrowserOllama,
  shouldUseBrowserOllama,
  streamBrowserOllama,
} from './browserOllama';
import { streamOfflineLocalResponse } from './offlineAssistant';

export interface StreamHandlers {
  onMeta?: (meta: { runtime: RuntimeSource; backendModel: string; notice?: string }) => void;
  onDelta: (text: string) => void;
  onSources?: (sources: WebSource[]) => void;
  onDone?: (info: { latencyMs: number }) => void;
  onError: (message: string) => void;
}

function isCloudBusyOrOfflineMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('503') ||
    lower.includes('504') ||
    lower.includes('429') ||
    lower.includes('quota') ||
    lower.includes('high demand') ||
    lower.includes('unavailable') ||
    lower.includes('overloaded') ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror')
  );
}

export async function streamChatCompletion(
  params: {
    modelId: ModelId;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    systemInstruction: string;
    reasoningDepth: ReasoningDepth;
    useSearchGrounding?: boolean;
    documents?: LocalDocument[];
    forgeName?: string;
  },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const runOfflineOrLocalOllamaFallback = async (reason: string) => {
    let browserOllama = getDetectedBrowserOllama();
    if (!browserOllama) {
      const probed = await probeBrowserOllama();
      if (probed.connected && probed.models.length > 0) {
        browserOllama = { url: probed.url, models: probed.models };
      }
    }

    if (browserOllama && browserOllama.models.length > 0) {
      const localModel = params.modelId.startsWith('ollama:')
        ? params.modelId.slice('ollama:'.length)
        : browserOllama.models[0];

      handlers.onMeta?.({
        runtime: 'local-ollama',
        backendModel: localModel,
        notice: `${reason} Answered locally with Ollama (${localModel}).`,
      });
      await streamBrowserOllama(
        {
          modelName: localModel,
          messages: params.messages,
          systemInstruction: params.systemInstruction,
        },
        handlers,
        signal,
      );
      return;
    }

    await streamOfflineLocalResponse(
      {
        modelId: params.modelId,
        messages: params.messages,
        documents: params.documents ?? [],
        forgeName: params.forgeName,
        reasoningDepth: params.reasoningDepth,
        notice: reason,
      },
      handlers,
      signal,
    );
  };

  if (params.modelId.startsWith('ollama:')) {
    const modelName = params.modelId.slice('ollama:'.length);
    if (shouldUseBrowserOllama(modelName)) {
      await streamBrowserOllama(
        {
          modelName,
          messages: params.messages,
          systemInstruction: params.systemInstruction,
        },
        handlers,
        signal,
      );
      return;
    }
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await runOfflineOrLocalOllamaFallback('Offline mode — answered on-device.');
    return;
  }

  let response: Response;
  try {
    response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: params.modelId,
        messages: params.messages,
        systemInstruction: params.systemInstruction,
        reasoningDepth: params.reasoningDepth,
        useSearchGrounding: Boolean(params.useSearchGrounding),
      }),
      signal,
    });
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') return;
    await runOfflineOrLocalOllamaFallback(
      'Network offline or server unreachable — switched to local engine.',
    );
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    if (response.status >= 500 || isCloudBusyOrOfflineMessage(text)) {
      await runOfflineOrLocalOllamaFallback(
        'Cloud engine temporarily busy — answered locally on-device.',
      );
      return;
    }
    handlers.onError(text || `Request failed with status ${response.status}`);
    return;
  }

  if (!response.body) {
    await runOfflineOrLocalOllamaFallback(
      'Empty response stream — answered locally on-device.',
    );
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let receivedDelta = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const rawEvent of events) {
      const lines = rawEvent.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr) continue;
        try {
          const parsed = JSON.parse(jsonStr) as
            | { type: 'meta'; runtime: RuntimeSource; backendModel: string; notice?: string }
            | { type: 'delta'; text: string }
            | { type: 'sources'; sources: WebSource[] }
            | { type: 'fallback_offline'; reason: string }
            | { type: 'done'; latencyMs: number }
            | { type: 'error'; message: string };

          if (parsed.type === 'meta') {
            handlers.onMeta?.({
              runtime: parsed.runtime,
              backendModel: parsed.backendModel,
              notice: parsed.notice,
            });
          } else if (parsed.type === 'delta') {
            receivedDelta = true;
            handlers.onDelta(parsed.text);
          } else if (parsed.type === 'sources') {
            handlers.onSources?.(parsed.sources);
          } else if (parsed.type === 'fallback_offline') {
            await runOfflineOrLocalOllamaFallback(parsed.reason);
            return;
          } else if (parsed.type === 'done') {
            handlers.onDone?.({ latencyMs: parsed.latencyMs });
          } else if (parsed.type === 'error') {
            if (!receivedDelta && isCloudBusyOrOfflineMessage(parsed.message)) {
              await runOfflineOrLocalOllamaFallback(
                'Cloud model experiencing temporary load — answered locally on-device.',
              );
              return;
            }
            handlers.onError(parsed.message);
          }
        } catch {
          // Ignore malformed chunk frame
        }
      }
    }
  }
}
