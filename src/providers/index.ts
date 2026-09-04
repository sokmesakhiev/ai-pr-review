import { ConfigError } from '../errors.js';
import type { Provider, ReviewProviderClient } from '../types.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openai.js';

export function getProviderClient(provider: Provider): ReviewProviderClient {
  switch (provider) {
    case 'openai':
      return new OpenAIProvider();
    case 'anthropic':
      return new AnthropicProvider();
    case 'gemini':
      return new GeminiProvider();
    default: {
      const exhaustive: never = provider;
      throw new ConfigError(`Unknown provider "${String(exhaustive)}".`);
    }
  }
}
