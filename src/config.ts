import * as core from '@actions/core';
import * as github from '@actions/github';
import { ConfigError } from './errors.js';
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER,
  inferProviderFromModel,
  isKnownModel,
  isValidProvider,
  isValidReasoningEffort,
} from './models.js';
import type { ActionConfig, Provider } from './types.js';

function parseIntInput(name: string, raw: string, fallback: number): number {
  if (raw.trim() === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value <= 0) {
    throw new ConfigError(`Input "${name}" must be a positive integer, got "${raw}".`);
  }
  return value;
}

/**
 * Resolves which provider to use, in priority order:
 *   1. The explicit `provider` input (openai | anthropic | gemini).
 *   2. Inferred from the `model` input's naming convention (e.g. `claude-*`
 *      implies anthropic), whether or not the model is in the curated list.
 *   3. The built-in default (openai), so existing workflows that only ever
 *      set `openai_api_key` and `model` keep working unchanged.
 */
export function resolveProvider(providerInput: string, modelInput: string): Provider {
  const trimmedProvider = providerInput.trim().toLowerCase();
  if (trimmedProvider !== '') {
    if (!isValidProvider(trimmedProvider)) {
      throw new ConfigError(
        `Input "provider" must be one of openai|anthropic|gemini, got "${trimmedProvider}".`,
      );
    }
    return trimmedProvider;
  }

  const trimmedModel = modelInput.trim() || process.env.CODEX_MODEL?.trim() || '';
  if (trimmedModel !== '') {
    const inferred = inferProviderFromModel(trimmedModel);
    if (inferred) return inferred;
    core.warning(
      `Could not infer a provider from model "${trimmedModel}" — falling back to the default ` +
        `provider (${DEFAULT_PROVIDER}). Set the "provider" input explicitly to avoid this.`,
    );
  }

  return DEFAULT_PROVIDER;
}

/**
 * Resolves the model to use, in priority order:
 *   1. The action's `model` input (explicit — e.g. wired to a
 *      workflow_dispatch choice input so a human can pick per run).
 *   2. The `CODEX_MODEL` repository/organization Actions variable
 *      (`vars.CODEX_MODEL`), surfaced to the action as an env var by the
 *      consumer workflow — lets teams change the default without editing
 *      YAML.
 *   3. The resolved provider's built-in default model.
 *
 * Unknown-but-plausible model ids are allowed through with a warning rather
 * than failing the run, so a brand-new model works immediately.
 */
export function resolveModel(rawInput: string, provider: Provider): string {
  const candidate =
    rawInput.trim() || process.env.CODEX_MODEL?.trim() || DEFAULT_MODEL_BY_PROVIDER[provider];

  if (!isKnownModel(candidate)) {
    core.warning(
      `Model "${candidate}" is not in the curated list this action tests against. ` +
        'Proceeding anyway — if the provider API rejects it, double-check the model id.',
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

const API_KEY_INPUT_BY_PROVIDER: Record<Provider, string> = {
  openai: 'openai_api_key',
  anthropic: 'anthropic_api_key',
  gemini: 'gemini_api_key',
};

function resolveApiKey(provider: Provider): string {
  const inputName = API_KEY_INPUT_BY_PROVIDER[provider];
  const apiKey = core.getInput(inputName);
  if (!apiKey) {
    throw new ConfigError(
      `Provider "${provider}" was selected but input "${inputName}" is not set. ` +
        `Add it as a repository secret and pass it to the action (see README).`,
    );
  }
  return apiKey;
}

export function loadConfig(): ActionConfig {
  const githubToken =
    core.getInput('github_token', { required: true }) || process.env.GITHUB_TOKEN || '';
  if (!githubToken) {
    throw new ConfigError('Input "github_token" is required (falls back to GITHUB_TOKEN env var).');
  }

  const provider = resolveProvider(core.getInput('provider'), core.getInput('model'));
  const model = resolveModel(core.getInput('model'), provider);
  const apiKey = resolveApiKey(provider);
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
    apiKey,
    githubToken,
    provider,
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
