import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInlineTokens, parseMarkdownBlocks, sanitizeHref } from './markdown';

test('sanitizeHref permits https and relative paths and blocks javascript URIs', () => {
  assert.equal(sanitizeHref('https://example.com'), 'https://example.com');
  assert.equal(sanitizeHref('/docs'), '/docs');
  assert.equal(sanitizeHref('javascript:alert(1)'), null);
});

test('parseInlineTokens extracts bold, italic, code, and safe links', () => {
  const tokens = parseInlineTokens('Use **Forge** with `npm run dev` and [Docs](https://example.com).');
  assert.ok(tokens.some((t) => t.type === 'bold' && t.value === 'Forge'));
  assert.ok(tokens.some((t) => t.type === 'code' && t.value === 'npm run dev'));
  assert.ok(tokens.some((t) => t.type === 'link' && t.href === 'https://example.com'));
});

test('parseMarkdownBlocks parses headings, unclosed streaming code blocks, lists, and tables', () => {
  const md = [
    '# System Plan',
    '',
    '- Step one',
    '- Step two',
    '',
    '| Model | Vendor |',
    '| --- | --- |',
    '| Grok | xAI |',
    '',
    '```ts',
    'const x = 42;',
  ].join('\n');

  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[1].type, 'list');
  assert.equal(blocks[2].type, 'table');
  assert.equal(blocks[3].type, 'code');
  if (blocks[3].type === 'code') {
    assert.equal(blocks[3].language, 'ts');
    assert.equal(blocks[3].code, 'const x = 42;');
  }
});
