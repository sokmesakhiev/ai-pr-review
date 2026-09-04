# codex-pr-review

A bring-your-own-key GitHub Action that reviews pull requests with OpenAI's Codex models —
posting inline comments and a summary directly on the PR, using **your own** `OPENAI_API_KEY`.

This project follows the same idea as [khovan123/codex-pr-review-bot](https://github.com/khovan123/codex-pr-review-bot)
(bring-your-own-key, patch-based PR review, no data sent to a third-party service), rebuilt with:

| | codex-pr-review-bot | This project |
|---|---|---|
| Runtime | Node.js (version unspecified) | **Node.js 24** (current Active LTS), `runs.using: node24` |
| Model | Fixed default (`gpt-5`), overridable input | Same input, **plus** a `CODEX_MODEL` repo/org variable fallback **and** a ready-made `workflow_dispatch` dropdown so anyone can pick the model per run from the Actions tab — no YAML edits needed |
| Language | TypeScript | TypeScript, strict mode, `exactOptionalPropertyTypes` |
| Output | Single comment | Formal GitHub review with **inline comments anchored to diff lines**, graceful fallback to a plain comment if anchoring fails |
| Validation | — | Input validation, curated model allowlist with warn-not-fail for new models, structured JSON-schema output from the model (no fragile text parsing) |
| Testing | — | Vitest unit tests for config resolution and model validation |
| CI | — | GitHub Actions workflow: typecheck, lint, format check, tests, and a `dist/` freshness check |

## How model selection works

This is the specific ask this project was built to answer: **choosing the Codex model from CI,
without editing the action's code.** There are three layers, in priority order:

1. **`workflow_dispatch` dropdown** — the included [`.github/workflows/codex-review.yml`](.github/workflows/codex-review.yml)
   exposes a `model` choice input. Trigger the workflow manually from the Actions tab, pick a
   model from the dropdown, and that run uses it — handy for comparing models on the same PR.
2. **`CODEX_MODEL` repository or organization variable** — set this under
   **Settings → Secrets and variables → Actions → Variables** to change the default for every
   automatic (`pull_request`-triggered) run, with no code or workflow changes.
3. **Built-in default** (`gpt-5.1-codex`) — used if neither of the above is set.

The action also accepts any model id you pass, even if it isn't in the curated list in
[`src/models.ts`](src/models.ts) — it logs a warning instead of failing, so a brand-new OpenAI
model works the day it ships.

Curated models today: `gpt-5.1-codex` (default), `gpt-5.1-codex-mini`, `gpt-5.1`, `gpt-5-mini`,
`o4-mini`.

## Setup

1. Add your OpenAI key as a repository secret named `OPENAI_API_KEY`
   (**Settings → Secrets and variables → Actions → Secrets**).
2. Copy [`.github/workflows/codex-review.yml`](.github/workflows/codex-review.yml) into your
   repository (or reuse this one if you're running the action from its own repo).
3. (Optional) Set a `CODEX_MODEL` repository variable if you want a default other than
   `gpt-5.1-codex`.
4. Open a pull request — the action reviews it automatically. Or trigger it manually from the
   Actions tab with a chosen model.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `openai_api_key` | yes | — | Your OpenAI API key. Store as a secret. |
| `github_token` | no | `${{ github.token }}` | Token used to read the diff and post the review. |
| `model` | no | *(resolved — see above)* | Model id, e.g. `gpt-5.1-codex`. |
| `reasoning_effort` | no | `medium` | `minimal` \| `low` \| `medium` \| `high`. |
| `max_files` | no | `60` | Max changed files to review. |
| `max_patch_chars` | no | `80000` | Max characters per file patch before truncation. |
| `post_mode` | no | `review` | `review` (inline comments) or `comment` (single plain comment). |
| `fail_on_error` | no | `false` | Fail the workflow step on an API error instead of warning. |

## Outputs

`summary`, `recommendation` (`approve` \| `comment` \| `request_changes`), `comment_count`, `model`.

## Local development

```bash
nvm use            # Node 24, per .nvmrc
npm ci
npm run typecheck
npm run lint
npm test
npm run build       # bundles src/ into dist/index.js via @vercel/ncc
```

`dist/index.js` is committed to the repository (standard practice for JavaScript/TypeScript
GitHub Actions) so consumers don't need to run `npm install` at execution time. CI verifies it
stays in sync with `src/` via `npm run verify-dist`.

## Security notes

- Your `OPENAI_API_KEY` never leaves your own GitHub Actions runner except in the direct HTTPS
  call to OpenAI's API — this project does not proxy through any third-party service.
- PR diffs (not full repository contents) are sent to OpenAI for review.
- Review the [OpenAI usage policies](https://openai.com/policies) for how submitted content is
  handled on their end before running this on sensitive/private code.

## License

MIT — see [LICENSE](LICENSE).
