import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, findModel, isKnownModel, isValidReasoningEffort } from '../src/models.js';

describe('models', () => {
  it('knows the default model', () => {
    expect(isKnownModel(DEFAULT_MODEL)).toBe(true);
    expect(findModel(DEFAULT_MODEL)?.id).toBe('gpt-5.1-codex');
  });

  it('rejects unknown models as "known" but does not throw', () => {
    expect(isKnownModel('totally-made-up-model')).toBe(false);
  });

  it('validates reasoning effort levels', () => {
    expect(isValidReasoningEffort('medium')).toBe(true);
    expect(isValidReasoningEffort('high')).toBe(true);
    expect(isValidReasoningEffort('extreme')).toBe(false);
  });
});
