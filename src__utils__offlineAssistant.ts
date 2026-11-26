import type { LocalDocument, ModelId, ReasoningDepth } from '../types/llm';
import { searchLocalKnowledge } from './localRag';
import { getModelLabel } from './modelCatalog';
import type { StreamHandlers } from './streamClient';

export function buildOfflineAnswer(params: {
  prompt: string;
  modelId: ModelId;
  forgeName?: string;
  documents: LocalDocument[];
  reasoningDepth: ReasoningDepth;
  historyCount: number;
}): string {
  const { prompt, modelId, forgeName, documents, reasoningDepth, historyCount } = params;
  const label = getModelLabel(modelId, forgeName);
  const cleanPrompt = prompt.trim();
  const chunks = searchLocalKnowledge(cleanPrompt, documents, 4);

  if (chunks.length > 0) {
    const bullets = chunks
      .map(
        (chunk, i) =>
          `### ${i + 1}. ${chunk.docTitle} *(relevance ${chunk.score})*\n${chunk.text.trim()}`,
      )
      .join('\n\n');

    return [
      `Running **${label}** in **On-Device Offline Mode** (${reasoningDepth} pass, ${historyCount} context turn${historyCount === 1 ? '' : 's'}).`,
      '',
      `Matched **${chunks.length}** section${chunks.length === 1 ? '' : 's'} from your local Knowledge Base for **"${cleanPrompt}"**:`,
      '',
      bullets,
      '',
      `> Local RAG & browser storage remain active offline. Connect a local **Ollama** daemon (\`http://localhost:11434\`) for full offline generative weights.`,
    ].join('\n');
  }

  const lower = cleanPrompt.toLowerCase();
  let starterGuidance =
    `Your prompt **"${cleanPrompt}"** is saved in your local browser thread. No matching document snippet was found in your local Knowledge Base yet.`;

  if (lower.includes('sqlite') || lower.includes('postgres')) {
    starterGuidance = [
      '### Offline Architecture Reference: SQLite vs PostgreSQL',
      '- **SQLite**: Zero-config embedded single-file database; ideal for local-first reads/writes, instant startup, and snapshot sync.',
      '- **PostgreSQL**: Client-server MVCC engine; best for multi-writer cloud concurrency, complex indexing (`pgvector`, JSONB), and centralized teams.',
      '- **Local-First Sync Pattern**: Store primary state locally (IndexedDB/SQLite), track monotonic change logs, and sync deltas when online.',
    ].join('\n');
  } else if (lower.includes('rate limit') || lower.includes('token bucket')) {
    starterGuidance = [
      '### Offline Reference: TypeScript Token Bucket Rate Limiter',
      '```ts',
      'export class TokenBucket {',
      '  private tokens: number;',
      '  private lastRefill = Date.now();',
      '  constructor(private capacity: number, private refillPerSec: number) {',
      '    this.tokens = capacity;',
      '  }',
      '  allow(): boolean {',
      '    const now = Date.now();',
      '    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.lastRefill) / 1000) * this.refillPerSec);',
      '    this.lastRefill = now;',
      '    if (this.tokens < 1) return false;',
      '    this.tokens -= 1;',
      '    return true;',
      '  }',
      '}',
      '```',
    ].join('\n');
  } else if (lower.includes('microservice') || lower.includes('monolith')) {
    starterGuidance = [
      '### Offline Engineering Critique: Modular Monolith vs Microservices',
      '- **4-Person Team Verdict**: Start with a **Modular Monolith** using strict module boundaries and a single transactional database.',
      '- **Why**: Avoids distributed tracing overhead, network serialization bugs, and multi-repo deployment drag while keeping extraction paths clean later.',
    ].join('\n');
  }

  return [
    `Running **${label}** in **On-Device Offline Mode**.`,
    '',
    starterGuidance,
    '',
    '- Add notes in **Knowledge** to answer future offline questions directly from your own documents.',
    '- Or start local **Ollama** (`http://localhost:11434`) with `OLLAMA_ORIGINS="*"` for full offline model generation.',
  ].join('\n');
}

export async function streamOfflineLocalResponse(
  params: {
    modelId: ModelId;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    documents: LocalDocument[];
    forgeName?: string;
    reasoningDepth: ReasoningDepth;
    notice: string;
  },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const startTime = Date.now();
  const lastUser =
    [...params.messages].reverse().find((m) => m.role === 'user')?.content ?? '';

  handlers.onMeta?.({
    runtime: 'local-offline',
    backendModel: 'on-device-rag',
    notice: params.notice,
  });

  const text = buildOfflineAnswer({
    prompt: lastUser,
    modelId: params.modelId,
    forgeName: params.forgeName,
    documents: params.documents,
    reasoningDepth: params.reasoningDepth,
    historyCount: params.messages.length,
  });

  const chunks = text.match(/\S+\s*/g) ?? [text];
  for (const piece of chunks) {
    if (signal?.aborted) return;
    handlers.onDelta(piece);
    await new Promise((r) => setTimeout(r, 12));
  }

  if (!signal?.aborted) {
    handlers.onDone?.({ latencyMs: Date.now() - startTime });
  }
}
