export type CoreModelId = 'forge' | 'gemini' | 'claude' | 'gpt' | 'grok';
export type ModelId = CoreModelId | `ollama:${string}`;

export type ReasoningDepth = 'fast' | 'balanced' | 'deep';

export type RuntimeSource =
  | 'unified-engine'
  | 'direct-api'
  | 'local-ollama'
  | 'local-offline';

export interface WebSource {
  title: string;
  uri: string;
}

export type ForgeArchetype = 'architect' | 'analyst' | 'creative' | 'tutor' | 'truthseeker' | 'custom';

export interface LocalDocument {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
  updatedAt: number;
}

export interface RetrievedChunk {
  docId: string;
  docTitle: string;
  chunkIndex: number;
  text: string;
  score: number;
}

export interface ForgeConfig {
  name: string;
  archetype: ForgeArchetype;
  customDirectives: string;
  reasoningDepth: ReasoningDepth;
  preferredBackend: string; // 'unified-engine' or 'ollama:<modelName>'
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  modelId: ModelId;
  modelLabel: string;
  runtime?: RuntimeSource;
  latencyMs?: number;
  estimatedTokens?: number;
  citations?: RetrievedChunk[];
  webSources?: WebSource[];
  notice?: string;
  error?: string;
  createdAt: number;
}

export interface ChatThread {
  id: string;
  title: string;
  activeModelId: ModelId;
  reasoningDepth: ReasoningDepth;
  messages: ChatMessage[];
  updatedAt: number;
}

export interface RuntimeStatusResponse {
  unifiedAvailable: boolean;
  unifiedModel: string;
  providers: {
    gemini: boolean;
    openai: boolean;
    xai: boolean;
    claude?: boolean;
  };
  ollama: {
    connected: boolean;
    url: string;
    models: string[];
  };
}

export interface MegaFileEntry {
  id: string;
  name: string;
  size: number;
  directory: boolean;
  modifiedAt: number | null;
  textReadable?: boolean;
}

export interface MegaStatusResponse {
  configured: boolean;
  accountHint: string | null;
  lockConfigured: boolean;
  lockMode: 'passcode' | 'mega-password' | 'unconfigured';
}

export interface ArenaResult {
  modelId: ModelId;
  modelLabel: string;
  content: string;
  streaming: boolean;
  runtime?: RuntimeSource;
  latencyMs?: number;
  estimatedTokens?: number;
  webSources?: WebSource[];
  notice?: string;
  error?: string;
}

export type AppView = 'chat' | 'arena' | 'scene' | 'voice' | 'own-ai' | 'knowledge';
