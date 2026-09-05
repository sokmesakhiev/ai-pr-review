# CLAUDE.md

This file gives an AI assistant (or a new human contributor) everything needed to understand,
rebuild, extend, or debug this project without re-deriving it from scratch. It documents the
project's purpose, full architecture, every feature, every configuration surface, the exact
development workflow, and a set of hard-won gotchas discovered while building it.

## 1. What this project is

**codex-pr-review** ("AI PR Review" in `action.yml`) is a bring-your-own-key GitHub Action that
reviews pull requests using a large language model and posts the result directly on the PR — as
either a formal GitHub review with inline comments anchored to diff lines, or a single plain
comment. It supports three LLM providers behind one interface: **OpenAI** (Codex/GPT models),
**Anthropic** (Claude), and **Google** (Gemini). The provider and model are both selectable per
run, with no code changes required to switch between them.

It was built as an improved, provider-agnostic alternative to
[khovan123/codex-pr-review-bot](https://github.com/khovan123/codex-pr-review-bot), which is
OpenAI-only. Design goals, in priority order:

1. **No third-party proxy.** The user's own API key talks directly to the provider's API from
   their own GitHub Actions runner. This project never sees or forwards the key or the code.
2. **Provider choice without code changes.** Switching from GPT to Claude to Gemini is a one-line
   `model` input change (provider is inferred from the model id).
3. **Structured output, not fragile text parsing.** Every provider is asked for JSON conforming to
   the exact same JSON Schema, using each provider's own native structured-output feature.
4. **Safe by default.** Never checks out an untrusted PR head (avoids the "pwn request" pattern);
   API failures warn instead of failing a merge unless the user opts in to `fail_on_error`.
5. **Modern runtime.** Node.js 24 (`runs.using: node24`), current library majors, strict
   TypeScript.

## 2. High-level architecture

```
GitHub Actions event (pull_request / workflow_dispatch)
        |
        v
  action.yml (metadata: inputs, outputs, runs.main -> dist/index.js)
        |
        v
  src/index.ts --calls--> src/run.ts (run())
                                  |
                    +-------------+------------------+
                    v             v                   v
            src/config.ts  src/github-client.ts  src/providers/index.ts
          (loadConfig())   (fetchDiffFiles(),     (getProviderClient())
                             postReview())               |
                                                          v
                                          +---------------+---------------+
                                          v               v               v
                                  providers/openai  providers/anthropic providers/gemini
                                          |               |               |
                                          +-------+-------+-------+-------+
                                                  v               v
                                          src/prompt.ts   src/providers/schema.ts
                                       (system/user text)  (shared JSON Schema +
                                                             response normalization)
```

The whole action is one linear pipeline, orchestrated by `run()`:

1. **Resolve configuration** from Action inputs + environment (`loadConfig()`).
2. **Fetch the PR diff** via the GitHub REST API, paginated and size-bounded (`fetchDiffFiles()`).
3. **Bail out early** if there are no reviewable files.
4. **Dispatch to the resolved provider's client** (`getProviderClient(provider)`), which builds a
   prompt, calls that provider's API asking for schema-conformant JSON, and normalizes the result
   into a common `ReviewResult` shape.
5. **Post the result to GitHub** as a formal review (inline comments) or a plain comment
   (`postReview()`), with graceful degradation if inline anchoring fails.
6. **Set Action outputs** (`summary`, `recommendation`, `comment_count`, `provider`, `model`).
7. **On error**, distinguish configuration errors (always fail) from provider/GitHub API errors
   (fail only if `fail_on_error: true`, otherwise warn and exit successfully).

## 3. Repository layout

```
.
├── action.yml                              # GitHub Action metadata (inputs/outputs/runtime)
├── package.json                            # scripts, dependencies, engines.node >= 24
├── tsconfig.json                           # strict TypeScript config, compiles src/ -> lib/
├── eslint.config.js                        # flat ESLint config (typescript-eslint + prettier)
├── .prettierrc.json                        # Prettier formatting rules
├── .prettierignore
├── .nvmrc                                  # "24"
├── .env.example                            # local-testing env var template (not committed values)
├── .gitignore
├── LICENSE                                 # MIT
├── README.md                               # user-facing docs, CI examples per provider
├── CLAUDE.md                               # this file
├── src/
│   ├── index.ts                            # entry point: calls run()
│   ├── run.ts                              # top-level orchestration + error handling
│   ├── types.ts                            # all shared TypeScript types
│   ├── errors.ts                           # ConfigError, ProviderRequestError, GitHubRequestError
│   ├── models.ts                           # curated model catalog + resolution helpers
│   ├── config.ts                           # Action-input resolution -> ActionConfig
│   ├── github-client.ts                    # diff fetching + review/comment posting
│   ├── prompt.ts                           # system/user prompt construction
│   └── providers/
│       ├── index.ts                        # getProviderClient(provider) dispatcher
│       ├── schema.ts                       # shared JSON Schema + response normalization
│       ├── openai.ts                       # OpenAI Responses API implementation
│       ├── anthropic.ts                    # Anthropic Messages API implementation
│       └── gemini.ts                       # Google GenAI implementation
├── test/
│   ├── config.test.ts                      # resolveProvider/resolveModel/resolveReasoningEffort
│   ├── load-config.test.ts                 # loadConfig() PR-number resolution, mocks @actions/github
│   ├── github-client.test.ts               # fetchDiffFiles() against a fake Octokit
│   └── models.test.ts                      # model catalog + inference helpers
├── dist/                                   # committed @vercel/ncc bundle — this is what actually runs
├── lib/                                    # tsc output (gitignored; intermediate build artifact)
└── .github/
    ├── dependabot.yml                      # npm (daily) + github-actions (weekly) update PRs
    └── workflows/
        ├── ci.yml                          # typecheck/lint/format/test/build + self-healing dist/
        ├── codex-review.yml                # example consumer workflow (all 3 providers, dropdown)
        └── dependabot-auto-merge.yml       # gated auto-merge for Dependabot PRs
```

**Important:** `dist/` (the `@vercel/ncc` bundle) is committed to git and is what `runs.main`
actually points to and what GitHub Actions executes — consumers of this action never run
`npm install`. `lib/` (raw `tsc` output) is a gitignored intermediate step used only during the
`build` script, not shipped or referenced by anything.

## 4. Every feature, explained

### 4.1 Multi-provider support (OpenAI / Anthropic / Gemini)

Each provider implements the same `ReviewProviderClient` interface (`src/types.ts`):

```ts
export interface ReviewProviderClient {
  requestReview(params: RequestReviewParams): Promise<ReviewResult>;
}
```

`getProviderClient(provider)` in `src/providers/index.ts` is a plain switch statement returning
`new OpenAIProvider()` / `new AnthropicProvider()` / `new GeminiProvider()`, with an exhaustiveness
check (`const exhaustive: never = provider`) so adding a new `Provider` union member without
adding a case here is a compile error.

### 4.2 Provider inference from the model id

Users normally only set `model`, never `provider`. Resolution (`src/models.ts`,
`inferProviderFromModel`) works in two steps:

1. Check the curated `SUPPORTED_MODELS` list first — if the exact id is known, use its provider.
2. Otherwise fall back to a naming-convention regex so brand-new/uncurated model ids still work:
   - `/^(gpt-|o[0-9](-|$)|chatgpt-|codex-)/i` → `openai`
   - `/^claude-/i` → `anthropic`
   - `/^gemini-/i` → `gemini`
   - no match → `undefined` (caller falls back to `DEFAULT_PROVIDER`)

### 4.3 Model / provider / reasoning-effort resolution priority chains

All resolved in `src/config.ts`, each with a strict priority order:

**Provider** (`resolveProvider`):

1. Explicit `provider` input, if set and valid.
2. Inferred from `model` input or `CODEX_MODEL` env var.
3. `DEFAULT_PROVIDER` (`'openai'`).

**Model** (`resolveModel`):

1. Explicit `model` input.
2. `CODEX_MODEL` environment variable.
3. `DEFAULT_MODEL_BY_PROVIDER[provider]` (per-provider built-in default).
   - Unknown-but-plausible model ids are **allowed through with a warning**, never a hard failure —
     this means a brand-new model release from any provider works the same day it ships, without
     waiting for this project to add it to the curated list.

**Reasoning effort** (`resolveReasoningEffort`):

1. Explicit `reasoning_effort` input.
2. Default: `'medium'`.
3. Validated against `REASONING_EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high']`; invalid
   values throw `ConfigError`.

**PR number** (`resolvePullNumber`, used inside `loadConfig`):

1. `github.context.payload.pull_request.number` (present automatically on `pull_request` /
   `pull_request_target` events).
2. Parsed `pr_number` input (needed for `workflow_dispatch`, which has no PR payload).
3. Throws `ConfigError` with actionable guidance if neither is present.

**GitHub token** (inside `loadConfig`):

1. `github_token` input.
2. `GITHUB_TOKEN` environment variable.
3. Throws `ConfigError` if both are empty.

**API key** (`resolveApiKey`): looks up the input named by
`API_KEY_INPUT_BY_PROVIDER[provider]` (`openai_api_key` / `anthropic_api_key` / `gemini_api_key`)
and throws `ConfigError` if it's empty for the resolved provider. Only the key matching the
resolved provider is required — the other two inputs are simply unused for that run.

### 4.4 Curated model catalog (`src/models.ts`)

```ts
export interface ModelInfo {
  id: string;
  provider: Provider;
  label: string;
  supportsReasoningEffort?: boolean;
}
```

Current `SUPPORTED_MODELS`:

| Provider    | Models (first is that provider's default)                                  |
| ----------- | -------------------------------------------------------------------------- |
| `openai`    | `gpt-5.1-codex`, `gpt-5.1-codex-mini`, `gpt-5.1`, `gpt-5-mini`, `o4-mini`  |
| `anthropic` | `claude-opus-5`, `claude-fable-5-1`, `claude-sonnet-5`, `claude-haiku-4-5` |
| `gemini`    | `gemini-3.8-flash`, `gemini-3-pro-preview`, `gemini-2.5-flash`             |

`DEFAULT_PROVIDER = 'openai'`. `DEFAULT_MODEL_BY_PROVIDER` maps each provider to the first model
listed above for it. Helpers: `findModel(id)`, `isKnownModel(id)`, `isValidReasoningEffort(v)`,
`isValidProvider(v)`.

To add a new model: add one entry to `SUPPORTED_MODELS`. To add a new default model for an
existing provider: also update `DEFAULT_MODEL_BY_PROVIDER`. Neither is strictly required for a
model to work at all (see 4.3 — unknown models are allowed through with a warning) but curating it
gets it into the `workflow_dispatch` dropdown documentation and validated-default treatment.

### 4.5 Diff fetching and size limits (`src/github-client.ts`, `fetchDiffFiles`)

- Paginates `octokit.rest.pulls.listFiles` to collect every changed file.
- Truncates to at most `max_files` (default 60) files, reporting how many were dropped as
  `truncatedFileCount` (surfaced to the model in the prompt as a truncation note, and used to skip
  the whole review with a clear log line if it comes out to zero files).
- Any single file's `patch` longer than `max_patch_chars` (default 80,000) characters is truncated
  with a trailing `... [patch truncated at N characters]` marker rather than sent whole.
- Files with no textual diff available (binary files, or diffs GitHub didn't return a patch for)
  have their `patch` key omitted entirely rather than set to an empty/undefined placeholder string.

### 4.6 Structured JSON output via native per-provider mechanisms

All three providers are asked to return JSON conforming to the exact same schema
(`REVIEW_SCHEMA` in `src/providers/schema.ts`): `summary` (string), `overall_recommendation`
(`approve` | `comment` | `request_changes`), and `comments` (array of `{ path, line, side, severity,
body }`, `additionalProperties: false`, all fields required).

Each provider uses its own native structured-output feature rather than asking the model to "please
output JSON" in prose and hoping:

- **OpenAI** — Responses API, `text.format: { type: 'json_schema', name: 'pr_review', schema:
REVIEW_SCHEMA, strict: true }`. `strict: true` gives a hard guarantee the output matches the
  schema, so `src/providers/openai.ts`'s `extractJsonText()` can trust `response.output_text`
  directly (falling back to walking `response.output[].content[]` for an `output_text` block if
  that convenience field is absent).
- **Anthropic** — Messages API, `output_config: { effort, format: { type: 'json_schema', schema:
REVIEW_SCHEMA } }`. This is **best-effort**, not a hard guarantee, so the result is passed
  through `normalizeReview()` (see 4.7) rather than trusted blindly.
- **Gemini** — `generateContent` with `config: { responseMimeType: 'application/json',
responseJsonSchema: REVIEW_SCHEMA, thinkingConfig: { thinkingLevel } }`. Also best-effort;
  also normalized.

Reasoning/thinking effort is mapped per-provider (`src/config.ts`'s canonical
`minimal|low|medium|high` scale doesn't exist natively everywhere):

| Provider  | Mapping                                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI    | passes `minimal`/`low`/`high` straight through to `reasoning.effort`; anything else (including `medium`) defaults to `medium`. Only sent at all if `modelInfo.supportsReasoningEffort !== false`. |
| Anthropic | Claude has no `minimal` tier, so `minimal` is mapped up to `low`; `low`/`high` pass through; anything else defaults to `medium`.                                                                  |
| Gemini    | mapped onto `ThinkingLevel.MINIMAL/LOW/HIGH/MEDIUM` (default `MEDIUM`).                                                                                                                           |

### 4.7 Defensive response normalization (`src/providers/schema.ts`)

Because only OpenAI's `strict: true` gives a hard schema guarantee, `normalizeReview(parsed,
modelUsed)` defensively validates every field for all providers before constructing a
`ReviewResult`:

- `raw?.comments` must be an array (else treated as empty).
- Each comment requires `typeof c.path === 'string'`, `Number.isFinite(c.line) && c.line > 0`,
  `typeof c.body === 'string'`, and a recognized `severity` (`isValidSeverity`) — comments failing
  validation are dropped rather than crashing the run.
- `typeof raw?.summary === 'string'` (else empty string).
- `overall_recommendation` is validated against the three allowed values (else defaults to
  `'comment'`).

`parseReviewJson(rawJson, modelUsed)` wraps `JSON.parse` + `normalizeReview`, throwing a
`ProviderRequestError` (not a raw `SyntaxError`) if the provider's response isn't even valid JSON.

### 4.8 Prompt construction (`src/prompt.ts`)

- `SYSTEM_PROMPT`: frames the model as an expert code reviewer (provider-neutral — does **not**
  say "You are Codex" or name any specific vendor), and explicitly includes:
  - A prompt-injection defense paragraph: instructions to ignore any instructions embedded inside
    the diff content itself.
  - Rules to only comment on lines that are actually part of the diff, and to set `side` (`LEFT`
    for a removed/context line, `RIGHT` for an added/context line) correctly so GitHub can anchor
    the comment.
  - Priority guidance: correctness and security bugs over style nits.
  - An instruction not to pad the response with comments just to have more of them.
  - A length constraint: keep each comment to 1-3 sentences.
  - A hard requirement to respond with **only** JSON matching the schema — no prose wrapper.
- `buildUserPrompt(files, truncatedFileCount)`: renders each file as a `### filename (status,
+additions/-deletions)` header followed by a fenced diff block (or a
  `[no textual diff available — binary or too large]` placeholder for files with no patch),
  joined with blank lines, with a trailing note appended if any files were dropped due to
  `max_files`.

### 4.9 Posting results back to GitHub (`src/github-client.ts`, `postReview`)

Two post modes, controlled by the `post_mode` input:

- **`comment`** (simple): posts one plain issue comment containing the formatted summary body —
  no inline anchoring at all.
- **`review`** (default, richer): builds a formal GitHub review.
  1. Splits `result.comments` into `anchoredComments` (whose `path` exists among the PR's changed
     files) and `unanchoredComments` (paths the model hallucinated or that fell outside the diff).
  2. Unanchored comments are **not dropped** — they're folded into a collapsible `<details>` block
     inside the review body, so no feedback is silently lost even when anchoring isn't possible.
  3. `overallRecommendation` is mapped to a GitHub review `event`: `approve` → `APPROVE`,
     `request_changes` → `REQUEST_CHANGES`, `comment` → `COMMENT`.
  4. Calls `octokit.rest.pulls.createReview` with the anchored comments as inline `comments[]`.
  5. **Graceful degradation**: if `createReview` itself fails (e.g., GitHub rejects a comment's
     line/side anchor as invalid for that diff), the error is caught and the code falls back to
     posting a single plain issue comment that manually lists every anchored comment inline
     (`createIssueComment`). Only if _that_ fallback also fails does the function throw a
     `GitHubRequestError` — so a single bad anchor never causes total review loss.
- `formatSummaryBody(result)` renders the shared header/body used by both paths: a badge
  (`✅ Looks good` / `🔴 Changes requested` / `💬 Comments` based on the recommendation), the
  model's summary text, and a `<sub>Model: \`modelUsed\`</sub>` footer. The header is
**`### AI PR Review — {badge}`** — provider-neutral by design (see §7, "Codex branding bug").

### 4.10 Manual trigger with per-run model/provider choice

The example workflow (`.github/workflows/codex-review.yml`) adds a `workflow_dispatch` trigger
with two inputs:

- `pr_number` (required, `type: number`) — since manual runs have no `pull_request` payload to
  read a PR number from automatically.
- `model` (`type: choice`, default `gpt-5.1-codex`) — a dropdown listing every curated model from
  all three providers, letting a human A/B-test models/providers on the same PR from the Actions
  tab UI without touching any repository settings.

Model selection precedence for the example workflow's automatic (`pull_request`-triggered) runs:
`github.event.inputs.model` (only present on `workflow_dispatch`) → `vars.CODEX_MODEL` (a
repository/organization Actions variable) → the action's own built-in default. This is expressed
in the workflow YAML as `model: ${{ github.event.inputs.model || vars.CODEX_MODEL }}` — note this
expression lives in the **workflow file**, not in `action.yml` (see the action.yml expression
gotcha in §7).

### 4.11 `fail_on_error` toggle

Controls whether a provider API failure or a GitHub API failure should fail the whole workflow
step (`fail_on_error: true`) or just log a warning and let the step succeed
(`fail_on_error: false`, the default) — so a transient provider outage never blocks an otherwise
mergeable PR. This distinction is implemented in `run()`'s `catch` block: `ConfigError` **always**
calls `core.setFailed` regardless of this flag (a misconfiguration should never be silently
ignored), while `ProviderRequestError`/`GitHubRequestError` respect the flag.

### 4.12 Security posture

- **Never checks out an untrusted PR head.** The example workflow's checkout step always uses the
  default ref (this repo's own trusted branch); the action reads the entire diff through the
  GitHub REST API instead of needing the PR's files on disk locally. This deliberately avoids the
  classic GitHub Actions "pwn request" vulnerability pattern, where checking out `pull_request`
  head content before an `if: secrets are in scope` step lets a malicious PR exfiltrate secrets.
  This is called out explicitly in a code comment at the top of `codex-review.yml` warning future
  maintainers not to add a `ref:` override or switch the trigger to `pull_request_target` without
  understanding that risk.
- **Bring-your-own-key.** The API key never leaves the user's own GitHub Actions runner except in
  the direct HTTPS call to that provider's API — no proxying through any third-party service run
  by this project.
- **Only the diff is sent**, not the full repository contents.
- **Dependabot PRs are excluded from automatic review** (`codex-review.yml`'s job `if:` excludes
  `github.event.pull_request.user.login == 'dependabot[bot]'`), avoiding wasted API spend reviewing
  routine dependency bumps.
- **Draft PRs are skipped** on automatic (`pull_request`) triggers (`!github.event.pull_request.draft`)
  but always run on manual `workflow_dispatch` triggers.

### 4.13 Dependabot configuration + gated auto-merge

`.github/dependabot.yml`: two ecosystems — `npm` (daily, up to 10 open PRs at once) and
`github-actions` (weekly). `.github/workflows/dependabot-auto-merge.yml` only runs for PRs opened
by `dependabot[bot]`, and uses `dependabot/fetch-metadata@v3` to read the semver bump size:

- `version-update:semver-patch` or `semver-minor` → `gh pr merge --auto --squash` (unattended).
- `version-update:semver-major` → posts a PR comment flagging it for manual review instead of
  merging. This exists because of a real incident this session: an unattended major bump of
  `typescript` (5.9 → 7.0, a native rewrite) broke both the `@vercel/ncc` build and
  `typescript-eslint` (see §7) — major bumps now always need a human look first.

Both the auto-merge and the comment step authenticate with `secrets.GH_ADMIN_TOKEN` (a
fine-grained PAT with permission to bypass branch protection for auto-merge), not the default
`github.token`, because enabling auto-merge and merging typically requires elevated permissions the
default Actions token doesn't have.

### 4.14 Self-healing CI for `dist/`

Since `dist/` is committed and is literally what executes, it must always match `src/`. Rather than
only _checking_ this and asking a human to fix drift locally (see the `@vercel/ncc`
non-determinism gotcha in §7 — a local rebuild often doesn't match CI's rebuild byte-for-byte
anyway, even with identical source), `ci.yml`'s `build-and-test` job:

1. Always rebuilds `dist/` fresh (`npm run build`) as part of every run.
2. Diffs the working tree against the freshly rebuilt `dist/` (`git diff --quiet -- dist`).
3. **On push to `main`**: if `dist/` drifted, auto-commits the freshly rebuilt `dist/` right there
   on the runner (as `github-actions[bot]`, commit message `chore: rebuild dist/ [skip ci]`) and
   pushes it — self-healing, no human involved. This requires job-level
   `permissions: contents: write` (the workflow-level default is `contents: read`).
4. **On `pull_request`**: never pushes to someone else's branch. Instead fails the job with an
   `::error::` message telling the contributor to run `npm run build` locally and commit the
   result, or just merge to `main` and let CI fix it automatically.

## 5. `action.yml` — complete reference

```yaml
runs:
  using: 'node24'
  main: 'dist/index.js'
```

### Inputs

| Input               | Required | Default                      | Notes                                                                                                                                     |
| ------------------- | -------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`          | no       | `''` (inferred from `model`) | `openai` \| `anthropic` \| `gemini`                                                                                                       |
| `openai_api_key`    | no       | `''`                         | required at runtime if resolved provider is `openai`                                                                                      |
| `anthropic_api_key` | no       | `''`                         | required at runtime if resolved provider is `anthropic`                                                                                   |
| `gemini_api_key`    | no       | `''`                         | required at runtime if resolved provider is `gemini`                                                                                      |
| `github_token`      | no       | `''`                         | falls back to `GITHUB_TOKEN` env var; must be wired explicitly in the workflow (see §7 — action.yml can't self-default to `github.token`) |
| `pr_number`         | no       | `''`                         | only needed for events with no `pull_request` payload (`workflow_dispatch`); ignored on `pull_request`/`pull_request_target`              |
| `model`             | no       | `''` (resolved — see §4.3)   | e.g. `gpt-5.1-codex`, `claude-opus-5`, `gemini-3.8-flash`                                                                                 |
| `reasoning_effort`  | no       | `'medium'`                   | `minimal` \| `low` \| `medium` \| `high`                                                                                                  |
| `max_files`         | no       | `'60'`                       | max changed files sent for review                                                                                                         |
| `max_patch_chars`   | no       | `'80000'`                    | max characters of a single file's patch before truncation                                                                                 |
| `post_mode`         | no       | `'review'`                   | `review` (formal review, inline comments) or `comment` (single plain comment)                                                             |
| `fail_on_error`     | no       | `'false'`                    | if `'true'`, provider/GitHub API failures fail the step instead of warning                                                                |

### Outputs

| Output           | Description                                        |
| ---------------- | -------------------------------------------------- |
| `summary`        | overall review summary text generated by the model |
| `recommendation` | `approve` \| `comment` \| `request_changes`        |
| `comment_count`  | number of inline comments posted                   |
| `provider`       | provider actually used for this run                |
| `model`          | model actually used for this run                   |

## 6. Development

```bash
nvm use              # Node 24, per .nvmrc
npm ci
npm run typecheck     # tsc --noEmit
npm run lint          # eslint . --max-warnings=0
npm run format:check  # prettier --check . (also covers this file, CLAUDE.md)
npm test              # vitest run
npm run build         # clean -> tsc -> ncc bundle into dist/
npm run verify-dist   # build + git diff --exit-code --stat dist (see §7 for its caveats)
```

`npm run format` auto-fixes formatting; `npm run test:watch` runs Vitest in watch mode.

**Build pipeline detail** (`npm run build`): `clean` (`rm -rf dist lib`) → `tsc -p tsconfig.json`
(typechecks and emits to `lib/`, used only as an intermediate/typecheck step) → `ncc build
src/index.ts -o dist --source-map --license licenses.txt` (bundles everything, including
`node_modules` dependencies, into `dist/`, code-split into numbered chunk files alongside
`dist/index.js`).

### Testing approach

Vitest, 27 tests across 4 files, all pure unit tests (no live network calls to any provider or to
GitHub):

- `test/config.test.ts` — `resolveProvider`, `resolveModel`, `resolveReasoningEffort` priority
  chains and validation.
- `test/load-config.test.ts` — `loadConfig()`'s PR-number resolution across event types, using
  `vi.doMock('@actions/github', ...)` to fake `context.payload`.
- `test/github-client.test.ts` — `fetchDiffFiles()` exercised against a hand-built fake `Octokit`
  object (file-count truncation, patch-length truncation, binary-file patch omission).
- `test/models.test.ts` — model catalog lookups and provider-inference helpers.

### tsconfig / lint / format configuration

- `tsconfig.json`: `target`/`lib` `ES2023`, `module`/`moduleResolution` `NodeNext`, `strict: true`,
  plus the stricter-than-default `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
  `rootDir: src`, `outDir: lib`. Test files are excluded from the main compile
  (`exclude: [..., "test", "**/*.test.ts"]`) — Vitest type-checks/transpiles them itself.
- `eslint.config.js`: flat config, `@typescript-eslint` recommended rules plus
  `no-unused-vars` (allowing a leading-underscore escape hatch), `no-explicit-any` as a warning
  (not an error), `no-console: off` (this is a CLI-style action; `core.info`/`core.warning` for
  structured logging, plain `console` isn't specially restricted), Prettier conflicts disabled via
  `eslint-config-prettier`.
- `.prettierrc.json`: semicolons on, single quotes, trailing commas everywhere, 100-char print
  width, 2-space indent.

## 7. Known gotchas / lessons learned

These were each discovered the hard way while building and maintaining this project. Read this
section before touching `action.yml`, the toolchain versions, or the build pipeline.

1. **`action.yml` only supports a restricted GitHub Actions expression context — `${{ github.* }}`
   anywhere in the file breaks action resolution entirely.** Action metadata files are scanned for
   `${{ }}` expressions in every field (including free-text `description` prose, not just
   `default:` values), but only a narrow context is valid there — `github.*` is not part of it. A
   literal `${{ github.token }}` or `${{ github.event.inputs.x }}` anywhere in `action.yml`
   produces `Error: Unrecognized named-value: 'github'` and makes the **entire action** fail to
   load — not just that one input. This is why `github_token` and `pr_number` in `action.yml` are
   described in plain prose ("wire it to the `github.token` expression from your workflow") rather
   than shown as literal `${{ }}` syntax, and why they default to `''`. Any `${{ github.* }}` wiring
   belongs in the **consuming workflow YAML** (e.g. `codex-review.yml`), never in `action.yml`
   itself.
2. **TypeScript 7.x breaks this project's current build and lint toolchain.** TypeScript 7 (the
   native/Go rewrite) crashes `@vercel/ncc`'s ts-loader
   (`Cannot read properties of undefined (reading 'fileExists')`), and `typescript-eslint@8.18.0`
   explicitly refuses to run against it at all ("typescript-eslint does not support TS 7.0"). Known-
   good pin: `typescript@5.9.3`. Do not accept a Dependabot major bump of `typescript` without
   verifying `@vercel/ncc` and `typescript-eslint` support it first.
3. **ESLint 10 is outside `typescript-eslint@8`'s declared peer range.** `typescript-eslint@8.x`
   declares `peerDependencies.eslint: "^8.57.0 || ^9.0.0"` — ESLint 10 is not covered. Known-good
   pin: `eslint@9.39.5`.
4. **`@vercel/ncc`'s bundler output is not guaranteed byte-identical across build machines**, even
   with identical source and identical dependency versions — confirmed by comparing bundles built
   on cloud x86_64 Ubuntu 24.04, a local aarch64 Ubuntu 22.04 Linux VM, and a prior committed
   build: all three differed at the module-ID/chunk-splitting level despite identical application
   logic. Consequence: `npm run verify-dist` can report a spurious diff on a contributor's own
   machine even when `src/` hasn't changed at all. **Trust CI's own rebuild, not a local one** —
   this is exactly why `ci.yml` rebuilds `dist/` on every run and self-heals on `main` (§4.14)
   rather than only checking a contributor-produced `dist/` for correctness.
5. **Platform-specific optional npm dependencies can end up wrong after moving `node_modules`
   across operating systems.** Vitest 5's `rolldown` dependency installs OS/arch-specific native
   binding packages (e.g. `@rolldown/binding-darwin-arm64` vs `@rolldown/binding-linux-arm64-gnu`).
   Installing on macOS and then trying to run inside a Linux VM (or vice versa) against the same
   `node_modules` fails. Fix: `rm -rf node_modules && npm ci` from the actual machine/OS you intend
   to run on — never copy `node_modules` between platforms.
6. **A sandboxed shell may not have file-delete permission by default.** Some sandboxed execution
   environments deny `rm`/`rmdir`/`unlink` on mounted/connected folders unless permission is
   explicitly granted first — this specifically affects `npm run clean` and the `rm -rf node_modules`
   fix above when run from such an environment; the fix is to request delete permission for that
   folder before running any command that deletes files.
7. **Always confirm the current git branch before concluding `main` regressed.** A stale local
   checkout of an old Dependabot PR branch (e.g. `dependabot/npm_and_yarn/typescript-7.0.2`) can be
   mistaken for `main`, making it look like previously-applied fixes "disappeared" when in fact
   `main` was fine the whole time and the wrong branch was simply checked out. Run
   `git rev-parse --abbrev-ref HEAD` (or `git branch --show-current`) as the _first_ diagnostic
   step whenever something that was already fixed appears to be broken again — before redoing any
   work. Clean up stray local Dependabot branches with `git branch -D <name>` once their PRs are
   resolved (this only removes the local pointer, never the remote PR/branch).
8. **`core.getInput(name, { required: true })` throws immediately on an empty value**, which
   short-circuits any `||` fallback chained after that same call — e.g.
   `core.getInput('github_token', { required: true }) || process.env.GITHUB_TOKEN` never reaches
   the environment-variable fallback, because the empty-input case throws before `||` is even
   evaluated. Never combine `{ required: true }` with a fallback expression on the same line; do
   the fallback chain first, and only throw a custom, more actionable `ConfigError` at the end if
   every fallback came up empty (this is exactly what `loadConfig()`'s `github_token` resolution
   does today).
9. **`ReviewResult` intentionally does not carry a `provider` field** (only `modelUsed`) — a
   previous version of `formatSummaryBody()` hardcoded `### Codex PR Review` in the review header
   regardless of which provider actually ran, which was misleading when using Claude or Gemini.
   The header is now the provider-neutral `### AI PR Review`, matching `action.yml`'s own `name`
   field; the specific model used is still shown in the body's `<sub>Model: ...</sub>` footer. If a
   future change wants the provider name in the header too, `provider` needs to be threaded through
   from `RequestReviewParams`/`ActionConfig` into `ReviewResult` first — it isn't there today.

## 8. Adding a new provider (checklist)

1. Create `src/providers/<name>.ts` implementing `ReviewProviderClient`, using
   `src/providers/schema.ts`'s `REVIEW_SCHEMA` and `parseReviewJson`/`normalizeReview` for output
   handling, and `src/prompt.ts` for the system/user prompt.
2. Add a `case` for it in `getProviderClient` (`src/providers/index.ts`) and add the provider name
   to the `Provider` union in `src/types.ts`.
3. Add its models to `SUPPORTED_MODELS` and a default entry to `DEFAULT_MODEL_BY_PROVIDER` in
   `src/models.ts`; extend `inferProviderFromModel`'s regex fallback if it has a distinct naming
   convention.
4. Add its API key input to `action.yml` (`<name>_api_key`) and to `API_KEY_INPUT_BY_PROVIDER` in
   `src/config.ts`.
5. Add it to the `workflow_dispatch` `model` dropdown in `.github/workflows/codex-review.yml` and
   as a new "CI examples by provider" block in `README.md`.
6. Add/extend tests covering its resolution and inference behavior.
