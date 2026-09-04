import * as core from '@actions/core';
import { loadConfig } from './config.js';
import { ConfigError, GitHubRequestError, OpenAIRequestError } from './errors.js';
import { createOctokit, fetchDiffFiles, postReview } from './github-client.js';
import { requestReview } from './openai-client.js';

export async function run(): Promise<void> {
  try {
    const config = loadConfig();
    core.info(
      `Reviewing PR #${config.pullNumber} in ${config.owner}/${config.repo} with model "${config.model}" ` +
        `(reasoning effort: ${config.reasoningEffort}).`,
    );

    const octokit = createOctokit(config.githubToken);

    const { files, truncatedFileCount } = await fetchDiffFiles(
      octokit,
      config.owner,
      config.repo,
      config.pullNumber,
      config.maxFiles,
      config.maxPatchChars,
    );

    if (files.length === 0) {
      core.info('No reviewable file changes found on this pull request — skipping.');
      core.setOutput('summary', 'No reviewable changes.');
      core.setOutput('model', config.model);
      return;
    }

    core.info(`Sending ${files.length} changed file(s) to OpenAI (model: ${config.model}).`);

    const result = await requestReview(
      config.openaiApiKey,
      config.model,
      config.reasoningEffort,
      files,
      truncatedFileCount,
    );

    const validPaths = new Set(files.map((f) => f.filename));
    await postReview(
      octokit,
      config.owner,
      config.repo,
      config.pullNumber,
      result,
      config.postMode,
      validPaths,
    );

    core.info(
      `Posted review with ${result.comments.length} inline comment(s) — recommendation: ` +
        `${result.overallRecommendation}.`,
    );

    core.setOutput('summary', result.summary);
    core.setOutput('recommendation', result.overallRecommendation);
    core.setOutput('comment_count', String(result.comments.length));
    core.setOutput('model', result.modelUsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof ConfigError) {
      core.setFailed(`Configuration error: ${message}`);
      return;
    }

    if (err instanceof OpenAIRequestError || err instanceof GitHubRequestError) {
      const failOnError = (core.getInput('fail_on_error') || 'false').toLowerCase() === 'true';
      if (failOnError) {
        core.setFailed(message);
      } else {
        core.warning(`${message} — not failing the workflow (fail_on_error is false).`);
      }
      return;
    }

    core.setFailed(`Unexpected error: ${message}`);
  }
}
