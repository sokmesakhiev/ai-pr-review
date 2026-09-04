export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Thrown by any provider client (OpenAI, Anthropic, Gemini) on API failure. */
export class ProviderRequestError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderRequestError';
  }
}

export class GitHubRequestError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'GitHubRequestError';
  }
}
