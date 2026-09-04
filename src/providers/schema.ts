import { ProviderRequestError } from '../errors.js';
import type { ReviewComment, ReviewResult } from '../types.js';

/**
 * Standard JSON Schema for the review response, shared verbatim by all three
 * provider clients — OpenAI (Responses API `text.format`), Anthropic
 * (`output_config.format`), and Gemini (`responseJsonSchema`) each accept a
 * plain JSON Schema object for structured output.
 */
export const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: {
      type: 'string',
      description: 'A concise (2-5 sentence) overall summary of the PR and the review findings.',
    },
    overall_recommendation: {
      type: 'string',
      enum: ['approve', 'comment', 'request_changes'],
    },
    comments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'File path exactly as shown in the diff header.' },
          line: {
            type: 'integer',
            description: 'Line number on the new (RIGHT) side of the diff.',
          },
          severity: { type: 'string', enum: ['info', 'suggestion', 'warning', 'blocker'] },
          body: { type: 'string' },
        },
        required: ['path', 'line', 'severity', 'body'],
      },
    },
  },
  required: ['summary', 'overall_recommendation', 'comments'],
} as const;

export interface RawReview {
  summary: string;
  overall_recommendation: 'approve' | 'comment' | 'request_changes';
  comments: Array<{ path: string; line: number; severity: string; body: string }>;
}

function isValidSeverity(s: string): s is ReviewComment['severity'] {
  return s === 'info' || s === 'suggestion' || s === 'warning' || s === 'blocker';
}

/** Parses a raw JSON string produced by a provider into a `ReviewResult`. */
export function parseReviewJson(rawJson: string, modelUsed: string): ReviewResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    throw new ProviderRequestError('Failed to parse JSON returned by the model.', err);
  }
  return normalizeReview(parsed, modelUsed);
}

/**
 * Normalizes an already-parsed object (e.g. an Anthropic tool_use `input`,
 * which arrives as a JS object rather than a JSON string) into a
 * `ReviewResult`, tolerating minor shape drift from the model.
 */
export function normalizeReview(parsed: unknown, modelUsed: string): ReviewResult {
  const raw = parsed as Partial<RawReview> | null | undefined;

  const comments: ReviewComment[] = (raw?.comments ?? [])
    .filter(
      (c): c is RawReview['comments'][number] =>
        !!c && typeof c.path === 'string' && Number.isFinite(c.line) && c.line > 0,
    )
    .map((c) => ({
      path: c.path,
      line: c.line,
      severity: isValidSeverity(c.severity) ? c.severity : ('info' as const),
      body: c.body,
    }));

  const recommendation = raw?.overall_recommendation;
  const overallRecommendation =
    recommendation === 'approve' ||
    recommendation === 'request_changes' ||
    recommendation === 'comment'
      ? recommendation
      : 'comment';

  return {
    summary: raw?.summary ?? 'No summary provided by the model.',
    overallRecommendation,
    comments,
    modelUsed,
  };
}
