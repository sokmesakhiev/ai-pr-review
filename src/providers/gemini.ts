import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { ProviderRequestError } from '../errors.js';
import { buildUserPrompt, SYSTEM_PROMPT } from '../prompt.js';
import type { RequestReviewParams, ReviewProviderClient, ReviewResult } from '../types.js';
import { parseReviewJson, REVIEW_SCHEMA } from './schema.js';

/** Gemini's `thinkingConfig.thinkingLevel` uses the same four levels we do. */
function toGeminiThinkingLevel(effort: string): ThinkingLevel {
  switch (effort) {
    case 'minimal':
      return ThinkingLevel.MINIMAL;
    case 'low':
      return ThinkingLevel.LOW;
    case 'high':
      return ThinkingLevel.HIGH;
    default:
      return ThinkingLevel.MEDIUM;
  }
}

export class GeminiProvider implements ReviewProviderClient {
  async requestReview({
    apiKey,
    model,
    reasoningEffort,
    files,
    truncatedFileCount,
  }: RequestReviewParams): Promise<ReviewResult> {
    const client = new GoogleGenAI({ apiKey });
    const userPrompt = buildUserPrompt(files, truncatedFileCount);

    try {
      const response = await client.models.generateContent({
        model,
        contents: userPrompt,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          // Gemini accepts a plain JSON Schema here (as opposed to its
          // legacy `responseSchema` field, which wants the Google-specific
          // uppercase-`type` OpenAPI subset) — the same schema object used
          // for OpenAI and Anthropic works unmodified.
          responseJsonSchema: REVIEW_SCHEMA,
          thinkingConfig: {
            thinkingLevel: toGeminiThinkingLevel(reasoningEffort),
          },
        },
      });

      const text = response.text;
      if (!text) {
        throw new ProviderRequestError('Gemini response did not contain any text output to parse.');
      }
      return parseReviewJson(text, model);
    } catch (err) {
      if (err instanceof ProviderRequestError) throw err;
      throw new ProviderRequestError(
        `Gemini request failed for model "${model}". Verify the model id is available to your ` +
          'API key and that gemini_api_key is valid.',
        err,
      );
    }
  }
}
