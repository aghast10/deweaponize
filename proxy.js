#!/usr/bin/env node

// Local proxy server that routes LLM requests through the Claude Code CLI,
// using your Claude Code subscription. No API key needed.
//
// Usage:  node proxy.js [--port 7880]
// Then set the extension to use "Local (Claude Code)" provider.

import { createServer } from "node:http";
import { spawn } from "node:child_process";

const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--port") || "7880", 10);
const MODEL = process.argv.find((_, i, a) => a[i - 1] === "--model") || "claude-haiku-4-5-20251001";
const CLAUDE_BIN = process.env.CLAUDE_PATH || "claude";

const server = createServer(async (req, res) => {
  // CORS headers for the browser extension
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/message") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. POST /message" }));
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  const { system, prompt } = parsed;
  if (!prompt) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing 'prompt' field" }));
    return;
  }

  // Build the input: prepend system prompt if provided
  const input = system ? `${system}\n\n---\n\n${prompt}` : prompt;

  try {
    const result = await runClaude(input);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ text: result }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

function runClaude(input) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_BIN, ["-p", input, "--model", MODEL], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.slice(0, 300)}`));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on("error", (err) => reject(err));

    proc.stdin.end();
  });
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Pharmakon proxy listening on http://127.0.0.1:${PORT}`);
  console.log(`Using Claude CLI: ${CLAUDE_BIN} (model: ${MODEL})`);
});
