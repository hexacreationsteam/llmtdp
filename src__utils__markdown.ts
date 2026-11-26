export type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; label: string; href: string };

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'hr' }
  | { type: 'paragraph'; text: string };

export function sanitizeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) {
    return trimmed;
  }
  return null;
}

export function parseInlineTokens(input: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: input.slice(lastIndex, match.index) });
    }

    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      tokens.push({ type: 'code', value: token.slice(1, -1) });
    } else if (token.startsWith('**') && token.endsWith('**')) {
      tokens.push({ type: 'bold', value: token.slice(2, -2) });
    } else if (token.startsWith('*') && token.endsWith('*')) {
      tokens.push({ type: 'italic', value: token.slice(1, -1) });
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkMatch) {
        const safeHref = sanitizeHref(linkMatch[2]);
        if (safeHref) {
          tokens.push({ type: 'link', label: linkMatch[1], href: safeHref });
        } else {
          tokens.push({ type: 'text', value: linkMatch[1] });
        }
      }
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < input.length) {
    tokens.push({ type: 'text', value: input.slice(lastIndex) });
  }

  return tokens.length > 0 ? tokens : [{ type: 'text', value: input }];
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  const stripped = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return stripped.split('|').map((cell) => cell.trim());
}

export function parseMarkdownBlocks(input: string): MarkdownBlock[] {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim() || 'text';
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i += 1;
      }
      blocks.push({ type: 'code', language, code: codeLines.join('\n') });
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    // Headings
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, text: headingMatch[2].trim() });
      i += 1;
      continue;
    }

    // Markdown table
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'blockquote', lines: quoteLines });
      continue;
    }

    // Unordered or ordered list
    const isUnordered = /^[-*+]\s+/.test(trimmed);
    const isOrdered = /^\d+\.\s+/.test(trimmed);
    if (isUnordered || isOrdered) {
      const items: string[] = [];
      const ordered = isOrdered;
      while (i < lines.length) {
        const cur = lines[i].trim();
        const match = ordered
          ? /^\d+\.\s+(.+)$/.exec(cur)
          : /^[-*+]\s+(.+)$/.exec(cur);
        if (!match) break;
        items.push(match[1]);
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Paragraph
    const paraLines: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (
        !next ||
        next.startsWith('```') ||
        /^(#{1,3})\s+/.test(next) ||
        next.startsWith('>') ||
        /^[-*+]\s+/.test(next) ||
        /^\d+\.\s+/.test(next) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(next)
      ) {
        break;
      }
      paraLines.push(next);
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: paraLines.join(' ') });
  }

  return blocks;
}
