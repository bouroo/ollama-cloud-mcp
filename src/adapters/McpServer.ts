import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { OllamaWebError } from "../domain/errors.js";
import { DEFAULT_MAX_RESULTS, MAX_MAX_RESULTS } from "../domain/web.js";
import type { WebFetchResponse, WebSearchResponse } from "../domain/web.js";
import type { OllamaWebClient } from "./OllamaWebClient.js";

export const SERVER_NAME = "ollama-cloud-mcp";

export function createServer(client: OllamaWebClient, version: string): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version });

  server.registerTool(
    "web_search",
    {
      title: "Web Search",
      description:
        "Search the web and return ranked results with titles, URLs and content excerpts. " +
        "Use it for information beyond your training cutoff: news, releases, prices, current documentation. " +
        `Returns up to ${MAX_MAX_RESULTS} results (default ${DEFAULT_MAX_RESULTS}).`,
      inputSchema: {
        query: z.string().min(1).describe('The search query, for example "what is ollama?".'),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(MAX_MAX_RESULTS)
          .optional()
          .describe(
            `Maximum number of results to return, 1-${MAX_MAX_RESULTS}. Defaults to ${DEFAULT_MAX_RESULTS}.`,
          ),
      },
      outputSchema: {
        results: z.array(
          z.object({
            title: z.string().describe("Title of the result page."),
            url: z.string().describe("URL of the result page."),
            content: z.string().describe("Excerpt extracted from the result page."),
          }),
        ),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, max_results }): Promise<CallToolResult> => {
      try {
        const response = await client.webSearch(query, max_results);
        return {
          content: [{ type: "text", text: formatSearchResults(query, response) }],
          structuredContent: response,
        };
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    "web_fetch",
    {
      title: "Web Fetch",
      description:
        "Fetch a single web page and return its title, extracted text content and outbound links. " +
        "Use it after web_search to read a promising result in full. " +
        "Accepts schemeless input such as \"ollama.com\"; only http and https are supported.",
      inputSchema: {
        url: z.string().min(1).describe('The page to fetch, for example "https://ollama.com".'),
      },
      outputSchema: {
        title: z.string().describe("Title of the fetched page."),
        content: z.string().describe("Extracted text content of the page."),
        links: z.array(z.string()).describe("Links found on the page."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ url }): Promise<CallToolResult> => {
      try {
        const response = await client.webFetch(url);
        return {
          content: [{ type: "text", text: formatFetchResponse(url, response) }],
          structuredContent: response,
        };
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  return server;
}

export function formatSearchResults(query: string, response: WebSearchResponse): string {
  const { results } = response;
  if (results.length === 0) {
    return `No web results found for "${query}".`;
  }

  const blocks = results.map((result, index) => {
    const title = result.title.trim();
    const lines = [`[${index + 1}] ${title === "" ? "(untitled)" : title}`];
    if (result.url !== "") {
      lines.push(`URL: ${result.url}`);
    }
    const content = result.content.trim();
    if (content !== "") {
      lines.push("", content);
    }
    return lines.join("\n");
  });

  return `Web search results for "${query}" (${results.length}):\n\n${blocks.join("\n\n")}`;
}

export function formatFetchResponse(requestedUrl: string, response: WebFetchResponse): string {
  const sections = [`Fetched ${requestedUrl}`];

  const title = response.title.trim();
  if (title !== "") {
    sections.push(`Title: ${title}`);
  }

  const content = response.content.trim();
  sections.push("", content === "" ? "(no extractable content)" : content);

  if (response.links.length > 0) {
    sections.push("", `Links (${response.links.length}):`, ...response.links.map((link) => `- ${link}`));
  }

  return sections.join("\n");
}

function toErrorResult(error: unknown): CallToolResult {
  const message =
    error instanceof OllamaWebError
      ? error.message
      : `Unexpected failure calling Ollama: ${error instanceof Error ? error.message : String(error)}`;

  // stdout carries the MCP protocol stream; diagnostics must go to stderr.
  console.error(`[${SERVER_NAME}] ${message}`);
  return { content: [{ type: "text", text: message }], isError: true };
}
