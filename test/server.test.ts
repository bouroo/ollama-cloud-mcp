import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { DEFAULT_BASE_URL, OllamaWebClient, type OllamaConfig } from "../src/ollama.js";
import { createServer } from "../src/server.js";
import { CLOUD_CONFIG, jsonResponse, recordingFetch, type Recorder } from "./helpers.js";

const NO_KEY_CONFIG: OllamaConfig = { baseUrl: DEFAULT_BASE_URL, customHost: false };

type Harness = {
  mcp: Client;
  recorder: Recorder;
  close: () => Promise<void>;
};

async function harness(
  respond: (url: string, init: RequestInit) => Response,
  config: OllamaConfig = CLOUD_CONFIG,
): Promise<Harness> {
  const recorder = recordingFetch(respond);
  const server = createServer(
    new OllamaWebClient({ config, fetchImpl: recorder.fetchImpl }),
    "0.0.0-test",
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const mcp = new Client({ name: "test-client", version: "1.0.0" });
  await mcp.connect(clientTransport);

  return {
    mcp,
    recorder,
    close: async () => {
      await mcp.close();
      await server.close();
    },
  };
}

const SEARCH_PAYLOAD = {
  results: [
    { title: "Ollama", url: "https://ollama.com/", content: "Cloud models are now available." },
    { title: "What is Ollama?", url: "https://example.com/what-is-ollama", content: "An introduction." },
  ],
};

describe("tool registration", () => {
  test("exposes exactly web_search and web_fetch", async () => {
    const { mcp, close } = await harness(() => jsonResponse(SEARCH_PAYLOAD));
    try {
      const { tools } = await mcp.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(["web_fetch", "web_search"]);
    } finally {
      await close();
    }
  });

  test("declares the inputs and output schemas clients rely on", async () => {
    const { mcp, close } = await harness(() => jsonResponse(SEARCH_PAYLOAD));
    try {
      const { tools } = await mcp.listTools();
      const search = tools.find((tool) => tool.name === "web_search");
      const fetch = tools.find((tool) => tool.name === "web_fetch");

      expect(search?.inputSchema.required).toContain("query");
      expect(search?.outputSchema?.properties?.results).toBeDefined();
      expect(fetch?.inputSchema.required).toContain("url");
      expect(fetch?.outputSchema?.properties?.links).toBeDefined();
      expect(search?.annotations?.readOnlyHint).toBe(true);
    } finally {
      await close();
    }
  });
});

describe("web_search over the MCP protocol", () => {
  test("returns readable text plus structured content", async () => {
    const { mcp, recorder, close } = await harness(() => jsonResponse(SEARCH_PAYLOAD));
    try {
      const result = await mcp.callTool({ name: "web_search", arguments: { query: "what is ollama?" } });

      expect(result.isError).toBeFalsy();
      const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
      expect(text).toContain('Web search results for "what is ollama?" (2):');
      expect(text).toContain("[1] Ollama");
      expect(text).toContain("URL: https://ollama.com/");
      expect(text).toContain("Cloud models are now available.");
      expect(result.structuredContent).toEqual(SEARCH_PAYLOAD);

      expect(recorder.calls[0]?.url).toBe("https://ollama.com/api/web_search");
    } finally {
      await close();
    }
  });

  test("surfaces a missing API key as a tool error, not a crash", async () => {
    const { mcp, recorder, close } = await harness(() => jsonResponse(SEARCH_PAYLOAD), NO_KEY_CONFIG);
    try {
      const result = await mcp.callTool({ name: "web_search", arguments: { query: "anything" } });

      expect(result.isError).toBe(true);
      const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
      expect(text).toContain("OLLAMA_API_KEY");
      expect(recorder.calls).toHaveLength(0);
    } finally {
      await close();
    }
  });

  test("reports an empty result set without claiming an error", async () => {
    const { mcp, close } = await harness(() => jsonResponse({ results: [] }));
    try {
      const result = await mcp.callTool({ name: "web_search", arguments: { query: "zzzz" } });

      expect(result.isError).toBeFalsy();
      const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
      expect(text).toBe('No web results found for "zzzz".');
    } finally {
      await close();
    }
  });

  test("rejects out-of-range max_results at the schema boundary", async () => {
    const { mcp, recorder, close } = await harness(() => jsonResponse(SEARCH_PAYLOAD));
    try {
      const result = await mcp.callTool({
        name: "web_search",
        arguments: { query: "x", max_results: 99 },
      });

      expect(result.isError).toBe(true);
      expect(recorder.calls).toHaveLength(0);
    } finally {
      await close();
    }
  });
});

describe("web_fetch over the MCP protocol", () => {
  test("returns the page title, content and links", async () => {
    const { mcp, recorder, close } = await harness(() =>
      jsonResponse({
        title: "Ollama",
        content: "Cloud models are now available in Ollama.",
        links: ["http://ollama.com/", "https://github.com/ollama/ollama"],
      }),
    );
    try {
      const result = await mcp.callTool({ name: "web_fetch", arguments: { url: "ollama.com" } });

      expect(result.isError).toBeFalsy();
      const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
      expect(text).toContain("Fetched ollama.com");
      expect(text).toContain("Title: Ollama");
      expect(text).toContain("Cloud models are now available in Ollama.");
      expect(text).toContain("Links (2):");
      expect(text).toContain("- https://github.com/ollama/ollama");

      expect(recorder.calls[0]?.url).toBe("https://ollama.com/api/web_fetch");
    } finally {
      await close();
    }
  });

  test("rejects a non-http scheme as a tool error without fetching", async () => {
    const { mcp, recorder, close } = await harness(() => jsonResponse({}));
    try {
      const result = await mcp.callTool({ name: "web_fetch", arguments: { url: "file:///etc/passwd" } });

      expect(result.isError).toBe(true);
      expect((result.content as { type: string; text: string }[])[0]?.text).toContain("only http and https");
      expect(recorder.calls).toHaveLength(0);
    } finally {
      await close();
    }
  });
});
