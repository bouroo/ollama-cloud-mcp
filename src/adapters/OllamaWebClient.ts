/**
 * Client for Ollama's hosted web search and web fetch endpoints.
 *
 * @see https://docs.ollama.com/capabilities/web-search
 */
import { KEY_URL, MISSING_API_KEY_MESSAGE, OllamaWebError } from "../domain/errors.js";
import type { OllamaConfig } from "../domain/config.js";
import type { WebFetchResponse, WebSearchResponse } from "../domain/web.js";
import type { OllamaWebPort } from "../interfaces/OllamaWebPort.js";
import { fetchPage } from "../usecases/fetchPage.js";
import { searchWeb } from "../usecases/searchWeb.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const ERROR_DETAIL_LIMIT = 500;

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type OllamaClientOptions = {
  config: OllamaConfig;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

export class OllamaWebClient implements OllamaWebPort {
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
    return searchWeb(this, query, maxResults);
  }

  async webFetch(url: string): Promise<WebFetchResponse> {
    return fetchPage(this, url);
  }

  /** Port seam: Ollama's payload, raw and unvalidated — `searchWeb` owns the shaping. */
  async search(query: string, maxResults: number): Promise<unknown> {
    return this.#post("/api/web_search", { query, max_results: maxResults });
  }

  /** Port seam: Ollama's payload, raw and unvalidated — `fetchPage` owns the shaping. */
  async fetchPage(url: string): Promise<unknown> {
    return this.#post("/api/web_fetch", { url });
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
