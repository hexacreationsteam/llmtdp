import type { LocalDocument, RetrievedChunk } from '../types/llm';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that',
  'the', 'to', 'was', 'were', 'will', 'with', 'this', 'these', 'those',
  'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why', 'can',
  'could', 'should', 'would', 'do', 'does', 'did', 'you', 'your', 'my',
  'me', 'we', 'our', 'they', 'their',
]);

export function tokenize(text: string): string[] {
  if (!text) return [];
  const raw = text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .trim()
    .split(/\s+/);

  return raw.filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function estimateTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const words = trimmed.split(/\s+/).length;
  const charEstimate = Math.ceil(trimmed.length / 4);
  return Math.max(words, charEstimate);
}

export interface DocumentChunk {
  docId: string;
  docTitle: string;
  chunkIndex: number;
  text: string;
}

export function chunkDocument(
  doc: LocalDocument,
  maxChars = 440,
  overlap = 60,
): DocumentChunk[] {
  const clean = doc.content.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  if (clean.length <= maxChars) {
    return [
      {
        docId: doc.id,
        docTitle: doc.title,
        chunkIndex: 0,
        text: clean,
      },
    ];
  }

  const chunks: DocumentChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < clean.length) {
    let end = Math.min(start + maxChars, clean.length);
    if (end < clean.length) {
      const lastBreak = Math.max(
        clean.lastIndexOf('\n', end),
        clean.lastIndexOf('. ', end),
        clean.lastIndexOf(' ', end),
      );
      if (lastBreak > start + Math.floor(maxChars * 0.45)) {
        end = lastBreak + 1;
      }
    }

    const slice = clean.slice(start, end).trim();
    if (slice) {
      chunks.push({
        docId: doc.id,
        docTitle: doc.title,
        chunkIndex: index,
        text: slice,
      });
      index += 1;
    }

    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }

  return chunks;
}

export function searchLocalKnowledge(
  query: string,
  docs: LocalDocument[],
  topK = 3,
): RetrievedChunk[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const activeDocs = docs.filter((d) => d.enabled && d.content.trim().length > 0);
  if (activeDocs.length === 0) return [];

  const allChunks = activeDocs.flatMap((doc) => chunkDocument(doc));
  if (allChunks.length === 0) return [];

  const tokenizedChunks = allChunks.map((chunk) => ({
    chunk,
    tokens: tokenize(`${chunk.docTitle} ${chunk.text}`),
  }));

  const avgDocLen =
    tokenizedChunks.reduce((sum, item) => sum + item.tokens.length, 0) /
    tokenizedChunks.length;

  const docFreq = new Map<string, number>();
  for (const { tokens } of tokenizedChunks) {
    const unique = new Set(tokens);
    for (const token of unique) {
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    }
  }

  const k1 = 1.5;
  const b = 0.75;
  const totalDocs = tokenizedChunks.length;

  const scored: RetrievedChunk[] = [];

  for (const { chunk, tokens } of tokenizedChunks) {
    if (tokens.length === 0) continue;
    const termFreq = new Map<string, number>();
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }

    let score = 0;
    for (const qToken of queryTokens) {
      const df = docFreq.get(qToken) ?? 0;
      if (df === 0) continue;
      const tf = termFreq.get(qToken) ?? 0;
      if (tf === 0) continue;

      const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + (b * tokens.length) / Math.max(1, avgDocLen));
      score += idf * (numerator / denominator);
    }

    if (score > 0) {
      scored.push({
        docId: chunk.docId,
        docTitle: chunk.docTitle,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        score: Number(score.toFixed(3)),
      });
    }
  }

  scored.sort((a, bItem) => bItem.score - a.score);
  return scored.slice(0, topK);
}

export function formatLocalContextBlock(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return '';
  const sections = chunks.map(
    (c, idx) => `[Local Source ${idx + 1}: ${c.docTitle} (score ${c.score})]\n${c.text}`,
  );
  return `LOCAL KNOWLEDGE CONTEXT (retrieved on-device):\n${sections.join('\n\n')}`;
}

export const RAG_TOKEN_BUDGET = 16_000;

export type RagMemoryStatus = 'nominal' | 'warning' | 'critical';

export interface KnowledgeStats {
  totalDocs: number;
  enabledDocs: number;
  totalChunks: number;
  totalTokens: number;
  activeTokens: number;
  tokenLimit: number;
  usagePercent: number;
  status: RagMemoryStatus;
}

export function getKnowledgeStats(
  docs: LocalDocument[],
  tokenLimit = RAG_TOKEN_BUDGET,
): KnowledgeStats {
  const safeLimit = Math.max(1, tokenLimit);
  let enabledDocs = 0;
  let totalChunks = 0;
  let totalTokens = 0;
  let activeTokens = 0;

  for (const doc of docs) {
    const docTokens = estimateTokenCount(doc.content);
    totalTokens += docTokens;
    totalChunks += chunkDocument(doc).length;
    if (doc.enabled) {
      enabledDocs += 1;
      activeTokens += docTokens;
    }
  }

  const rawPercent = (totalTokens / safeLimit) * 100;
  const usagePercent = Math.min(100, Math.round(rawPercent * 10) / 10);

  let status: RagMemoryStatus = 'nominal';
  if (rawPercent >= 90) {
    status = 'critical';
  } else if (rawPercent >= 70) {
    status = 'warning';
  }

  return {
    totalDocs: docs.length,
    enabledDocs,
    totalChunks,
    totalTokens,
    activeTokens,
    tokenLimit: safeLimit,
    usagePercent,
    status,
  };
}
