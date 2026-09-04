import OpenAI from 'openai';
import { ProviderRequestError } from '../errors.js';
import { findModel } from '../models.js';
import { buildUserPrompt, SYSTEM_PROMPT } from '../prompt.js';
import type { RequestReviewParams, ReviewProviderClient, ReviewResult } from '../types.js';
import { parseReviewJson, REVIEW_SCHEMA } from './schema.js';

/** OpenAI accepts our four effort levels as-is via the Responses API. */
function toOpenAIEffort(effort: string): 'minimal' | 'low' | 'medium' | 'high' {
  return effort === 'minimal' || effort === 'low' || effort === 'high' ? effort : 'medium';
}

export class OpenAIProvider implements ReviewProviderClient {
  async requestReview({
    apiKey,
    model,
    reasoningEffort,
    files,
    truncatedFileCount,
  }: RequestReviewParams): Promise<ReviewResult> {
    const client = new OpenAI({ apiKey });
    const modelInfo = findModel(model);
    const userPrompt = buildUserPrompt(files, truncatedFileCount);

    try {
      const response = await client.responses.create({
        model,
        input: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        ...(modelInfo?.supportsReasoningEffort !== false
          ? { reasoning: { effort: toOpenAIEffort(reasoningEffort) } }
          : {}),
        text: {
          format: {
            type: 'json_schema',
            name: 'pr_review',
            schema: REVIEW_SCHEMA,
            strict: true,
          },
        },
      });

      const raw = extractJsonText(response);
      return parseReviewJson(raw, model);
    } catch (err) {
      throw new ProviderRequestError(
        `OpenAI request failed for model "${model}". Verify the model id is available to your ` +
          'API key and that openai_api_key is valid.',
        err,
      );
    }
  }
}

function extractJsonText(response: unknown): string {
  const r = response as { output_text?: string; output?: unknown };
  if (typeof r.output_text === 'string' && r.output_text.trim() !== '') {
    return r.output_text;
  }

  // Fall back to walking the structured `output` array in case the SDK
  // version in use doesn't populate the `output_text` convenience field.
  if (Array.isArray(r.output)) {
    for (const item of r.output as Array<{ content?: Array<{ type?: string; text?: string }> }>) {
      for (const content of item.content ?? []) {
        if (content.type === 'output_text' && typeof content.text === 'string') {
          return content.text;
        }
      }
    }
  }

  throw new ProviderRequestError('OpenAI response did not contain any text output to parse.');
}
