import type { ChatThread, ForgeConfig, LocalDocument } from '../types/llm';
import { DEFAULT_FORGE_CONFIG } from './modelCatalog';

const THREADS_KEY = 'localforge.threads.v1';
const DOCS_KEY = 'localforge.docs.v1';
const FORGE_KEY = 'localforge.forge_config.v1';
const THEME_KEY = 'localforge.theme.v1';

export const SEED_DOCUMENTS: LocalDocument[] = [
  {
    id: 'seed-arch',
    title: 'LocalForge Workspace Architecture',
    content: [
      'LocalForge is a local-first AI workbench combining Gemini, Claude, GPT, Grok, local Ollama models, and customizable Forge AI.',
      'All conversation threads, custom Forge AI directives, and knowledge documents are stored locally inside the browser using localStorage.',
      'Local retrieval runs an on-device BM25 search engine over chunked documents before sending context to the active model.',
    ].join('\n'),
    enabled: true,
    updatedAt: Date.now() - 3600_000,
  },
  {
    id: 'seed-guidelines',
    title: 'Engineering Standards & Conventions',
    content: [
      'Backend API routes run through Express on port 3000 with server-side credential isolation.',
      'Streaming responses use Server-Sent Events (SSE) with explicit runtime attribution: Direct API, Unified Engine, or Local Ollama.',
      'TypeScript modules separate pure logic from React components so retrieval, markdown parsing, and routing can be unit tested.',
    ].join('\n'),
    enabled: true,
    updatedAt: Date.now() - 1800_000,
  },
];

export const SEED_THREADS: ChatThread[] = [
  {
    id: 'seed-thread-1',
    title: 'Multi-Model Routing Overview',
    activeModelId: 'forge',
    reasoningDepth: 'balanced',
    updatedAt: Date.now() - 900_000,
    messages: [
      {
        id: 'seed-msg-1',
        role: 'user',
        content: 'How does LocalForge organize models and local knowledge?',
        modelId: 'forge',
        modelLabel: 'Forge AI',
        createdAt: Date.now() - 905_000,
      },
      {
        id: 'seed-msg-2',
        role: 'assistant',
        content:
          'LocalForge unifies **Forge AI** (your customizable local-RAG persona), **Gemini**, **Claude**, **GPT**, **Grok**, and any **Ollama** models running on your machine.\n\n- **Local Memory**: Your notes and project specs stay in browser storage and are indexed on-device with BM25 ranking.\n- **Parallel Arena**: Switch to the **Arena** tab to run the same prompt across multiple models side-by-side.\n- **Custom Own AI**: Open **Own AI** to tune Forge AI’s name, archetype, and system directives.',
        modelId: 'forge',
        modelLabel: 'Forge AI',
        runtime: 'unified-engine',
        latencyMs: 380,
        estimatedTokens: 96,
        createdAt: Date.now() - 900_000,
      },
    ],
  },
];

export function loadThreads(): ChatThread[] {
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    if (!raw) return SEED_THREADS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : SEED_THREADS;
  } catch {
    return SEED_THREADS;
  }
}

export function saveThreads(threads: ChatThread[]): void {
  try {
    localStorage.setItem(THREADS_KEY, JSON.stringify(threads));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadDocuments(): LocalDocument[] {
  try {
    const raw = localStorage.getItem(DOCS_KEY);
    if (!raw) return SEED_DOCUMENTS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : SEED_DOCUMENTS;
  } catch {
    return SEED_DOCUMENTS;
  }
}

export function saveDocuments(docs: LocalDocument[]): void {
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(docs));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadForgeConfig(): ForgeConfig {
  try {
    const raw = localStorage.getItem(FORGE_KEY);
    if (!raw) return DEFAULT_FORGE_CONFIG;
    const parsed = JSON.parse(raw) as Partial<ForgeConfig>;
    return { ...DEFAULT_FORGE_CONFIG, ...parsed };
  } catch {
    return DEFAULT_FORGE_CONFIG;
  }
}

export function saveForgeConfig(config: ForgeConfig): void {
  try {
    localStorage.setItem(FORGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadTheme(): 'dark' | 'light' {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function saveTheme(theme: 'dark' | 'light'): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Ignore storage quota errors
  }
}
