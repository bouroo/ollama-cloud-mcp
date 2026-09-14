import type { OllamaWebPort } from "../interfaces/OllamaWebPort.js";
import { OllamaWebError } from "../domain/errors.js";
import { clampMaxResults, type WebSearchResponse } from "../domain/web.js";
import { parseSearchResponse } from "./parseResponses.js";

/**
 * Validate the query, clamp `maxResults`, ask the port for the raw payload and
 * shape it into a `WebSearchResponse`.
 */
export async function searchWeb(
  port: OllamaWebPort,
  query: string,
  maxResults?: number,
): Promise<WebSearchResponse> {
  const trimmed = query.trim();
  if (trimmed === "") {
    throw new OllamaWebError("query must not be empty.");
  }

  return parseSearchResponse(await port.search(trimmed, clampMaxResults(maxResults)));
}
