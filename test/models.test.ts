import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_BY_PROVIDER,
  findModel,
  inferProviderFromModel,
  isKnownModel,
  isValidProvider,
  isValidReasoningEffort,
} from '../src/models.js';

describe('models', () => {
  it('knows the default model for each provider', () => {
    for (const [provider, modelId] of Object.entries(DEFAULT_MODEL_BY_PROVIDER)) {
      expect(isKnownModel(modelId)).toBe(true);
      expect(findModel(modelId)?.provider).toBe(provider);
    }
  });

  it('rejects unknown models as "known" but does not throw', () => {
    expect(isKnownModel('totally-made-up-model')).toBe(false);
  });

  it('validates reasoning effort levels', () => {
    expect(isValidReasoningEffort('medium')).toBe(true);
    expect(isValidReasoningEffort('high')).toBe(true);
    expect(isValidReasoningEffort('extreme')).toBe(false);
  });

  it('validates provider names', () => {
    expect(isValidProvider('openai')).toBe(true);
    expect(isValidProvider('anthropic')).toBe(true);
    expect(isValidProvider('gemini')).toBe(true);
    expect(isValidProvider('bedrock')).toBe(false);
  });

  it('infers provider from curated model ids', () => {
    expect(inferProviderFromModel('gpt-5.1-codex')).toBe('openai');
    expect(inferProviderFromModel('claude-opus-5')).toBe('anthropic');
    expect(inferProviderFromModel('gemini-3.8-flash')).toBe('gemini');
  });

  it('infers provider from naming convention for unlisted models', () => {
    expect(inferProviderFromModel('o5-mini')).toBe('openai');
    expect(inferProviderFromModel('claude-brand-new')).toBe('anthropic');
    expect(inferProviderFromModel('gemini-4-flash')).toBe('gemini');
  });

  it('returns undefined when the provider cannot be inferred', () => {
    expect(inferProviderFromModel('llama-3-70b')).toBeUndefined();
  });
});
