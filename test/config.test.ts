import { afterEach, describe, expect, it } from 'vitest';
import { resolveModel, resolveReasoningEffort } from '../src/config.js';
import { ConfigError } from '../src/errors.js';

describe('resolveModel', () => {
  afterEach(() => {
    delete process.env.CODEX_MODEL;
  });

  it('uses the explicit input when provided', () => {
    process.env.CODEX_MODEL = 'gpt-5-mini';
    expect(resolveModel('gpt-5.1-codex-mini')).toBe('gpt-5.1-codex-mini');
  });

  it('falls back to CODEX_MODEL env var when input is empty', () => {
    process.env.CODEX_MODEL = 'gpt-5-mini';
    expect(resolveModel('')).toBe('gpt-5-mini');
  });

  it('falls back to the built-in default when nothing else is set', () => {
    expect(resolveModel('  ')).toBe('gpt-5.1-codex');
  });

  it('allows an unknown model through with only a warning', () => {
    expect(resolveModel('some-future-model')).toBe('some-future-model');
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
