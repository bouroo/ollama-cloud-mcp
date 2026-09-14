import type { WebFetchResponse, WebSearchResponse } from "../domain/web.js";
import { OllamaWebError } from "../domain/errors.js";

export function parseSearchResponse(payload: unknown): WebSearchResponse {
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

export function parseFetchResponse(payload: unknown): WebFetchResponse {
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
