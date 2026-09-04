import { describe, expect, it } from 'vitest';
import { fetchDiffFiles, type Octokit } from '../src/github-client.js';

interface FakeFile {
  filename: string;
  status: string;
  patch?: string;
  additions: number;
  deletions: number;
}

/**
 * A minimal stand-in for Octokit that satisfies exactly what
 * `fetchDiffFiles` calls: `octokit.paginate(octokit.rest.pulls.listFiles, ...)`.
 * `paginate` is mocked to hand back the fixture directly (bypassing real
 * pagination/network), so these tests exercise the actual selection and
 * truncation logic in `fetchDiffFiles` rather than a re-implementation of it.
 */
function makeFakeOctokit(files: FakeFile[]): Octokit {
  return {
    paginate: async () => files,
    rest: { pulls: { listFiles: {} } },
  } as unknown as Octokit;
}

function makeFile(filename: string, overrides: Partial<FakeFile> = {}): FakeFile {
  return {
    filename,
    status: 'modified',
    patch: '@@ -1 +1 @@\n-a\n+b',
    additions: 1,
    deletions: 1,
    ...overrides,
  };
}

describe('fetchDiffFiles', () => {
  it('keeps all files when under the limit', async () => {
    const octokit = makeFakeOctokit(Array.from({ length: 5 }, (_, i) => makeFile(`file${i}.ts`)));
    const { files, truncatedFileCount } = await fetchDiffFiles(octokit, 'o', 'r', 1, 60, 80_000);
    expect(files).toHaveLength(5);
    expect(truncatedFileCount).toBe(0);
  });

  it('truncates to maxFiles and reports the overflow count', async () => {
    const octokit = makeFakeOctokit(Array.from({ length: 70 }, (_, i) => makeFile(`file${i}.ts`)));
    const { files, truncatedFileCount } = await fetchDiffFiles(octokit, 'o', 'r', 1, 60, 80_000);
    expect(files).toHaveLength(60);
    expect(truncatedFileCount).toBe(10);
  });

  it('truncates an oversized patch and appends a marker', async () => {
    const bigPatch = 'x'.repeat(100);
    const octokit = makeFakeOctokit([makeFile('big.ts', { patch: bigPatch })]);
    const { files } = await fetchDiffFiles(octokit, 'o', 'r', 1, 60, 50);
    expect(files[0]?.patch).toContain('truncated at 50 characters');
    expect(files[0]?.patch?.length).toBeLessThan(bigPatch.length + 60);
  });

  it('omits the patch key entirely for files with no textual diff (e.g. binary)', async () => {
    const octokit = makeFakeOctokit([makeFile('image.png', { patch: undefined })]);
    const { files } = await fetchDiffFiles(octokit, 'o', 'r', 1, 60, 80_000);
    expect(files[0] && 'patch' in files[0]).toBe(false);
  });
});
