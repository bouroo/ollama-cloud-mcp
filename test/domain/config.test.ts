import { describe, expect, test } from "bun:test";

import { DEFAULT_BASE_URL, normalizeBaseUrl, resolveConfig } from "../../src/domain/config.js";

describe("normalizeBaseUrl", () => {
  test("keeps a value that already carries a scheme", () => {
    expect(normalizeBaseUrl("https://ollama.com")).toBe("https://ollama.com");
    expect(normalizeBaseUrl("http://localhost:11434")).toBe("http://localhost:11434");
  });

  test("adds http:// to a bare host:port, matching Ollama's OLLAMA_HOST convention", () => {
    expect(normalizeBaseUrl("127.0.0.1:11434")).toBe("http://127.0.0.1:11434");
  });

  test("strips trailing slashes and surrounding whitespace", () => {
    expect(normalizeBaseUrl("  http://localhost:11434/  ")).toBe("http://localhost:11434");
  });

  test("falls back to the hosted default when empty", () => {
    expect(normalizeBaseUrl("   ")).toBe(DEFAULT_BASE_URL);
  });
});

describe("resolveConfig", () => {
  test("defaults to the hosted API with no key", () => {
    expect(resolveConfig({})).toEqual({ baseUrl: DEFAULT_BASE_URL, customHost: false });
  });

  test("reads OLLAMA_API_KEY and trims it", () => {
    expect(resolveConfig({ OLLAMA_API_KEY: "  secret  " }).apiKey).toBe("secret");
  });

  test("reads OLLAMA_HOST and marks it custom", () => {
    const config = resolveConfig({ OLLAMA_HOST: "127.0.0.1:11434" });
    expect(config).toEqual({
      baseUrl: "http://127.0.0.1:11434",
      apiKey: undefined,
      customHost: true,
    });
  });
});
