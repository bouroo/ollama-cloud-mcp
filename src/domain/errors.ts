/** Where a user creates the API key the hosted API needs. */
export const KEY_URL = "https://ollama.com/settings/keys";

export const MISSING_API_KEY_MESSAGE =
  `OLLAMA_API_KEY is not set. Create a free key at ${KEY_URL} and export it, ` +
  "or point OLLAMA_HOST at a signed-in local Ollama daemon.";

export class OllamaWebError extends Error {
  readonly status?: number;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "OllamaWebError";
    this.status = options.status;
  }
}
