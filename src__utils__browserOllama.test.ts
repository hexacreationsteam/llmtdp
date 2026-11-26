import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBrowserOllamaUrl,
  parseOllamaNdjsonLine,
  parseOllamaTagsResponse,
  probeBrowserOllama,
} from './browserOllama';

test('normalizeBrowserOllamaUrl strips trailing slashes and /api suffix', () => {
  assert.equal(normalizeBrowserOllamaUrl('http://localhost:11434/api/'), 'http://localhost:11434');
  assert.equal(normalizeBrowserOllamaUrl('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434');
});

test('parseOllamaTagsResponse extracts model names safely', () => {
  assert.deepEqual(
    parseOllamaTagsResponse({
      models: [{ name: 'llama3.2:latest' }, { model: 'qwen2.5-coder:7b' }, {}],
    }),
    ['llama3.2:latest', 'qwen2.5-coder:7b'],
  );
  assert.deepEqual(parseOllamaTagsResponse(null), []);
});

test('parseOllamaNdjsonLine parses streaming chunks and ignores blanks/malformed lines', () => {
  assert.equal(parseOllamaNdjsonLine('   '), null);
  assert.equal(parseOllamaNdjsonLine('{bad-json'), null);
  assert.deepEqual(
    parseOllamaNdjsonLine('{"message":{"content":"Hello"},"done":false}'),
    { content: 'Hello', done: false, error: undefined },
  );
});

test('probeBrowserOllama returns disconnected cleanly outside browser environments', async () => {
  const status = await probeBrowserOllama();
  assert.equal(status.connected, false);
  assert.deepEqual(status.models, []);
});
