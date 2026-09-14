import { describe, expect, test } from "bun:test";

import { OllamaWebClient } from "../../src/adapters/OllamaWebClient.js";
import { DEFAULT_BASE_URL, type OllamaConfig } from "../../src/domain/config.js";
import { MISSING_API_KEY_MESSAGE } from "../../src/domain/errors.js";
import { DEFAULT_MAX_RESULTS } from "../../src/domain/web.js";
import {
  CLOUD_CONFIG,
  bodyOf,
  headersOf,
  jsonResponse,
  recordingFetch,
  textResponse,
} from "../helpers.js";

const LOCAL_CONFIG: OllamaConfig = {
  baseUrl: "http://127.0.0.1:11434",
  customHost: true,
};

describe("OllamaWebClient.webSearch", () => {
  test("posts the query to /api/web_search with the bearer token", async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse({ results: [] }));
    await new OllamaWebClient({ config: CLOUD_CONFIG, fetchImpl }).webSearch("what is ollama?");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://ollama.com/api/web_search");
    expect(calls[0]?.init.method).toBe("POST");
    expect(headersOf(calls[0]).authorization).toBe("Bearer test-key");
    expect(bodyOf(calls[0])).toEqual({ query: "what is ollama?", max_results: DEFAULT_MAX_RESULTS });
  });

  test("honours max_results and trims the query", async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse({ results: [] }));
    await new OllamaWebClient({ config: CLOUD_CONFIG, fetchImpl }).webSearch("  spaced  ", 10);

    expect(bodyOf(calls[0])).toEqual({ query: "spaced", max_results: 10 });
  });

  test("parses results into title, url and content", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        results: [
          { title: "Ollama", url: "https://ollama.com/", content: "Cloud models are now available." },
        ],
      }),
    );

    const response = await new OllamaWebClient({ config: CLOUD_CONFIG, fetchImpl }).webSearch("ollama");

    expect(response).toEqual({
      results: [
        { title: "Ollama", url: "https://ollama.com/", content: "Cloud models are now available." },
      ],
    });
  });

  test("tolerates missing fields and an empty result set", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({ results: [{}] }));
    const response = await new OllamaWebClient({ config: CLOUD_CONFIG, fetchImpl }).webSearch("x");

    expect(response.results).toEqual([{ title: "", url: "", content: "" }]);
  });

  test("rejects an empty query before reaching the network", async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse({ results: [] }));
    const client = new OllamaWebClient({ config: CLOUD_CONFIG, fetchImpl });

    await expect(client.webSearch("   ")).rejects.toThrow(/query must not be empty/);
    expect(calls).toHaveLength(0);
  });

  test("reports a rejected API key actionably", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({ error: "unauthorized" }, 401));
    const client = new OllamaWebClient({ config: CLOUD_CONFIG, fetchImpl });

    const error = await client.webSearch("x").catch((cause: unknown) => cause);
    expect(error).toMatchObject({ name: "OllamaWebError", status: 401 });
    expect(String((error as Error).message)).toContain("OLLAMA_API_KEY");
    expect(String((error as Error).message)).toContain("unauthorized");
  });

  test("reports rate limiting by status, not by message text", async () => {
    const { fetchImpl } = recordingFetch(() => textResponse("slow down", 429));
    const client = new OllamaWebClient({ config: CLOUD_CONFIG, fetchImpl });

    await expect(client.webSearch("x")).rejects.toThrow(/Rate limited by Ollama/);
  });

  test("reports a server error with the body attached", async () => {
    const { fetchImpl } = recordingFetch(() => textResponse("boom", 503));
    const client = new OllamaWebClient({ config: CLOUD_CONFIG, fetchImpl });

    await expect(client.webSearch("x")).rejects.toThrow(/server error.*boom/);
  });

  test("reports a non-JSON success body", async () => {
    const { fetchImpl } = recordingFetch(() => textResponse("<html>nope</html>", 200));
    const client = new OllamaWebClient({ config: CLOUD_CONFIG, fetchImpl });

    await expect(client.webSearch("x")).rejects.toThrow(/non-JSON response/);
  });

  test("reports a malformed payload shape", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({ results: "nope" }));
    const client = new OllamaWebClient({ config: CLOUD_CONFIG, fetchImpl });

    await expect(client.webSearch("x")).rejects.toThrow(/did not include a results array/);
  });

  test("maps an aborted request to a timeout message", async () => {
    const { fetchImpl } = recordingFetch(() => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    });
    const client = new OllamaWebClient({ config: CLOUD_CONFIG, fetchImpl, timeoutMs: 5000 });

    await expect(client.webSearch("x")).rejects.toThrow(/did not respond within 5000ms/);
  });

  test("reports an unreachable host", async () => {
    const { fetchImpl } = recordingFetch(() => {
      throw new Error("connect ECONNREFUSED");
    });
    const client = new OllamaWebClient({ config: CLOUD_CONFIG, fetchImpl });

    await expect(client.webSearch("x")).rejects.toThrow(/Could not reach Ollama.*ECONNREFUSED/);
  });
});

