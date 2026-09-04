import OpenAI from 'openai';
import { OpenAIRequestError } from './errors.js';
import { findModel } from './models.js';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.js';
import type { DiffFile, ReviewComment, ReviewResult } from './types.js';

const REVIEW_SCHEMA = {
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

interface RawReview {
  summary: string;
  overall_recommendation: 'approve' | 'comment' | 'request_changes';
  comments: Array<{ path: string; line: number; severity: string; body: string }>;
}

function isValidSeverity(s: string): s is ReviewComment['severity'] {
  return s === 'info' || s === 'suggestion' || s === 'warning' || s === 'blocker';
}

export async function requestReview(
  apiKey: string,
  model: string,
  reasoningEffort: string,
  files: DiffFile[],
  truncatedFileCount: number,
): Promise<ReviewResult> {
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
        ? { reasoning: { effort: reasoningEffort as 'minimal' | 'low' | 'medium' | 'high' } }
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
    return parseReview(raw, model);
  } catch (err) {
    throw new OpenAIRequestError(
      `OpenAI request failed for model "${model}". Verify the model id is available to your ` +
        'API key and that OPENAI_API_KEY is valid.',
      err,
    );
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

  throw new OpenAIRequestError('OpenAI response did not contain any text output to parse.');
}

function parseReview(rawJson: string, modelUsed: string): ReviewResult {
  let parsed: RawReview;
  try {
    parsed = JSON.parse(rawJson) as RawReview;
  } catch (err) {
    throw new OpenAIRequestError('Failed to parse JSON returned by the model.', err);
  }

  const comments = (parsed.comments ?? [])
    .filter((c) => typeof c.path === 'string' && Number.isFinite(c.line) && c.line > 0)
    .map((c) => ({
      path: c.path,
      line: c.line,
      severity: isValidSeverity(c.severity) ? c.severity : ('info' as const),
      body: c.body,
    }));

  return {
    summary: parsed.summary ?? 'No summary provided by the model.',
    overallRecommendation: parsed.overall_recommendation ?? 'comment',
    comments,
    modelUsed,
  };
}
