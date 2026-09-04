/**
 * Curated catalog of OpenAI models this action is known to work well with for
 * code review, plus the "reasoning effort" levels the Responses API accepts
 * for reasoning-capable models.
 *
 * This list is intentionally an allowlist-with-escape-hatch: `resolveModel`
 * accepts anything, but only warns (rather than fails) when the caller picks
 * a model outside this list, so brand-new OpenAI models work on day one
 * without a code change here.
 */

export interface ModelInfo {
  /** The exact string passed to the OpenAI API. */
  id: string;
  /** Short human label shown in logs and the workflow_dispatch dropdown. */
  label: string;
  /** Whether this model supports the `reasoning.effort` parameter. */
  supportsReasoningEffort: boolean;
}

export const SUPPORTED_MODELS: readonly ModelInfo[] = [
  {
    id: 'gpt-5.1-codex',
    label: 'GPT-5.1 Codex (recommended — best code review quality)',
    supportsReasoningEffort: true,
  },
  {
    id: 'gpt-5.1-codex-mini',
    label: 'GPT-5.1 Codex Mini (fast, cheap, good for small PRs)',
    supportsReasoningEffort: true,
  },
  {
    id: 'gpt-5.1',
    label: 'GPT-5.1 (general purpose)',
    supportsReasoningEffort: true,
  },
  {
    id: 'gpt-5-mini',
    label: 'GPT-5 Mini (budget option)',
    supportsReasoningEffort: true,
  },
  {
    id: 'o4-mini',
    label: 'o4-mini (legacy reasoning model)',
    supportsReasoningEffort: true,
  },
];

export const DEFAULT_MODEL = 'gpt-5.1-codex';

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