describe("OllamaWebClient authentication", () => {
  test("refuses the hosted API without a key, without calling the network", async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse({ results: [] }));
    const client = new OllamaWebClient({
      config: { baseUrl: DEFAULT_BASE_URL, customHost: false },
      fetchImpl,
    });

    await expect(client.webSearch("x")).rejects.toThrow(MISSING_API_KEY_MESSAGE);
    expect(calls).toHaveLength(0);
  });

  test("allows a custom host to authenticate on its own", async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse({ results: [] }));
    const client = new OllamaWebClient({ config: LOCAL_CONFIG, fetchImpl });

    await client.webSearch("x");

    expect(calls[0]?.url).toBe("http://127.0.0.1:11434/api/web_search");
    expect(headersOf(calls[0]).authorization).toBeUndefined();
  });

  test("sends the key to a custom host when one is configured", async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse({ results: [] }));
    const client = new OllamaWebClient({
      config: { ...LOCAL_CONFIG, apiKey: "local-key" },
      fetchImpl,
    });

    await client.webSearch("x");

    expect(headersOf(calls[0]).authorization).toBe("Bearer local-key");
  });
});

describe("OllamaWebClient.webFetch", () => {
  test("normalizes a schemeless url before sending it", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({ title: "Ollama", content: "text", links: [] }),
    );

    await new OllamaWebClient({ config: CLOUD_CONFIG, fetchImpl }).webFetch("ollama.com");

    expect(calls[0]?.url).toBe("https://ollama.com/api/web_fetch");
    expect(bodyOf(calls[0])).toEqual({ url: "https://ollama.com/" });
  });

  test("parses title, content and links", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        title: "Ollama",
        content: "Cloud models are now available in Ollama.",
        links: ["http://ollama.com/", "https://github.com/ollama/ollama"],
      }),
    );

    const response = await new OllamaWebClient({ config: CLOUD_CONFIG, fetchImpl }).webFetch("ollama.com");

    expect(response).toEqual({
      title: "Ollama",
      content: "Cloud models are now available in Ollama.",
      links: ["http://ollama.com/", "https://github.com/ollama/ollama"],
    });
  });

  test("normalizes a missing links array to an empty one", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({ title: "t", content: "c" }));
    const response = await new OllamaWebClient({ config: CLOUD_CONFIG, fetchImpl }).webFetch("x.com");

    expect(response.links).toEqual([]);
  });

  test("rejects a non-http scheme without calling the network", async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse({}));
    const client = new OllamaWebClient({ config: CLOUD_CONFIG, fetchImpl });

    await expect(client.webFetch("file:///etc/passwd")).rejects.toThrow(/only http and https/);
    expect(calls).toHaveLength(0);
  });
});
