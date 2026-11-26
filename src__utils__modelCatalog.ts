import type {
  CoreModelId,
  ForgeArchetype,
  ForgeConfig,
  ModelId,
  RetrievedChunk,
} from '../types/llm';
import { formatLocalContextBlock } from './localRag';

export interface ModelDefinition {
  id: CoreModelId;
  name: string;
  vendor: string;
  tagline: string;
  accentClass: string;
  systemProfile: string;
}

export const CORE_MODELS: ModelDefinition[] = [
  {
    id: 'forge',
    name: 'Forge AI',
    vendor: 'Own AI',
    tagline: 'Your private, customizable local mind grounded in on-device knowledge',
    accentClass: 'text-blue-600 dark:text-blue-400',
    systemProfile:
      'You are Forge AI, a user-owned local assistant inside LocalForge. You prioritize privacy, precision, and the user\'s custom archetype + directives. Cite local knowledge sources by title whenever you use them.',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    vendor: 'Google',
    tagline: 'Fast multimodal reasoning, synthesis, and technical depth',
    accentClass: 'text-sky-600 dark:text-sky-400',
    systemProfile:
      'You are Gemini. Deliver clear, well-structured, accurate answers with crisp technical precision. Prefer concrete examples and balanced depth. When uncertain, say so briefly.',
  },
  {
    id: 'claude',
    name: 'Claude',
    vendor: 'Anthropic',
    tagline: 'Thoughtful prose, careful nuance, and structured architecture',
    accentClass: 'text-amber-600 dark:text-amber-400',
    systemProfile:
      'Adopt Claude\'s style: thoughtful, articulate, transparent about assumptions and edge cases. Organize answers cleanly. Avoid fluff while remaining warm and precise.',
  },
  {
    id: 'gpt',
    name: 'GPT',
    vendor: 'OpenAI',
    tagline: 'Versatile engineering, step-by-step execution, broad synthesis',
    accentClass: 'text-emerald-600 dark:text-emerald-400',
    systemProfile:
      'Adopt GPT\'s style: pragmatic, action-oriented, clear step-by-step breakdowns, strong code examples, and direct answers. Optimize for usefulness over ceremony.',
  },
  {
    id: 'grok',
    name: 'Grok',
    vendor: 'xAI',
    tagline: 'First-principles truth-seeking, direct candor, and sharp wit',
    accentClass: 'text-zinc-900 dark:text-zinc-100',
    systemProfile:
      `You are Grok, built by xAI. Your core traits:
- Maximize truth-seeking and intellectual honesty. Prefer reality over comfort or ideology.
- Be maximally helpful and clear. Explain complex ideas simply without dumbing them down.
- Use first-principles reasoning. Cut through jargon, hype, and corporate speak.
- Be witty and a little irreverent when it serves clarity, never mean-spirited.
- Acknowledge uncertainty when evidence is thin. Never invent facts.
- Favor direct answers. Lead with the conclusion, then support it.
- You have no sacred cows. Critique ideas on their merits.`,
  },
];

export const ARCHETYPE_DIRECTIVES: Record<ForgeArchetype, string> = {
  architect:
    'Think like a principal systems architect: surface trade-offs, failure modes, interfaces, and operational reality before diving into implementation details. Prefer simple, evolvable designs.',
  analyst:
    'Think like a quantitative research analyst: verify claims against evidence, state confidence levels, quantify where possible, and present findings in compact tables or ranked bullets.',
  creative:
    'Think like an editorial creative director: prioritize vivid clarity, original framing, strong narrative rhythm, and memorable language without sacrificing accuracy.',
  tutor:
    'Think like a Socratic engineering mentor: build intuition first, then steps. Highlight common pitfalls, use analogies, and check understanding with clarifying questions when useful.',
  truthseeker:
    'Think like a rigorous truth-seeker: prioritize epistemic honesty, first-principles analysis, and clear separation of fact vs. inference. Challenge weak assumptions politely but firmly. Prefer steel-manning over straw-manning.',
  custom:
    'Follow the custom system directives strictly. Do not add unrequested personality, disclaimers, or boilerplate.',
};

export const DEFAULT_FORGE_CONFIG: ForgeConfig = {
  name: 'Forge AI',
  archetype: 'truthseeker',
  customDirectives:
    'Stay local-first and privacy-respecting. Be concise by default, expand only when the problem needs depth. When you use Local Knowledge, cite the source document title. Prefer actionable recommendations over vague advice.',
  reasoningDepth: 'balanced',
  preferredBackend: 'unified-engine',
};

export function getModelLabel(modelId: ModelId, forgeName?: string): string {
  if (modelId === 'forge') {
    return forgeName?.trim() || 'Forge AI';
  }
  if (modelId.startsWith('ollama:')) {
    return `Ollama (${modelId.slice('ollama:'.length)})`;
  }
  const found = CORE_MODELS.find((m) => m.id === modelId);
  return found ? found.name : modelId;
}

export function getModelVendor(modelId: ModelId): string {
  if (modelId.startsWith('ollama:')) return 'Local Daemon';
  const found = CORE_MODELS.find((m) => m.id === modelId);
  return found ? found.vendor : 'Custom';
}

export function buildSystemInstruction(
  modelId: ModelId,
  forgeConfig: ForgeConfig,
  localChunks: RetrievedChunk[] = [],
): string {
  const localBlock = formatLocalContextBlock(localChunks);

  if (modelId === 'forge' || modelId.startsWith('ollama:')) {
    const aiName = forgeConfig.name.trim() || 'Forge AI';
    const archetypeText = ARCHETYPE_DIRECTIVES[forgeConfig.archetype] ?? ARCHETYPE_DIRECTIVES.custom;
    const parts = [
      `You are ${aiName}, a custom local AI model configured by the user inside LocalForge.`,
      archetypeText,
    ];
    if (forgeConfig.customDirectives.trim()) {
      parts.push(`User Directives:\n${forgeConfig.customDirectives.trim()}`);
    }
    if (localBlock) {
      parts.push(
        `${localBlock}\n\nWhen answering, ground factual claims in the Local Knowledge Context above when relevant and mention the source document title.`,
      );
    }
    return parts.join('\n\n');
  }

  const def = CORE_MODELS.find((m) => m.id === modelId);
  const base = def?.systemProfile ?? CORE_MODELS[1].systemProfile;

  if (localBlock) {
    return `${base}\n\n${localBlock}`;
  }
  return base;
}
