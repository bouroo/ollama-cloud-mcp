import { OllamaWebError } from "./errors.js";

export const DEFAULT_MAX_RESULTS = 5;
export const MAX_MAX_RESULTS = 10;

export type WebSearchResult = {
  title: string;
  url: string;
  content: string;
};

export type WebSearchResponse = {
  results: WebSearchResult[];
};

export type WebFetchResponse = {
  title: string;
  content: string;
  links: string[];
};

/** Accepts schemeless input such as `ollama.com`, as the Ollama docs themselves use. */
export function normalizeTargetUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new OllamaWebError("url must not be empty.");
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new OllamaWebError(`"${input}" is not a valid URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new OllamaWebError(
      `Refusing to fetch "${input}": only http and https URLs are supported.`,
    );
  }

  return parsed.toString();
}

export function clampMaxResults(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESULTS;
  }
  return Math.min(MAX_MAX_RESULTS, Math.max(1, Math.trunc(value)));
}
