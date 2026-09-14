import type { OllamaWebPort } from "../interfaces/OllamaWebPort.js";
import { normalizeTargetUrl, type WebFetchResponse } from "../domain/web.js";
import { parseFetchResponse } from "./parseResponses.js";

/** Normalize the target URL, ask the port for the raw payload and shape it into a `WebFetchResponse`. */
export async function fetchPage(port: OllamaWebPort, url: string): Promise<WebFetchResponse> {
  return parseFetchResponse(await port.fetchPage(normalizeTargetUrl(url)));
}
