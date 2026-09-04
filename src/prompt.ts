import type { DiffFile } from './types.js';

export const SYSTEM_PROMPT = `You are Codex, an expert code reviewer embedded in a GitHub Actions pull \
request bot. You review real, in-flight pull requests and your comments are posted directly to \
the PR, so be precise, concrete, and terse.

Rules:
- Only comment on lines that actually appear in the provided diff hunks. Use the line number as \
it appears in the "RIGHT" (new) side of the diff unless the issue only exists on the removed side.
- Prioritize correctness bugs, security issues, and broken logic over style nits. Do not repeat \
the same nit more than once.
- If a file was truncated, do not speculate about content you cannot see.
- If the diff is clean, say so plainly instead of inventing issues — do not pad the response.
- Keep each comment body to 1-3 sentences.
- Respond ONLY with JSON matching the provided schema. No prose outside the JSON.`;

export function buildUserPrompt(files: DiffFile[], truncatedFileCount: number): string {
  const fileSections = files
    .map((f) => {
      const header = `### ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`;
      const patch = f.patch ?? '[no textual diff available — binary or too large]';
      return `${header}\n\`\`\`diff\n${patch}\n\`\`\``;
    })
    .join('\n\n');

  const truncationNote =
    truncatedFileCount > 0
      ? `\n\nNote: ${truncatedFileCount} additional changed file(s) were omitted from this review ` +
        'because they exceeded the configured max_files limit.'
      : '';

  return `Review the following pull request diff.${truncationNote}\n\n${fileSections}`;
}
