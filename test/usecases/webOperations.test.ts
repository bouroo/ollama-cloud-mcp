import { describe, expect, test } from "bun:test";

import { DEFAULT_MAX_RESULTS } from "../../src/domain/web.js";
import type { OllamaWebPort } from "../../src/interfaces/OllamaWebPort.js";
import { fetchPage } from "../../src/usecases/fetchPage.js";
import { searchWeb } from "../../src/usecases/searchWeb.js";

type PortCall =
  | { method: "search"; query: string; maxResults: number }
  | { method: "fetchPage"; url: string };

/** Stand-in for the real client: records what the use case asked for, returns a canned payload. */
function stubPort(payload: unknown): { port: OllamaWebPort; calls: PortCall[] } {
  const calls: PortCall[] = [];
  const port: OllamaWebPort = {
    async search(query, maxResults) {
      calls.push({ method: "search", query, maxResults });
      return payload;
    },
    async fetchPage(url) {
      calls.push({ method: "fetchPage", url });
      return payload;
    },
  };
  return { port, calls };
}

describe("searchWeb", () => {
  test("trims the query and clamps max_results before the port sees them", async () => {
    const { port, calls } = stubPort({ results: [] });

    await searchWeb(port, "  spaced  ", 50);

    expect(calls).toEqual([{ method: "search", query: "spaced", maxResults: 10 }]);
  });

  test("applies the default max_results when none is given", async () => {
    const { port, calls } = stubPort({ results: [] });

    await searchWeb(port, "ollama");

    expect(calls).toEqual([{ method: "search", query: "ollama", maxResults: DEFAULT_MAX_RESULTS }]);
  });

  test("shapes a raw payload into results", async () => {
    const { port } = stubPort({
      results: [{ title: "Ollama", url: "https://ollama.com/", content: "excerpt" }],
    });

    await expect(searchWeb(port, "ollama")).resolves.toEqual({
      results: [{ title: "Ollama", url: "https://ollama.com/", content: "excerpt" }],
    });
  });

  test("rejects a malformed payload", async () => {
    const { port } = stubPort({ results: "nope" });

    await expect(searchWeb(port, "ollama")).rejects.toThrow(/did not include a results array/);
  });

  test("rejects an empty query without reaching the port", async () => {
    const { port, calls } = stubPort({ results: [] });

    await expect(searchWeb(port, "   ")).rejects.toThrow(/query must not be empty/);
    expect(calls).toHaveLength(0);
  });
});

describe("fetchPage", () => {
  test("normalizes a schemeless url before the port sees it", async () => {
    const { port, calls } = stubPort({ title: "t", content: "c", links: [] });

    await fetchPage(port, "ollama.com");

    expect(calls).toEqual([{ method: "fetchPage", url: "https://ollama.com/" }]);
  });

  test("normalizes a missing links array to an empty one", async () => {
    const { port } = stubPort({ title: "t", content: "c" });

    await expect(fetchPage(port, "https://example.com")).resolves.toEqual({
      title: "t",
      content: "c",
      links: [],
    });
  });

  test("rejects a non-http scheme without reaching the port", async () => {
    const { port, calls } = stubPort({});

    await expect(fetchPage(port, "file:///etc/passwd")).rejects.toThrow(/only http and https/);
    expect(calls).toHaveLength(0);
  });
});
