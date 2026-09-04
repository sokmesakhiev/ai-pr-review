import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// NOTE: deliberately not importing ConfigError from '../src/errors.js' here.
// `vi.resetModules()` below gives `config.js` (and the `errors.js` it
// imports) a fresh module instance per test, so a `ConfigError` thrown from
// that instance would fail an `instanceof` check against a class captured
// via a static top-level import in this file — two different class objects,
// same name. Asserting on `.name` sidesteps that cross-instance identity
// mismatch.
function expectConfigError(fn: () => unknown) {
  expect(fn).toThrow(expect.objectContaining({ name: 'ConfigError' }));
}

// `@actions/github`'s real `context` is a module-level singleton hydrated
// once from GITHUB_EVENT_NAME / GITHUB_EVENT_PATH at import time, which
// makes it awkward to vary per test case. Mock the module directly instead
// — config.ts only ever reads `context.eventName`, `context.payload`, and
// `context.repo`, so a plain object stand-in is enough.
function mockGithubContext(eventName: string, payload: unknown) {
  vi.doMock('@actions/github', () => ({
    context: {
      eventName,
      payload,
      repo: { owner: 'octocat', repo: 'hello-world' },
    },
  }));
}

async function freshLoadConfig() {
  vi.resetModules();
  const mod = await import('../src/config.js');
  return mod.loadConfig;
}

const ORIGINAL_ENV = { ...process.env };

describe('loadConfig — pull request number resolution', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      GITHUB_REPOSITORY: 'octocat/hello-world',
      INPUT_GITHUB_TOKEN: 'gh-token',
      INPUT_OPENAI_API_KEY: 'sk-test',
    };
    delete process.env.INPUT_PR_NUMBER;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.doUnmock('@actions/github');
  });

  it('resolves the PR number from the pull_request event payload', async () => {
    mockGithubContext('pull_request', { pull_request: { number: 42 } });

    const loadConfig = await freshLoadConfig();
    expect(loadConfig().pullNumber).toBe(42);
  });

  it('resolves the PR number from the pr_number input on workflow_dispatch', async () => {
    mockGithubContext('workflow_dispatch', { inputs: { pr_number: '7' } });
    process.env.INPUT_PR_NUMBER = '7';

    const loadConfig = await freshLoadConfig();
    expect(loadConfig().pullNumber).toBe(7);
  });

  it('throws a ConfigError on workflow_dispatch with no pr_number given', async () => {
    mockGithubContext('workflow_dispatch', { inputs: {} });

    const loadConfig = await freshLoadConfig();
    expectConfigError(() => loadConfig());
  });

  it('rejects a non-numeric pr_number input', async () => {
    mockGithubContext('workflow_dispatch', { inputs: {} });
    process.env.INPUT_PR_NUMBER = 'not-a-number';

    const loadConfig = await freshLoadConfig();
    expectConfigError(() => loadConfig());
  });
});
