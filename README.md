# @bouroo/ollama-cloud-mcp

[![npm version](https://img.shields.io/npm/v/@bouroo/ollama-cloud-mcp.svg)](https://www.npmjs.com/package/@bouroo/ollama-cloud-mcp)
[![downloads](https://img.shields.io/npm/dm/@bouroo/ollama-cloud-mcp.svg)](https://www.npmjs.com/package/@bouroo/ollama-cloud-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/bouroo/ollama-cloud-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/bouroo/ollama-cloud-mcp/actions/workflows/ci.yml)

An [MCP](https://modelcontextprotocol.io) server that exposes [Ollama's web search and web fetch](https://docs.ollama.com/capabilities/web-search) capabilities as two tools — `web_search` and `web_fetch` — over stdio.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [API](#api)
  - [`web_search`](#web_search)
  - [`web_fetch`](#web_fetch)
- [Configuration](#configuration)
- [Behaviour notes](#behaviour-notes)
- [Project structure](#project-structure)
- [Development](#development)
- [Continuous integration](#continuous-integration)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Two tools, one server** — `web_search` for ranked results, `web_fetch` for a single page's content, over stdio.
- **Self-contained bundle** — no runtime dependencies, so `npx` runs it with nothing to install. CI proves it by handshaking against the built file alone in an empty directory.
- **Hosted or local** — authenticates against `https://ollama.com` with an API key, or points `OLLAMA_HOST` at a signed-in local daemon and needs no key at all.
- **Errors stay errors** — a missing key, a rejected key, rate limiting or a server error is returned as a tool error the model can explain, instead of taking down the server.
- **Protocol-clean** — stdout carries only the MCP stream; diagnostics go to stderr.

## Requirements

- **Node.js** — the current Active LTS. CI tracks `lts/*`, and no `engines` floor is declared, so no version is claimed that CI does not actually test.
- **An Ollama API key** for the hosted API — free, from <https://ollama.com/settings/keys>. Alternatively, point `OLLAMA_HOST` at a signed-in local daemon (see [Configuration](#configuration)).

## Installation

There is no install step: `npx` fetches and runs the published package, which ships as a single self-contained bundle with no runtime dependencies.

```bash
npx -y @bouroo/ollama-cloud-mcp --help
```

## Usage

Register the server with your MCP client.

**Claude Code**

```bash
claude mcp add ollama-cloud --env OLLAMA_API_KEY=your-key-here -- npx -y @bouroo/ollama-cloud-mcp
```

**Claude Desktop / other clients** — add this to `claude_desktop_config.json` or the equivalent `mcpServers` block:

```json
{
  "mcpServers": {
    "ollama-cloud": {
      "command": "npx",
      "args": ["-y", "@bouroo/ollama-cloud-mcp"],
      "env": { "OLLAMA_API_KEY": "your-key-here" }
    }
  }
}
```

Once registered, the client discovers both tools and can call them.

## API

### `web_search`

Search the web and return ranked results. Use it for information beyond the model's training cutoff: news, releases, prices, current documentation.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string | yes | The search term, e.g. `"what is ollama?"` |
| `max_results` | integer | no | 1–10. Defaults to `5`. |

Returns `structuredContent.results` — an array of `{ title, url, content }` — plus a readable text rendering:

```
Web search results for "what is ollama?" (2):

[1] Ollama
URL: https://ollama.com/
Cloud models are now available in Ollama...

[2] What is Ollama? Introduction to the AI model management tool
URL: https://www.hostinger.com/tutorials/what-is-ollama
An introduction to running and managing local models...
```

### `web_fetch`

Fetch a single page and return its content. Use it after `web_search` to read a promising result in full.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `url` | string | yes | May omit the scheme: `"ollama.com"` becomes `https://ollama.com/`. Only `http` and `https` are accepted. |

Returns `structuredContent` — `{ title, content, links }` — plus a readable text rendering:

```
Fetched ollama.com
Title: Ollama

Cloud models are now available in Ollama...

Links (2):
- http://ollama.com/
- https://github.com/ollama/ollama
```

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OLLAMA_API_KEY` | For the hosted API | — | Bearer token for `https://ollama.com`. |
| `OLLAMA_HOST` | No | `https://ollama.com` | Override the API base URL. A bare `host:port` is treated as `http://`, matching Ollama's own convention — e.g. `OLLAMA_HOST=127.0.0.1:11434` talks to a local daemon instead. |

Pointing `OLLAMA_HOST` at a local, signed-in Ollama daemon is supported and needs no API key: the daemon handles its own authentication. If `OLLAMA_API_KEY` is set, it is always sent.

## Behaviour notes

- **Errors are returned as tool errors, not crashes.** A missing key, a rejected key (HTTP 401/403), rate limiting (429) or a server error (5xx) comes back as `isError: true` with a message naming the cause, so the model can explain it instead of the client losing the server.
- **An empty result set is not an error** — `web_search` reports `No web results found for "<query>".`
- **Requests time out after 30 seconds** rather than hanging the tool call.
- **stdout carries only the MCP protocol stream.** All diagnostics go to stderr.
- Ollama's docs suggest a context length of at least ~32,000 tokens when feeding fetched pages to a model; `web_fetch` returns page content verbatim and does not truncate it.

## Project structure

```
src/
  index.ts                       composition root: CLI entry (stdio, --help, --version)
  domain/                        pure model — types, constants, pure rules
    errors.ts                    OllamaWebError and the missing-key message
    config.ts                    OllamaConfig, base-URL normalization and resolution
    web.ts                       response types, URL and max-results normalization
  interfaces/OllamaWebPort.ts    the outbound contract the use cases depend on
  usecases/                      application logic
    searchWeb.ts                 validate, clamp, call the port, parse the response
    fetchPage.ts                 normalize the url, call the port, parse the response
    parseResponses.ts            shape raw payloads into the response types
  adapters/                      implementations that touch the outside world
    OllamaWebClient.ts           fetch transport: auth, timeout, status mapping
    McpServer.ts                 tool registration, schemas, text formatting
test/
  domain/config.test.ts          config resolution and base-URL normalization
  domain/web.test.ts             target-URL and max-results normalization
  usecases/webOperations.test.ts the use cases driven through a stub port
  adapters/OllamaWebClient.test.ts  transport, auth and error mapping
  adapters/McpServer.test.ts     in-memory MCP protocol tests
  helpers.ts                     shared fakes
scripts/smoke.mjs                end-to-end stdio smoke test
```

`test/` mirrors the `src/` layers. The `OllamaWebPort` seam keeps `usecases/` independent of any concrete HTTP client — `OllamaWebClient` implements it, and the use-case tests exercise it with a stub.

## Development

Requires [Bun](https://bun.sh) for the toolchain; the published artifact runs on plain Node.

```bash
bun install
bun run typecheck   # tsc --noEmit
bun run test        # unit + in-memory MCP protocol tests
bun run build       # bundles src/index.ts -> dist/index.js
bun run smoke       # end-to-end stdio handshake against dist/

# With a key, exercise the live API as well:
OLLAMA_API_KEY=... node scripts/smoke.mjs "what is ollama?"
```

`bun run smoke` drives the built server over real stdio: it performs the MCP initialize handshake, lists tools, and calls `web_search`. Without `OLLAMA_API_KEY` it asserts the missing-key error path instead, which still proves the request wiring end to end.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request, on the current Active LTS (`lts/*`):

- type-check, test, build
- drive a **full MCP handshake against a copy of the built bundle sitting alone in an empty directory**, with no `node_modules` to fall back on — this is what makes the "zero runtime dependencies" claim tested rather than asserted
- the same handshake against the source build

## Contributing

1. Fork the repository.
2. Create a branch: `git checkout -b feat/your-feature`.
3. Commit your changes following [Conventional Commits](https://www.conventionalcommits.org/): `git commit -m "feat: add …"`.
4. Push to the branch: `git push origin feat/your-feature`.
5. Open a pull request.

Please add tests for any behaviour change and make sure `bun run typecheck`, `bun run test` and `bun run smoke` pass.

## License

MIT © [Kawin Viriyaprasopsook](https://github.com/bouroo)
