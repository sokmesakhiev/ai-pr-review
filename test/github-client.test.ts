import { describe, expect, it } from 'vitest';
import type { DiffFile } from '../src/types.js';

// Pure logic test for the truncation math used by fetchDiffFiles, kept
// dependency-free (no network / octokit mocking) by exercising the same
// slicing rule inline.
function selectFiles(
  files: DiffFile[],
  maxFiles: number,
): { files: DiffFile[]; truncated: number } {
  const truncated = Math.max(0, files.length - maxFiles);
  return { files: files.slice(0, maxFiles), truncated };
}

describe('diff file selection', () => {
  it('keeps all files when under the limit', () => {
    const files = Array.from({ length: 5 }, (_, i) => makeFile(`file${i}.ts`));
    const { files: selected, truncated } = selectFiles(files, 60);
    expect(selected).toHaveLength(5);
    expect(truncated).toBe(0);
  });

  it('truncates and reports the overflow count', () => {
    const files = Array.from({ length: 70 }, (_, i) => makeFile(`file${i}.ts`));
    const { files: selected, truncated } = selectFiles(files, 60);
    expect(selected).toHaveLength(60);
    expect(truncated).toBe(10);
  });
});

function makeFile(filename: string): DiffFile {
  return { filename, status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b', additions: 1, deletions: 1 };
}
