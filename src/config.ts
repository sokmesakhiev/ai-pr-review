import * as core from '@actions/core';
import * as github from '@actions/github';
import { ConfigError } from './errors.js';
import { DEFAULT_MODEL, isKnownModel, isValidReasoningEffort } from './models.js';
import type { ActionConfig } from './types.js';

function parseIntInput(name: string, raw: string, fallback: number): number {
  if (raw.trim() === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value <= 0) {
    throw new ConfigError(`Input "${name}" must be a positive integer, got "${raw}".`);
  }
  return value;
}

/**
 * Resolves the model to use, in priority order:
 *   1. The action's `model` input (explicit — e.g. wired to a
 *      workflow_dispatch choice input so a human can pick per run).
 *   2. The `CODEX_MODEL` repository/organization Actions variable
 *      (`vars.CODEX_MODEL`), surfaced to the action as an env var by the
 *      consumer workflow — lets teams change the default without editing
 *      YAML.
 *   3. The built-in default model.
 *
 * Unknown-but-plausible model ids are allowed through with a warning rather
 * than failing the run, so a brand-new OpenAI model works immediately.
 */
export function resolveModel(rawInput: string): string {
  const candidate = rawInput.trim() || process.env.CODEX_MODEL?.trim() || DEFAULT_MODEL;

  if (!isKnownModel(candidate)) {
    core.warning(
      `Model "${candidate}" is not in the curated list this action tests against. ` +
        'Proceeding anyway — if the OpenAI API rejects it, double-check the model id.',
    );
  }

  return candidate;
}

export function resolveReasoningEffort(rawInput: string): string {
  const candidate = rawInput.trim() || 'medium';
  if (!isValidReasoningEffort(candidate)) {
    throw new ConfigError(
      `Input "reasoning_effort" must be one of minimal|low|medium|high, got "${candidate}".`,
    );
  }
  return candidate;
}

export function loadConfig(): ActionConfig {
  const openaiApiKey = core.getInput('openai_api_key', { required: true });
  const githubToken =
    core.getInput('github_token', { required: true }) || process.env.GITHUB_TOKEN || '';

  if (!githubToken) {
    throw new ConfigError('Input "github_token" is required (falls back to GITHUB_TOKEN env var).');
  }

  const model = resolveModel(core.getInput('model'));
  const reasoningEffort = resolveReasoningEffort(core.getInput('reasoning_effort'));
  const maxFiles = parseIntInput('max_files', core.getInput('max_files'), 60);
  const maxPatchChars = parseIntInput('max_patch_chars', core.getInput('max_patch_chars'), 80_000);

  const postModeRaw = core.getInput('post_mode') || 'review';
  if (postModeRaw !== 'review' && postModeRaw !== 'comment') {
    throw new ConfigError(`Input "post_mode" must be "review" or "comment", got "${postModeRaw}".`);
  }

  const failOnError = (core.getInput('fail_on_error') || 'false').toLowerCase() === 'true';

  const pullRequest = github.context.payload.pull_request;
  if (!pullRequest) {
    throw new ConfigError(
      'This action must run on a `pull_request` (or `pull_request_target`) event — ' +
        `got event "${github.context.eventName}" with no pull_request payload.`,
    );
  }

  return {
    openaiApiKey,
    githubToken,
    model,
    reasoningEffort,
    maxFiles,
    maxPatchChars,
    postMode: postModeRaw,
    failOnError,
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pullNumber: pullRequest.number,
  };
}
