#!/usr/bin/env node
/**
 * End-to-end smoke test against the built server, over real stdio.
 *
 *   bun run build && node scripts/smoke.mjs                  handshake, tools/list, error path
 *   node scripts/smoke.mjs "what is ollama?"                 also makes live web_search/web_fetch calls
 *
 * Without OLLAMA_API_KEY the live calls are expected to return the documented
 * missing-key error, which still proves the request wiring end to end.
 *
 * SMOKE_ENTRY points the run at a different server file, so CI can exercise the
 * built bundle from a directory with no node_modules to prove it is self-contained.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = process.env.SMOKE_ENTRY
  ? resolve(process.env.SMOKE_ENTRY)
  : join(root, "dist", "index.js");

if (!existsSync(entry)) {
  console.error(`Missing ${entry} — run: bun run build`);
  process.exit(1);
}

// cwd is the entry's own directory: ESM resolves imports relative to the file,
// so running from an isolated copy cannot fall back on the project's node_modules.
const child = spawn(process.execPath, [entry], {
  cwd: dirname(entry),
  stdio: ["pipe", "pipe", "pipe"],
});

const stderrChunks = [];
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

let buffer = "";
let nextId = 1;
let fatal = null;
let finished = false;
const pending = new Map();

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line === "") continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      fatal ??= new Error(`server wrote non-JSON to stdout: ${line}`);
      continue;
    }

    const resolve = pending.get(message.id);
    if (resolve !== undefined) {
      pending.delete(message.id);
      resolve(message);
    }
  }
});

child.on("exit", (code, signal) => {
  if (finished) return;
  fatal ??= new Error(
    `server exited early (code ${code}, signal ${signal})\n${stderrChunks.join("")}`,
  );
  for (const [id, resolve] of pending) {
    pending.delete(id);
    resolve(null);
  }
});

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timed out waiting for ${method}`));
    }, 60_000);

    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(`${method} failed: ${JSON.stringify(message.error)}`));
      else resolve(message.result);
    });

    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  fatal ??= new Error(`FAIL ${label}${detail === "" ? "" : ` — ${detail.slice(0, 300)}`}`);
}

const textOf = (call) => call?.content?.[0]?.text ?? "";

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.0" },
  });
  check("initialize handshake", typeof init?.serverInfo?.name === "string", JSON.stringify(init));
  console.log(`       ${init?.serverInfo?.name} v${init?.serverInfo?.version} (protocol ${init?.protocolVersion})`);

  notify("notifications/initialized", {});

  const listed = await request("tools/list", {});
  const tools = listed?.tools ?? [];
  check(
    "tools/list exposes exactly web_fetch and web_search",
    JSON.stringify(tools.map((tool) => tool.name).sort()) === '["web_fetch","web_search"]',
    JSON.stringify(tools.map((tool) => tool.name)),
  );

  const search = tools.find((tool) => tool.name === "web_search");
  check("web_search requires query", search?.inputSchema?.required?.includes("query") === true);
  check("web_search declares an outputSchema", search?.outputSchema !== undefined);

  const live = process.argv[2];
  const hasKey = Boolean(process.env.OLLAMA_API_KEY);

  if (live === undefined) {
    const call = await request("tools/call", {
      name: "web_search",
      arguments: { query: "ollama" },
    });
    if (hasKey) {
      check(
        "web_search returns results",
        Array.isArray(call?.structuredContent?.results) && call.structuredContent.results.length > 0,
        textOf(call),
      );
    } else {
      check(
        "web_search reports the missing OLLAMA_API_KEY",
        call?.isError === true && textOf(call).includes("OLLAMA_API_KEY"),
        textOf(call),
      );
    }
  } else {
    const call = await request("tools/call", {
      name: "web_search",
      arguments: { query: live, max_results: 3 },
    });
    const results = call?.structuredContent?.results ?? [];
    check(`web_search("${live}") returns results`, call?.isError !== true && results.length > 0, textOf(call));
    for (const result of results) {
      console.log(`       [${result.title}] ${result.url}`);
    }

    const fetched = await request("tools/call", {
      name: "web_fetch",
      arguments: { url: "ollama.com" },
    });
    check(
      "web_fetch handles a schemeless url",
      fetched?.isError !== true && typeof fetched?.structuredContent?.content === "string",
      textOf(fetched),
    );
    console.log(`       title: ${fetched?.structuredContent?.title ?? "?"}`);
  }
} catch (error) {
  fatal ??= error;
}

finished = true;
child.stdin.end();
child.kill();

const serverLog = stderrChunks.join("").trim();
if (serverLog !== "") console.log(`\nserver stderr:\n${serverLog}`);

if (fatal) {
  console.error(`\nSMOKE FAILED: ${fatal.message}`);
  process.exit(1);
}
console.log("\nSMOKE PASSED");
