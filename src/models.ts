import type { Provider } from './types.js';

/**
 * Curated catalog of models this action is known to work well with for code
 * review, across all three supported providers.
 *
 * This list is intentionally an allowlist-with-escape-hatch: `resolveModel`
 * in config.ts accepts anything, but only warns (rather than fails) when the
 * caller picks a model outside this list, so a brand-new model from any
 * provider works on day one without a code change here.
 */

export interface ModelInfo {
  /** The exact string passed to the provider's API. */
  id: string;
  provider: Provider;
  /** Short human label shown in logs and the workflow_dispatch dropdown. */
  label: string;
  /** Whether this model supports a reasoning-effort / thinking-budget knob. */
  supportsReasoningEffort: boolean;
}

export const SUPPORTED_MODELS: readonly ModelInfo[] = [
  // --- OpenAI (Codex) ---
  {
    id: 'gpt-5.1-codex',
    provider: 'openai',
    label: 'GPT-5.1 Codex (recommended — best code review quality)',
    supportsReasoningEffort: true,
  },
  {
    id: 'gpt-5.1-codex-mini',
    provider: 'openai',
    label: 'GPT-5.1 Codex Mini (fast, cheap, good for small PRs)',
    supportsReasoningEffort: true,
  },
  {
    id: 'gpt-5.1',
    provider: 'openai',
    label: 'GPT-5.1 (general purpose)',
    supportsReasoningEffort: true,
  },
  {
    id: 'gpt-5-mini',
    provider: 'openai',
    label: 'GPT-5 Mini (budget option)',
    supportsReasoningEffort: true,
  },
  {
    id: 'o4-mini',
    provider: 'openai',
    label: 'o4-mini (legacy reasoning model)',
    supportsReasoningEffort: true,
  },

  // --- Anthropic (Claude) ---
  {
    id: 'claude-opus-5',
    provider: 'anthropic',
    label: 'Claude Opus 5 (recommended — complex agentic coding)',
    supportsReasoningEffort: true,
  },
  {
    id: 'claude-fable-5-1',
    provider: 'anthropic',
    label: 'Claude Fable 5.1 (flagship — most demanding reasoning)',
    supportsReasoningEffort: true,
  },
  {
    id: 'claude-sonnet-5',
    provider: 'anthropic',
    label: 'Claude Sonnet 5 (balanced speed/intelligence)',
    supportsReasoningEffort: true,
  },
  {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    label: 'Claude Haiku 4.5 (fast, cheap)',
    supportsReasoningEffort: true,
  },

  // --- Google (Gemini) ---
  {
    id: 'gemini-3.8-flash',
    provider: 'gemini',
    label: 'Gemini 3.8 Flash (recommended — latest flagship for coding/agents)',
    supportsReasoningEffort: true,
  },
  {
    id: 'gemini-3-pro-preview',
    provider: 'gemini',
    label: 'Gemini 3 Pro Preview (deepest reasoning)',
    supportsReasoningEffort: true,
  },
  {
    id: 'gemini-2.5-flash',
    provider: 'gemini',
    label: 'Gemini 2.5 Flash (stable GA fallback)',
    supportsReasoningEffort: true,
  },
];

export const DEFAULT_PROVIDER: Provider = 'openai';

export const DEFAULT_MODEL_BY_PROVIDER: Record<Provider, string> = {
  openai: 'gpt-5.1-codex',
  anthropic: 'claude-opus-5',
  gemini: 'gemini-3.8-flash',
};

export const REASONING_EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORT_LEVELS)[number];

export function findModel(id: string): ModelInfo | undefined {
  return SUPPORTED_MODELS.find((m) => m.id === id);
}

export function isKnownModel(id: string): boolean {
  return findModel(id) !== undefined;
}

export function isValidReasoningEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORT_LEVELS as readonly string[]).includes(value);
}

export function isValidProvider(value: string): value is Provider {
  return value === 'openai' || value === 'anthropic' || value === 'gemini';
}

/**
 * Best-effort provider guess from a model id's naming convention, used only
 * when the caller didn't pass an explicit `provider` input and the model
 * isn't in the curated list above (e.g. a brand-new release).
 */
export function inferProviderFromModel(model: string): Provider | undefined {
  const known = findModel(model);
  if (known) return known.provider;

  if (/^(gpt-|o[0-9](-|$)|chatgpt-|codex-)/i.test(model)) return 'openai';
  if (/^claude-/i.test(model)) return 'anthropic';
  if (/^gemini-/i.test(model)) return 'gemini';
  return undefined;
}
