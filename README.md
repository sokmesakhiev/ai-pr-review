# codex-pr-review

A bring-your-own-key GitHub Action that reviews pull requests with **OpenAI Codex, Anthropic
Claude, or Google Gemini** — posting inline comments and a summary directly on the PR, using
**your own** API key. Provider and model are both selectable per run.

This project follows the same idea as [khovan123/codex-pr-review-bot](https://github.com/khovan123/codex-pr-review-bot)
(bring-your-own-key, patch-based PR review, no data sent to a third-party service), rebuilt with:

|            | codex-pr-review-bot                        | This project                                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime    | Node.js (version unspecified)              | **Node.js 24** (current Active LTS), `runs.using: node24`                                                                                                                                                                                            |
| Providers  | OpenAI only                                | **OpenAI, Anthropic, and Google Gemini**, behind one common interface                                                                                                                                                                                |
| Model      | Fixed default (`gpt-5`), overridable input | A `model` input resolved from a `workflow_dispatch` dropdown, a `CODEX_MODEL` repo/org variable, or a per-provider built-in default — the provider itself is inferred from the model id, so picking a model is enough                                |
| Language   | TypeScript                                 | TypeScript, strict mode, `exactOptionalPropertyTypes`                                                                                                                                                                                                |
| Output     | Single comment                             | Formal GitHub review with **inline comments anchored to diff lines**, graceful fallback to a plain comment if anchoring fails                                                                                                                        |
| Validation | —                                          | Input validation, curated model allowlist with warn-not-fail for new models, structured JSON-schema output from the model (no fragile text parsing) — the _same_ JSON Schema is reused across all three providers' native structured-output features |
| Testing    | —                                          | Vitest unit tests for provider inference, config resolution, and model validation                                                                                                                                                                    |
| CI         | —                                          | GitHub Actions workflow: typecheck, lint, format check, tests, and a `dist/` freshness check                                                                                                                                                         |

## Supported providers and models

| Provider          | Curated models                                                                       | Structured output mechanism               | Reasoning/thinking knob                                                 |
| ----------------- | ------------------------------------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------- |
| **OpenAI**        | `gpt-5.1-codex` (default), `gpt-5.1-codex-mini`, `gpt-5.1`, `gpt-5-mini`, `o4-mini`  | Responses API `text.format` (JSON Schema) | `reasoning.effort`: minimal\|low\|medium\|high                          |
| **Anthropic**     | `claude-opus-5` (default), `claude-fable-5-1`, `claude-sonnet-5`, `claude-haiku-4-5` | `output_config.format` (JSON Schema)      | `output_config.effort`: low\|medium\|high (our `minimal` maps to `low`) |
| **Google Gemini** | `gemini-3.8-flash` (default), `gemini-3-pro-preview`, `gemini-2.5-flash`             | `responseJsonSchema` (JSON Schema)        | `thinkingConfig.thinkingLevel`: minimal\|low\|medium\|high              |

The action accepts any model id you pass, even one outside this list — it logs a warning instead
of failing, so a brand-new release from any provider works the day it ships. All three providers
are implemented against the _same_ JSON Schema (see [`src/providers/schema.ts`](src/providers/schema.ts)),
so review quality and comment structure are consistent no matter which one you pick.

## How provider and model selection works

This is the specific ask this project was built to answer: **choosing the model (and provider)
from CI, without editing the action's code.** There are three layers, in priority order:

1. **`workflow_dispatch` dropdown** — the included [`.github/workflows/codex-review.yml`](.github/workflows/codex-review.yml)
   exposes a `model` choice input listing curated models from all three providers. Trigger the
   workflow manually from the Actions tab, pick one, and that run uses it — handy for
   A/B-testing models (even across providers) on the same PR.
2. **`CODEX_MODEL` repository or organization variable** — set this under
   **Settings → Secrets and variables → Actions → Variables** to change the default for every
   automatic (`pull_request`-triggered) run, with no code or workflow changes.
3. **Built-in default** (`gpt-5.1-codex`, provider `openai`) — used if neither of the above is set.

You don't need to separately choose a provider: it's **inferred from the model id's naming
convention** (`gpt-*` / `o*-mini` → openai, `claude-*` → anthropic, `gemini-*` → gemini). Set the
`provider` input explicitly only if you're pointing at a custom/self-hosted model id that doesn't
follow those conventions.

## Setup

1. Add the API key secret(s) for whichever provider(s) you plan to use — you only need the one
   matching your chosen model:
   - `OPENAI_API_KEY` for `gpt-*` / `o*` models
   - `ANTHROPIC_API_KEY` for `claude-*` models
   - `GEMINI_API_KEY` for `gemini-*` models
     (**Settings → Secrets and variables → Actions → Secrets**)
2. Copy [`.github/workflows/codex-review.yml`](.github/workflows/codex-review.yml) into your
   repository. If you're copying it into a **different** repository than this action's own (the
   normal case), change the `uses: ./` step to point at a published reference instead, e.g.
   `uses: sokmesakhiev/ai-pr-review@v1` (a tag/release) or `@main` — `uses: ./` only resolves
   when the workflow runs inside this action's own repo, since it looks for `action.yml` at the
   checkout root.
3. (Optional) Set a `CODEX_MODEL` repository variable if you want a default other than
   `gpt-5.1-codex`.
4. Open a pull request — the action reviews it automatically. Or trigger it manually from the
   Actions tab with a chosen model/provider.

## CI examples by provider

Each block below is a complete, minimal workflow that reviews every non-draft pull request
automatically, using a single provider. To use one: add the matching secret
(**Settings → Secrets and variables → Actions → Secrets**), save the block as
`.github/workflows/codex-review.yml` in your repository, and open a PR.

If you're running this from the action's own repository (dogfooding), replace
`uses: sokmesakhiev/ai-pr-review@v1` with `uses: ./`. Otherwise point it at a published tag of
wherever you've pushed this action, e.g. `@v1` or `@main`.

### 1. OpenAI Codex

Secret required: `OPENAI_API_KEY`.

```yaml
name: AI PR Review (OpenAI Codex)

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    if: ${{ !github.event.pull_request.draft }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: sokmesakhiev/ai-pr-review@v1 # or ./ if dogfooding in this repo
        with:
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ github.token }}
          model: 'gpt-5.1-codex' # provider is inferred from the model id
          reasoning_effort: 'medium'
          post_mode: 'review'
```

### 2. Anthropic Claude

Secret required: `ANTHROPIC_API_KEY`.

```yaml
name: AI PR Review (Anthropic Claude)

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    if: ${{ !github.event.pull_request.draft }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: sokmesakhiev/ai-pr-review@v1 # or ./ if dogfooding in this repo
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          github_token: ${{ github.token }}
          model: 'claude-opus-5' # provider is inferred from the model id
          reasoning_effort: 'medium'
          post_mode: 'review'
```

### 3. Google Gemini

Secret required: `GEMINI_API_KEY`.

```yaml
name: AI PR Review (Google Gemini)

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    if: ${{ !github.event.pull_request.draft }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: sokmesakhiev/ai-pr-review@v1 # or ./ if dogfooding in this repo
        with:
          gemini_api_key: ${{ secrets.GEMINI_API_KEY }}
          github_token: ${{ github.token }}
          model: 'gemini-3.8-flash' # provider is inferred from the model id
          reasoning_effort: 'medium'
          post_mode: 'review'
```

Want to A/B-test models — even across all three providers — on the same PR without maintaining
separate workflow files? Use the single
[`.github/workflows/codex-review.yml`](.github/workflows/codex-review.yml) included in this repo
instead: its `workflow_dispatch` dropdown lets you pick any of the models above per manual run.
See [How provider and model selection works](#how-provider-and-model-selection-works).

## Inputs

| Input               | Required      | Default                   | Description                                                                    |
| ------------------- | ------------- | ------------------------- | ------------------------------------------------------------------------------ |
| `provider`          | no            | _(inferred from `model`)_ | `openai` \| `anthropic` \| `gemini`.                                           |
| `openai_api_key`    | conditionally | —                         | Required when the resolved provider is `openai`.                               |
| `anthropic_api_key` | conditionally | —                         | Required when the resolved provider is `anthropic`.                            |
| `gemini_api_key`    | conditionally | —                         | Required when the resolved provider is `gemini`.                               |
| `github_token`      | no            | `${{ github.token }}`     | Token used to read the diff and post the review.                               |
| `model`             | no            | _(resolved — see above)_  | Model id, e.g. `gpt-5.1-codex`, `claude-opus-5`, `gemini-3.8-flash`.           |
| `reasoning_effort`  | no            | `medium`                  | `minimal` \| `low` \| `medium` \| `high` — mapped to each provider's own knob. |
| `max_files`         | no            | `60`                      | Max changed files to review.                                                   |
| `max_patch_chars`   | no            | `80000`                   | Max characters per file patch before truncation.                               |
| `post_mode`         | no            | `review`                  | `review` (inline comments) or `comment` (single plain comment).                |
| `fail_on_error`     | no            | `false`                   | Fail the workflow step on an API error instead of warning.                     |

## Outputs

`summary`, `recommendation` (`approve` \| `comment` \| `request_changes`), `comment_count`,
`provider`, `model`.

## Local development

```bash
nvm use            # Node 24, per .nvmrc
npm ci
npm run typecheck
npm run lint
npm test
npm run build       # bundles src/ into dist/ via @vercel/ncc
```

`dist/` is committed to the repository (standard practice for JavaScript/TypeScript GitHub
Actions) so consumers don't need to run `npm install` at execution time. CI verifies it stays in
sync with `src/` via `npm run verify-dist`.

### Adding a provider

Each provider lives in its own file under [`src/providers/`](src/providers/) implementing the
`ReviewProviderClient` interface (`src/types.ts`) — a single `requestReview(...)` method that
takes the diff and returns a `ReviewResult`. To add one: create `src/providers/<name>.ts`, wire
it into `getProviderClient` in `src/providers/index.ts`, add its models to `SUPPORTED_MODELS` and
`DEFAULT_MODEL_BY_PROVIDER` in `src/models.ts`, and add its API key input to `action.yml` and
`API_KEY_INPUT_BY_PROVIDER` in `src/config.ts`.

## Security notes

- Your API key never leaves your own GitHub Actions runner except in the direct HTTPS call to
  that provider's API — this project does not proxy through any third-party service.
- PR diffs (not full repository contents) are sent to the selected provider for review.
- Review the relevant provider's usage/data policies (OpenAI, Anthropic, or Google) for how
  submitted content is handled on their end before running this on sensitive/private code.

## License

MIT — see [LICENSE](LICENSE).
