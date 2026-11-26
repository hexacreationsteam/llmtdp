import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSystemInstruction,
  CORE_MODELS,
  DEFAULT_FORGE_CONFIG,
  getModelLabel,
} from './modelCatalog';

test('CORE_MODELS includes Forge AI, Gemini, Claude, GPT, and Grok', () => {
  const ids = CORE_MODELS.map((m) => m.id);
  assert.deepEqual(ids, ['forge', 'gemini', 'claude', 'gpt', 'grok']);
});

test('getModelLabel respects custom Forge AI name and Ollama prefix', () => {
  assert.equal(getModelLabel('forge', 'Nova Local'), 'Nova Local');
  assert.equal(getModelLabel('ollama:llama3.2'), 'Ollama (llama3.2)');
  assert.equal(getModelLabel('grok'), 'Grok');
});

test('buildSystemInstruction embeds custom Forge directives and local chunks', () => {
  const prompt = buildSystemInstruction(
    'forge',
    { ...DEFAULT_FORGE_CONFIG, name: 'Atlas', customDirectives: 'Be terse.' },
    [
      {
        docId: 'd1',
        docTitle: 'Project Rules',
        chunkIndex: 0,
        text: 'Always return TypeScript.',
        score: 2.1,
      },
    ],
  );
  assert.match(prompt, /You are Atlas/);
  assert.match(prompt, /Be terse\./);
  assert.match(prompt, /Project Rules/);
  assert.match(prompt, /Always return TypeScript\./);
});
