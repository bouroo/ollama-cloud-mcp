# @bouroo/ollama-cloud-mcp

[![CI](https://github.com/bouroo/ollama-cloud-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/bouroo/ollama-cloud-mcp/actions/workflows/ci.yml)

An MCP server that exposes [Ollama's web search and web fetch](https://docs.ollama.com/capabilities/web-search)
capabilities as two tools, `web_search` and `web_fetch`, over stdio.

The server is a thin, dependency-free wrapper around two endpoints:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `POST https://ollama.com/api/web_search` | `query`, `max_results` | Ranked web results with title, URL and content excerpt |
| `POST https://ollama.com/api/web_fetch` | `url` | A page's title, extracted content and outbound links |

Both are authenticated with a bearer token from a free Ollama account.

## Requirements

- Node.js **20 or newer**
- A free Ollama account and an API key from <https://ollama.com/settings/keys>

## Setup

Create a key at <https://ollama.com/settings/keys>, then register the server with
your MCP client.

**Claude Code**

```bash
claude mcp add ollama-cloud --env OLLAMA_API_KEY=your-key-here -- npx -y @bouroo/ollama-cloud-mcp
```

**Claude Desktop / other clients** — add to `claude_desktop_config.json` or the
equivalent `mcpServers` block:

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

No install step is needed — `npx` fetches and runs the package, which is published
as a single self-contained bundle with no runtime dependencies.

## Tools

### `web_search`

Search the web and return ranked results.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string | yes | The search term, e.g. `"what is ollama?"` |
| `max_results` | integer | no | 1–10. Defaults to `5`. |

Returns `structuredContent.results`: an array of `{ title, url, content }`, plus a
readable text rendering:

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

Fetch a single page and return its content.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `url` | string | yes | May omit the scheme: `"ollama.com"` becomes `https://ollama.com/`. Only `http` and `https` are accepted. |

Returns `structuredContent`: `{ title, content, links }`, plus a readable text
rendering:

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

Pointing `OLLAMA_HOST` at a local, signed-in Ollama daemon is supported and needs
no API key: the daemon handles its own authentication. If `OLLAMA_API_KEY` is set,
it is always sent.

## Behaviour notes

- **Errors are returned as tool errors, not crashes.** A missing key, a rejected
  key (HTTP 401/403), rate limiting (429) or a server error (5xx) comes back as
  `isError: true` with a message naming the cause, so the model can explain it
  instead of the client losing the server.
- **An empty result set is not an error** — `web_search` reports
  `No web results found for "<query>".`
- **Requests time out after 30 seconds** rather than hanging the tool call.
- **stdout carries only the MCP protocol stream.** All diagnostics go to stderr.
- Ollama's docs suggest a context length of at least ~32,000 tokens when feeding
  fetched pages to a model; `web_fetch` returns page content verbatim and does not
  truncate it.

## Development

Requires [Bun](https://bun.sh) for the toolchain; the published artifact runs on
plain Node.

```bash
bun install
bun run typecheck   # tsc --noEmit
bun run test        # unit + in-memory MCP protocol tests
bun run build       # bundles src/index.ts -> dist/index.js
bun run smoke       # end-to-end stdio handshake against dist/

# With a key, exercise the live API as well:
OLLAMA_API_KEY=... node scripts/smoke.mjs "what is ollama?"
```

`bun run smoke` drives the built server over real stdio: it performs the MCP
initialize handshake, lists tools, and calls `web_search`. Without
`OLLAMA_API_KEY` it asserts the missing-key error path instead, which still proves
the request wiring end to end.

Layout:

```
src/ollama.ts    API client: config, URL normalization, error mapping
src/server.ts    MCP tool registration and response formatting
src/index.ts     CLI entry point (stdio transport, --help, --version)
test/            unit tests and in-memory MCP protocol tests
scripts/smoke.mjs  end-to-end stdio smoke test
```

## Releasing

npm publishing is driven by GitHub Releases, so shipping is an explicit, reviewed
action rather than a side effect of a push.

One-time setup:

1. Create a **granular access token** on npm with read-write access to the
   `@bouroo` scope.
2. Add it to the repository as a secret named `NPM_TOKEN`
   (Settings → Secrets and variables → Actions).

Then, for each release:

```bash
npm version patch        # or minor / major — bumps package.json and tags the commit
git push --follow-tags
gh release create v0.1.1 --generate-notes
```

Publishing the release triggers `.github/workflows/release.yml`, which refuses to
proceed unless the release tag matches `package.json` and that version is not
already on npm, re-runs the gates, and then publishes with a
[provenance attestation](https://docs.npmjs.com/generating-provenance-statements)
cryptographically linking the tarball to the commit and workflow that built it.

To re-run a failed publish without cutting a new release, use
**Actions → Release → Run workflow**.

`prepack` also runs the typecheck, tests and build, so a tarball always carries
fresh output. The package is a bundle: `dependencies` is empty and consumers
install nothing.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request,
across Node 20, 22 and 24:

- type-check, test, build
- drive a **full MCP handshake against a copy of the built bundle sitting alone in
  an empty directory**, with no `node_modules` to fall back on — this is what
  makes the "zero runtime dependencies" claim tested rather than asserted
- the same handshake against the source build

## License

MIT
