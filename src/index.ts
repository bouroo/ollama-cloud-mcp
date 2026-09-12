#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { OllamaWebClient, resolveConfig } from "./ollama.js";
import { SERVER_NAME, createServer } from "./server.js";
import pkg from "../package.json" with { type: "json" };

const SERVER_VERSION: string = pkg.version;

const HELP = `${SERVER_NAME} v${SERVER_VERSION}

MCP server exposing Ollama's web search and web fetch capabilities over stdio.

USAGE
  ollama-cloud-mcp            Start the stdio MCP server.
  ollama-cloud-mcp --help     Show this help.
  ollama-cloud-mcp --version  Print the version.

ENVIRONMENT
  OLLAMA_API_KEY  Bearer token for https://ollama.com. Required for the hosted API.
                  Create one at https://ollama.com/settings/keys
  OLLAMA_HOST     Override the API base URL. Bare host:port values are treated as
                  http:// (Ollama's own convention), e.g. 127.0.0.1:11434.
                  Defaults to https://ollama.com

MCP CLIENT CONFIG
  {
    "mcpServers": {
      "ollama-cloud": {
        "command": "npx",
        "args": ["-y", "${pkg.name}"],
        "env": { "OLLAMA_API_KEY": "<your key>" }
      }
    }
  }

TOOLS
  web_search  Search the web; returns titles, URLs and content excerpts.
  web_fetch   Fetch a URL; returns its title, content and links.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }

  const config = resolveConfig(process.env);
  const server = createServer(new OllamaWebClient({ config }), SERVER_VERSION);

  await server.connect(new StdioServerTransport());

  const auth = config.apiKey === undefined ? "no OLLAMA_API_KEY set" : "OLLAMA_API_KEY set";
  console.error(`[${SERVER_NAME}] v${SERVER_VERSION} listening on stdio (${config.baseUrl}, ${auth})`);
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`[${SERVER_NAME}] fatal: ${detail}`);
  process.exit(1);
});
