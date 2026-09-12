import type { FetchLike, OllamaConfig } from "../src/ollama.js";
import { DEFAULT_BASE_URL } from "../src/ollama.js";

export type RecordedCall = { url: string; init: RequestInit };

export type Recorder = {
  fetchImpl: FetchLike;
  calls: RecordedCall[];
};

export function recordingFetch(respond: (url: string, init: RequestInit) => Response): Recorder {
  const calls: RecordedCall[] = [];

  const fetchImpl: FetchLike = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const requestInit = init ?? {};
    calls.push({ url, init: requestInit });
    return respond(url, requestInit);
  };

  return { fetchImpl, calls };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

export const CLOUD_CONFIG: OllamaConfig = {
  baseUrl: DEFAULT_BASE_URL,
  apiKey: "test-key",
  customHost: false,
};

export function bodyOf(call: RecordedCall | undefined): Record<string, unknown> {
  if (call === undefined) {
    throw new Error("expected a recorded fetch call, found none");
  }
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

export function headersOf(call: RecordedCall | undefined): Record<string, string> {
  if (call === undefined) {
    throw new Error("expected a recorded fetch call, found none");
  }
  return (call.init.headers ?? {}) as Record<string, string>;
}
