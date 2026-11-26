import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOfflineAnswer } from './offlineAssistant';

test('buildOfflineAnswer retrieves matching local knowledge base documents when offline', () => {
  const answer = buildOfflineAnswer({
    prompt: 'What does our LocalForge architecture say about BM25 RAG?',
    modelId: 'forge',
    forgeName: 'Forge AI',
    reasoningDepth: 'balanced',
    historyCount: 1,
    documents: [
      {
        id: 'doc-1',
        title: 'LocalForge Architecture',
        content: 'LocalForge uses deterministic client-side BM25 RAG search for offline retrieval.',
        enabled: true,
        updatedAt: Date.now(),
      },
    ],
  });

  assert.match(answer, /On-Device Offline Mode/);
  assert.match(answer, /LocalForge Architecture/);
  assert.match(answer, /BM25 RAG/);
});
