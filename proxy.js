#!/usr/bin/env node

// Local proxy server that routes LLM requests through either:
//   - Claude Code CLI (using your Claude Code subscription, no API key needed)
//   - Ollama (local LLM, no API key needed)
//
// Usage:
//   node proxy.js [--port 7880] [--backend claude|ollama] [--model <model>]
//
// Examples:
//   node proxy.js                                          # Claude CLI, default model
//   node proxy.js --backend ollama --model qwen2.5:7b      # Ollama with Qwen 2.5 7B
//   node proxy.js --backend ollama                          # Ollama with qwen2.5:7b (default)

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));

const PORT    = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--port") || "7880", 10);
const BACKEND = process.argv.find((_, i, a) => a[i - 1] === "--backend") || "claude";
const MODEL   = process.argv.find((_, i, a) => a[i - 1] === "--model")
  || (BACKEND === "ollama" ? "qwen2.5:7b" : "claude-haiku-4-5-20251001");
const TOKEN   = process.argv.find((_, i, a) => a[i - 1] === "--token") || null;
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const CLAUDE_BIN  = process.env.CLAUDE_PATH || "claude";

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // Health check — no auth required
  if (req.method === "GET" && req.url === "/health") {
    const authed = !TOKEN || req.headers.authorization === `Bearer ${TOKEN}`;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      authenticated: authed,
      backend: BACKEND,
      model: MODEL,
      version: PKG.version,
    }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/message") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. POST /message" }));
    return;
  }

  // Token auth
  if (TOKEN) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or missing token" }));
      return;
    }
  }

  let body = "";
  for await (const chunk of req) body += chunk;

  let parsed;
  try { parsed = JSON.parse(body); }
  catch {
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

  try {
    const text = BACKEND === "ollama"
      ? await runOllama(system, prompt)
      : await runClaude(system, prompt);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ text }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

// --- Claude CLI backend ---

function runClaude(system, prompt) {
  const input = system ? `${system}\n\n---\n\n${prompt}` : prompt;
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
      if (code !== 0) reject(new Error(`claude exited ${code}: ${stderr.slice(0, 300)}`));
      else resolve(stdout.trim());
    });

    proc.on("error", (err) => reject(err));
    proc.stdin.end();
  });
}

// --- Ollama backend ---

function runOllama(system, prompt) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const payload = JSON.stringify({
    model: MODEL,
    messages,
    stream: false,
  });

  const url = new URL("/api/chat", OLLAMA_HOST);

  return new Promise((resolve, reject) => {
    const req = httpRequest(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Ollama ${res.statusCode}: ${data.slice(0, 300)}`));
          return;
        }
        try {
          const json = JSON.parse(data);
          resolve((json.message?.content || "").trim());
        } catch (e) {
          reject(new Error(`Failed to parse Ollama response: ${e.message}`));
        }
      });
    });

    req.on("error", (err) => {
      if (err.code === "ECONNREFUSED") {
        reject(new Error("Cannot connect to Ollama. Is it running? Start with: ollama serve"));
      } else {
        reject(err);
      }
    });

    req.write(payload);
    req.end();
  });
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`De-Weaponize proxy on http://127.0.0.1:${PORT}`);
  console.log(`  backend: ${BACKEND}`);
  console.log(`  model:   ${MODEL}`);
  if (TOKEN) console.log(`  token:   ${TOKEN.slice(0, 8)}…`);
  else console.log(`  token:   (none — open access)`);
  if (BACKEND === "ollama") {
    console.log(`  ollama:  ${OLLAMA_HOST}`);
  }
});
