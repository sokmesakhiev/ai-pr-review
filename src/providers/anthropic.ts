import Anthropic from '@anthropic-ai/sdk';
import { ProviderRequestError } from '../errors.js';
import { buildUserPrompt, SYSTEM_PROMPT } from '../prompt.js';
import type { RequestReviewParams, ReviewProviderClient, ReviewResult } from '../types.js';
import { normalizeReview, REVIEW_SCHEMA } from './schema.js';

/**
 * Claude's `output_config.effort` doesn't have a "minimal" level — map it to
 * the nearest supported one ("low") rather than rejecting the request.
 */
function toClaudeEffort(effort: string): 'low' | 'medium' | 'high' {
  if (effort === 'high') return 'high';
  if (effort === 'minimal' || effort === 'low') return 'low';
  return 'medium';
}

// Generous headroom for the review JSON itself plus Claude's internal
// reasoning at higher effort levels — both count against this budget, and a
// cutoff here produces truncated (unparseable) JSON rather than a clean
// error. Still finite so a single request can't run away unbounded.
const MAX_TOKENS = 16_000;

export class AnthropicProvider implements ReviewProviderClient {
  async requestReview({
    apiKey,
    model,
    reasoningEffort,
    files,
    truncatedFileCount,
  }: RequestReviewParams): Promise<ReviewResult> {
    const client = new Anthropic({ apiKey });
    const userPrompt = buildUserPrompt(files, truncatedFileCount);

    try {
      const response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        // Claude's native structured-output feature: constrains the final
        // response to this JSON schema directly, no tool-call indirection
        // needed.
        output_config: {
          effort: toClaudeEffort(reasoningEffort),
          format: {
            type: 'json_schema',
            schema: REVIEW_SCHEMA,
          },
        },
      });

      const raw = extractJsonText(response);
      return normalizeReview(JSON.parse(raw), model);
    } catch (err) {
      throw new ProviderRequestError(
        `Anthropic request failed for model "${model}". Verify the model id is available to your ` +
          'API key and that anthropic_api_key is valid.',
        err,
      );
    }
  }
}

function extractJsonText(response: unknown): string {
  const r = response as { content?: Array<{ type?: string; text?: string }> };
  const textBlock = (r.content ?? []).find(
    (block) => block.type === 'text' && typeof block.text === 'string',
  );
  if (textBlock?.text) return textBlock.text;
  throw new ProviderRequestError('Anthropic response did not contain any text content to parse.');
}
