export const DEFAULT_BASE_URL = "https://ollama.com";

export type OllamaConfig = {
  baseUrl: string;
  apiKey?: string;
  /** True when baseUrl came from OLLAMA_HOST rather than the hosted default. */
  customHost: boolean;
};

export function resolveConfig(env: Record<string, string | undefined>): OllamaConfig {
  const rawHost = env.OLLAMA_HOST?.trim() ?? "";
  const apiKey = env.OLLAMA_API_KEY?.trim() ?? "";
  const customHost = rawHost !== "";

  const config: OllamaConfig = {
    baseUrl: customHost ? normalizeBaseUrl(rawHost) : DEFAULT_BASE_URL,
    customHost,
  };
  if (apiKey !== "") {
    config.apiKey = apiKey;
  }
  return config;
}

/** Bare `host[:port]` values get an http:// scheme, matching Ollama's own OLLAMA_HOST convention. */
export function normalizeBaseUrl(rawHost: string): string {
  const trimmed = rawHost.trim().replace(/\/+$/, "");
  if (trimmed === "") {
    return DEFAULT_BASE_URL;
  }
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}
