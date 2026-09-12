/**
 * Client for Ollama's hosted web search and web fetch endpoints.
 *
 * @see https://docs.ollama.com/capabilities/web-search
 */

export const DEFAULT_BASE_URL = "https://ollama.com";
export const DEFAULT_MAX_RESULTS = 5;
export const MAX_MAX_RESULTS = 10;

const DEFAULT_TIMEOUT_MS = 30_000;
const ERROR_DETAIL_LIMIT = 500;
const KEY_URL = "https://ollama.com/settings/keys";

export const MISSING_API_KEY_MESSAGE =
  `OLLAMA_API_KEY is not set. Create a free key at ${KEY_URL} and export it, ` +
  "or point OLLAMA_HOST at a signed-in local Ollama daemon.";

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

export type OllamaConfig = {
  baseUrl: string;
  apiKey?: string;
  /** True when baseUrl came from OLLAMA_HOST rather than the hosted default. */
  customHost: boolean;
};

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type OllamaClientOptions = {
  config: OllamaConfig;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

export class OllamaWebError extends Error {
  readonly status?: number;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "OllamaWebError";
    this.status = options.status;
  }
}

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

export class OllamaWebClient {
  readonly #baseUrl: string;
  readonly #apiKey: string | undefined;
  readonly #customHost: boolean;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  constructor({ config, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS }: OllamaClientOptions) {
    this.#baseUrl = config.baseUrl;
    this.#apiKey = config.apiKey;
    this.#customHost = config.customHost;
    this.#timeoutMs = timeoutMs;

    const impl = fetchImpl ?? globalThis.fetch;
    this.#fetch = (input, init) => impl(input, init);
  }

  get baseUrl(): string {
    return this.#baseUrl;
  }

  async webSearch(query: string, maxResults?: number): Promise<WebSearchResponse> {
    const trimmed = query.trim();
    if (trimmed === "") {
      throw new OllamaWebError("query must not be empty.");
    }

    const payload = await this.#post("/api/web_search", {
      query: trimmed,
      max_results: clampMaxResults(maxResults),
    });
    return parseSearchResponse(payload);
  }

  async webFetch(url: string): Promise<WebFetchResponse> {
    const payload = await this.#post("/api/web_fetch", { url: normalizeTargetUrl(url) });
    return parseFetchResponse(payload);
  }

  async #post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const url = `${this.#baseUrl}${path}`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };

    if (this.#apiKey !== undefined) {
      headers.authorization = `Bearer ${this.#apiKey}`;
    } else if (!this.#customHost) {
      throw new OllamaWebError(MISSING_API_KEY_MESSAGE);
    }

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (cause) {
      throw new OllamaWebError(describeTransportFailure(cause, url, this.#timeoutMs), { cause });
    }

    if (!response.ok) {
      throw new OllamaWebError(await describeHttpFailure(response, path), {
        status: response.status,
      });
    }

    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch (cause) {
      throw new OllamaWebError(
        `Ollama returned a non-JSON response from ${path} (HTTP ${response.status}).`,
        { status: response.status, cause },
      );
    }
  }
}

function describeTransportFailure(cause: unknown, url: string, timeoutMs: number): string {
  if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
    return `Ollama did not respond within ${timeoutMs}ms (${url}).`;
  }
  return `Could not reach Ollama at ${url}: ${errorMessage(cause)}. Check your network connection and OLLAMA_HOST.`;
}

async function describeHttpFailure(response: Response, path: string): Promise<string> {
  const detail = await readErrorDetail(response);
  const status = `HTTP ${response.status}${response.statusText === "" ? "" : ` ${response.statusText}`}`;
  const summary = `Ollama ${path} failed with ${status}`;

  if (response.status === 401 || response.status === 403) {
    return `${summary}. The API key was rejected — check that OLLAMA_API_KEY holds a valid key from ${KEY_URL}.${detail}`;
  }
  if (response.status === 429) {
    return `${summary}. Rate limited by Ollama — wait a moment and retry, or request fewer results.${detail}`;
  }
  if (response.status >= 500) {
    return `${summary}. Ollama reported a server error — retry shortly.${detail}`;
  }
  return `${summary}.${detail}`;
}

async function readErrorDetail(response: Response): Promise<string> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return "";
  }

  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed === "") {
    return "";
  }
  const clipped =
    collapsed.length > ERROR_DETAIL_LIMIT ? `${collapsed.slice(0, ERROR_DETAIL_LIMIT)}…` : collapsed;
  return ` Response body: ${clipped}`;
}

function parseSearchResponse(payload: unknown): WebSearchResponse {
  const results = asRecord(payload)?.results;
  if (!Array.isArray(results)) {
    throw new OllamaWebError("Ollama's web_search response did not include a results array.");
  }

  return {
    results: results.map((entry) => {
      const record = asRecord(entry);
      return {
        title: asString(record?.title),
        url: asString(record?.url),
        content: asString(record?.content),
      };
    }),
  };
}

function parseFetchResponse(payload: unknown): WebFetchResponse {
  const record = asRecord(payload);
  if (record === undefined) {
    throw new OllamaWebError("Ollama's web_fetch response was not a JSON object.");
  }

  const links = record.links;
  return {
    title: asString(record.title),
    content: asString(record.content),
    links: Array.isArray(links) ? links.map(asString).filter((link) => link !== "") : [],
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
