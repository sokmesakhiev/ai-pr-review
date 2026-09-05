import * as github from '@actions/github';
import { GitHubRequestError } from './errors.js';
import type { DiffFile, ReviewResult } from './types.js';

export type Octokit = ReturnType<typeof github.getOctokit>;

export function createOctokit(token: string): Octokit {
  return github.getOctokit(token);
}

/**
 * Fetches every changed file for the PR (paginated), then trims to
 * `maxFiles` and truncates any single patch longer than `maxPatchChars` so a
 * single huge generated file can't blow the token budget for the whole run.
 */
export async function fetchDiffFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  maxFiles: number,
  maxPatchChars: number,
): Promise<{ files: DiffFile[]; truncatedFileCount: number }> {
  try {
    const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });

    const truncatedFileCount = Math.max(0, files.length - maxFiles);
    const selected = files.slice(0, maxFiles);

    const diffFiles: DiffFile[] = selected.map((f) => {
      let patch = f.patch;
      if (patch && patch.length > maxPatchChars) {
        patch = `${patch.slice(0, maxPatchChars)}\n... [patch truncated at ${maxPatchChars} characters]`;
      }
      return {
        filename: f.filename,
        status: f.status,
        ...(patch !== undefined ? { patch } : {}),
        additions: f.additions,
        deletions: f.deletions,
      };
    });

    return { files: diffFiles, truncatedFileCount };
  } catch (err) {
    throw new GitHubRequestError(`Failed to list PR files for #${pullNumber}.`, err);
  }
}

/**
 * Posts the review either as a single formal GitHub "review" (with inline
 * comments anchored to diff lines where possible) or, if any comment can't
 * be anchored (renamed/binary files, lines outside the diff context), falls
 * back to folding it into the top-level summary so nothing is silently
 * dropped.
 */
export async function postReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  result: ReviewResult,
  postMode: 'review' | 'comment',
  validPaths: ReadonlySet<string>,
): Promise<void> {
  const body = formatSummaryBody(result);

  if (postMode === 'comment') {
    await createIssueComment(octokit, owner, repo, pullNumber, body);
    return;
  }

  const anchoredComments = result.comments.filter((c) => validPaths.has(c.path));
  const unanchoredComments = result.comments.filter((c) => !validPaths.has(c.path));

  const fullBody =
    unanchoredComments.length > 0
      ? `${body}\n\n<details>\n<summary>${unanchoredComments.length} additional comment(s) on lines outside the diff context</summary>\n\n${unanchoredComments
          .map((c) => `- **${c.path}** (${c.severity}): ${c.body}`)
          .join('\n')}\n\n</details>`
      : body;

  const event =
    result.overallRecommendation === 'approve'
      ? 'APPROVE'
      : result.overallRecommendation === 'request_changes'
        ? 'REQUEST_CHANGES'
        : 'COMMENT';

  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      event,
      body: fullBody,
      comments: anchoredComments.map((c) => ({
        path: c.path,
        line: c.line,
        side: c.side ?? 'RIGHT',
        body: `**[${c.severity}]** ${c.body}`,
      })),
    });
  } catch (err) {
    // GitHub rejects the whole review if even one comment anchor is invalid
    // (e.g. the model picked a line number that isn't part of the diff
    // hunk). Degrade gracefully to a plain issue comment rather than losing
    // the review entirely.
    const fallbackBody = `${fullBody}\n\n> ⚠️ Some inline comments could not be anchored to the diff and were omitted from a formal review; posting as a plain comment instead.\n\n${anchoredComments
      .map((c) => `- **${c.path}:${c.line}** [${c.severity}]: ${c.body}`)
      .join('\n')}`;
    await createIssueComment(octokit, owner, repo, pullNumber, fallbackBody).catch(() => {
      throw new GitHubRequestError(`Failed to post review for PR #${pullNumber}.`, err);
    });
  }
}

async function createIssueComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  body: string,
): Promise<void> {
  try {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body,
    });
  } catch (err) {
    throw new GitHubRequestError(`Failed to post comment on PR #${pullNumber}.`, err);
  }
}

function formatSummaryBody(result: ReviewResult): string {
  const badge =
    result.overallRecommendation === 'approve'
      ? '✅ Looks good'
      : result.overallRecommendation === 'request_changes'
        ? '🔴 Changes requested'
        : '💬 Comments';

  return [
    `### AI PR Review — ${badge}`,
    '',
    result.summary,
    '',
    `<sub>Model: \`${result.modelUsed}\`</sub>`,
  ].join('\n');
}
