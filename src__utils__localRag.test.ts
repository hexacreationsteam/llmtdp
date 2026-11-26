import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkDocument,
  estimateTokenCount,
  formatLocalContextBlock,
  getKnowledgeStats,
  searchLocalKnowledge,
  tokenize,
} from './localRag';
import type { LocalDocument } from '../types/llm';

test('tokenize removes stop words and normalizes case', () => {
  const tokens = tokenize('How does the LocalForge BM25 engine rank code?');
  assert.deepEqual(tokens, ['localforge', 'bm25', 'engine', 'rank', 'code']);
});

test('estimateTokenCount returns 0 for blank text and positive count for prose', () => {
  assert.equal(estimateTokenCount('   '), 0);
  assert.ok(estimateTokenCount('Hello world, this is a local LLM test.') >= 8);
});

test('chunkDocument splits long documents with overlap and preserves metadata', () => {
  const longText = Array.from({ length: 20 }, (_, idx) =>
    `Paragraph ${idx}: Local retrieval indexes project architecture and API specs deterministically.`
  ).join('\n');

  const doc: LocalDocument = {
    id: 'doc-1',
    title: 'Architecture Spec',
    content: longText,
    enabled: true,
    updatedAt: 1000,
  };

  const chunks = chunkDocument(doc, 300, 50);
  assert.ok(chunks.length > 2);
  assert.equal(chunks[0].docId, 'doc-1');
  assert.equal(chunks[0].chunkIndex, 0);
  assert.equal(chunks[1].chunkIndex, 1);
});

test('searchLocalKnowledge ranks matching enabled docs and skips disabled docs', () => {
  const docs: LocalDocument[] = [
    {
      id: 'd1',
      title: 'Deployment Runbook',
      content: 'Port 3000 serves Express and Vite middleware together in dev mode.',
      enabled: true,
      updatedAt: 1,
    },
    {
      id: 'd2',
      title: 'Disabled Secret Note',
      content: 'Port 3000 disabled note should never appear.',
      enabled: false,
      updatedAt: 2,
    },
    {
      id: 'd3',
      title: 'Grocery List',
      content: 'Apples, coffee beans, sourdough bread.',
      enabled: true,
      updatedAt: 3,
    },
  ];

  const results = searchLocalKnowledge('which port runs Express middleware?', docs, 2);
  assert.equal(results.length, 1);
  assert.equal(results[0].docId, 'd1');
  assert.ok(results[0].score > 0);
});

test('formatLocalContextBlock builds structured context block', () => {
  const text = formatLocalContextBlock([
    {
      docId: 'd1',
      docTitle: 'Spec',
      chunkIndex: 0,
      text: 'Uses Express on port 3000.',
      score: 1.45,
    },
  ]);
  assert.match(text, /LOCAL KNOWLEDGE CONTEXT/);
  assert.match(text, /Spec/);
});

test('getKnowledgeStats computes total docs, token usage percentage, and threshold status', () => {
  const docs: LocalDocument[] = [
    { id: '1', title: 'Doc A', content: 'A'.repeat(400), enabled: true, updatedAt: 1 },
    { id: '2', title: 'Doc B', content: 'B'.repeat(200), enabled: false, updatedAt: 2 },
  ];

  const nominal = getKnowledgeStats(docs, 1000);
  assert.equal(nominal.totalDocs, 2);
  assert.equal(nominal.enabledDocs, 1);
  assert.equal(nominal.totalTokens, 150);
  assert.equal(nominal.activeTokens, 100);
  assert.equal(nominal.usagePercent, 15);
  assert.equal(nominal.status, 'nominal');

  const warning = getKnowledgeStats(docs, 200);
  assert.equal(warning.usagePercent, 75);
  assert.equal(warning.status, 'warning');

  const critical = getKnowledgeStats(docs, 160);
  assert.equal(critical.usagePercent, 93.8);
  assert.equal(critical.status, 'critical');
});
