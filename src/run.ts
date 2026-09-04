import * as core from '@actions/core';
import { loadConfig } from './config.js';
import { ConfigError, GitHubRequestError, ProviderRequestError } from './errors.js';
import { createOctokit, fetchDiffFiles, postReview } from './github-client.js';
import { getProviderClient } from './providers/index.js';

export async function run(): Promise<void> {
  try {
    const config = loadConfig();
    core.info(
      `Reviewing PR #${config.pullNumber} in ${config.owner}/${config.repo} with provider ` +
        `"${config.provider}", model "${config.model}" (reasoning effort: ${config.reasoningEffort}).`,
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
      core.setOutput('provider', config.provider);
      core.setOutput('model', config.model);
      return;
    }

    core.info(
      `Sending ${files.length} changed file(s) to ${config.provider} (model: ${config.model}).`,
    );

    const providerClient = getProviderClient(config.provider);
    const result = await providerClient.requestReview({
      apiKey: config.apiKey,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      files,
      truncatedFileCount,
    });

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
    core.setOutput('provider', config.provider);
    core.setOutput('model', result.modelUsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof ConfigError) {
      core.setFailed(`Configuration error: ${message}`);
      return;
    }

    if (err instanceof ProviderRequestError || err instanceof GitHubRequestError) {
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
