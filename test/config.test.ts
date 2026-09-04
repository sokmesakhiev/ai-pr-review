import { afterEach, describe, expect, it } from 'vitest';
import { resolveModel, resolveProvider, resolveReasoningEffort } from '../src/config.js';
import { ConfigError } from '../src/errors.js';

describe('resolveProvider', () => {
  afterEach(() => {
    delete process.env.CODEX_MODEL;
  });

  it('uses the explicit provider input when set', () => {
    expect(resolveProvider('anthropic', 'gpt-5.1-codex')).toBe('anthropic');
  });

  it('infers the provider from a known model id', () => {
    expect(resolveProvider('', 'claude-opus-5')).toBe('anthropic');
    expect(resolveProvider('', 'gemini-3.8-flash')).toBe('gemini');
    expect(resolveProvider('', 'gpt-5.1-codex')).toBe('openai');
  });

  it('infers the provider from an unknown-but-plausible model id', () => {
    expect(resolveProvider('', 'claude-future-model')).toBe('anthropic');
    expect(resolveProvider('', 'gemini-future-model')).toBe('gemini');
  });

  it('falls back to the default provider when nothing can be inferred', () => {
    expect(resolveProvider('', '')).toBe('openai');
    expect(resolveProvider('', 'some-mystery-model')).toBe('openai');
  });

  it('rejects an invalid provider input', () => {
    expect(() => resolveProvider('bedrock', '')).toThrow(ConfigError);
  });
});

describe('resolveModel', () => {
  afterEach(() => {
    delete process.env.CODEX_MODEL;
  });

  it('uses the explicit input when provided', () => {
    expect(resolveModel('gpt-5.1-codex-mini', 'openai')).toBe('gpt-5.1-codex-mini');
  });

  it('falls back to CODEX_MODEL env var when input is empty', () => {
    process.env.CODEX_MODEL = 'gpt-5-mini';
    expect(resolveModel('', 'openai')).toBe('gpt-5-mini');
  });

  it("falls back to the resolved provider's default when nothing else is set", () => {
    expect(resolveModel('  ', 'openai')).toBe('gpt-5.1-codex');
    expect(resolveModel('  ', 'anthropic')).toBe('claude-opus-5');
    expect(resolveModel('  ', 'gemini')).toBe('gemini-3.8-flash');
  });

  it('allows an unknown model through with only a warning', () => {
    expect(resolveModel('some-future-model', 'openai')).toBe('some-future-model');
  });
});

describe('resolveReasoningEffort', () => {
  it('defaults to medium', () => {
    expect(resolveReasoningEffort('')).toBe('medium');
  });

  it('accepts valid levels', () => {
    expect(resolveReasoningEffort('high')).toBe('high');
  });

  it('rejects invalid levels', () => {
    expect(() => resolveReasoningEffort('extreme')).toThrow(ConfigError);
  });
});
