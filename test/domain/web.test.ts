import { describe, expect, test } from "bun:test";

import { DEFAULT_MAX_RESULTS, clampMaxResults, normalizeTargetUrl } from "../../src/domain/web.js";

describe("normalizeTargetUrl", () => {
  test("accepts schemeless input the way the Ollama docs do", () => {
    expect(normalizeTargetUrl("ollama.com")).toBe("https://ollama.com/");
  });

  test("preserves an explicit http scheme, including a port", () => {
    expect(normalizeTargetUrl("http://localhost:8080/x")).toBe("http://localhost:8080/x");
  });

  test("preserves query strings", () => {
    expect(normalizeTargetUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
  });

  test("rejects an empty value", () => {
    expect(() => normalizeTargetUrl("   ")).toThrow(/url must not be empty/);
  });

  test("rejects non-http schemes", () => {
    expect(() => normalizeTargetUrl("file:///etc/passwd")).toThrow(/only http and https/);
  });

  test("rejects input that is not a URL at all", () => {
    expect(() => normalizeTargetUrl("not a url")).toThrow(/is not a valid URL/);
  });
});

describe("clampMaxResults", () => {
  test("defaults when absent or non-finite", () => {
    expect(clampMaxResults(undefined)).toBe(DEFAULT_MAX_RESULTS);
    expect(clampMaxResults(Number.NaN)).toBe(DEFAULT_MAX_RESULTS);
  });

  test("clamps into the documented 1-10 range", () => {
    expect(clampMaxResults(0)).toBe(1);
    expect(clampMaxResults(3)).toBe(3);
    expect(clampMaxResults(50)).toBe(10);
    expect(clampMaxResults(7.9)).toBe(7);
  });
});
