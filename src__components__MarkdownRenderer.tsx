import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { parseInlineTokens, parseMarkdownBlocks } from '../utils/markdown';

function InlineContent({ text }: { text: string }) {
  const tokens = parseInlineTokens(text);
  return (
    <>
      {tokens.map((token, idx) => {
        if (token.type === 'bold') {
          return (
            <strong key={idx} className="font-semibold text-slate-900 dark:text-slate-50">
              {token.value}
            </strong>
          );
        }
        if (token.type === 'italic') {
          return (
            <em key={idx} className="italic">
              {token.value}
            </em>
          );
        }
        if (token.type === 'code') {
          return (
            <code
              key={idx}
              className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-slate-800 dark:bg-slate-800 dark:text-slate-200"
            >
              {token.value}
            </code>
          );
        }
        if (token.type === 'link') {
          return (
            <a
              key={idx}
              href={token.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline decoration-blue-600/40 underline-offset-2 hover:decoration-blue-600 dark:text-blue-400"
            >
              {token.label}
            </a>
          );
        }
        return <span key={idx}>{token.value}</span>;
      })}
    </>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-900 text-slate-100 dark:border-slate-800 dark:bg-[#070A0F]">
      <div className="flex items-center justify-between border-b border-slate-800 px-3.5 py-2 text-xs text-slate-400">
        <span className="font-mono">{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy ${language} code block`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-blue-500 whitespace-nowrap shrink-0"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-[13px] leading-relaxed text-slate-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function MarkdownRenderer({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-slate-800 dark:text-slate-200">
      {blocks.map((block, idx) => {
        if (block.type === 'heading') {
          if (block.level === 1) {
            return (
              <h2
                key={idx}
                className="font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50"
              >
                <InlineContent text={block.text} />
              </h2>
            );
          }
          if (block.level === 2) {
            return (
              <h3
                key={idx}
                className="font-display text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50"
              >
                <InlineContent text={block.text} />
              </h3>
            );
          }
          return (
            <h4
              key={idx}
              className="font-display text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              <InlineContent text={block.text} />
            </h4>
          );
        }

        if (block.type === 'code') {
          return <CodeBlock key={idx} language={block.language} code={block.code} />;
        }

        if (block.type === 'hr') {
          return <hr key={idx} className="border-slate-200 dark:border-slate-800" />;
        }

        if (block.type === 'blockquote') {
          return (
            <blockquote
              key={idx}
              className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300"
            >
              {block.lines.map((line, lineIdx) => (
                <p key={lineIdx}>
                  <InlineContent text={line} />
                </p>
              ))}
            </blockquote>
          );
        }

        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag
              key={idx}
              className={`space-y-1.5 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
            >
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx} className="leading-relaxed">
                  <InlineContent text={item} />
                </li>
              ))}
            </ListTag>
          );
        }

        if (block.type === 'table') {
          return (
            <div
              key={idx}
              className="my-2 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800"
            >
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-slate-100 text-xs font-semibold text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  <tr>
                    {block.headers.map((header, hIdx) => (
                      <th
                        key={hIdx}
                        className="border-b border-slate-200 px-3.5 py-2 dark:border-slate-800"
                      >
                        <InlineContent text={header} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {block.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="px-3.5 py-2 font-mono text-[13px] tabular-nums">
                          <InlineContent text={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return (
          <p key={idx} className="leading-relaxed">
            <InlineContent text={block.text} />
          </p>
        );
      })}
    </div>
  );
}
