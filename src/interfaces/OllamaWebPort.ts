/**
 * The outbound contract the use cases depend on.
 *
 * Both methods return Ollama's payload **raw and unvalidated**: shaping it is the
 * caller's job, which is what keeps the use-case tier free of any transport
 * detail — paths, verbs, headers and HTTP-status mapping all stay in the adapter.
 */
export interface OllamaWebPort {
  /** Raw payload from Ollama's `/api/web_search` endpoint. */
  search(query: string, maxResults: number): Promise<unknown>;
  /** Raw payload from Ollama's `/api/web_fetch` endpoint. */
  fetchPage(url: string): Promise<unknown>;
}
