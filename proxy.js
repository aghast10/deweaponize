#!/usr/bin/env node

// De-Weaponize — Local LLM proxy server
//
// Routes LLM requests through multiple backends: CLI tools or HTTP APIs.
// Inspired by summarize's multi-provider architecture.
//
// CLI backends (use your existing subscription/installation):
//   claude   — Claude Code CLI (default)
//   codex    — OpenAI Codex CLI
//   gemini   — Google Gemini CLI
//
// API backends (require API keys via environment variables):
//   ollama     — Local Ollama server (no key needed)
//   openai     — OpenAI API (OPENAI_API_KEY)
//   anthropic  — Anthropic API (ANTHROPIC_API_KEY)
//
// Usage:
//   deweaponize [--backend <name>] [--port 7880] [--model <model>] [--token <token>]
//   deweaponize --list-backends
//
// Environment variables:
//   CLAUDE_PATH       Path to claude binary (default: claude)
//   CODEX_PATH        Path to codex binary (default: codex)
//   GEMINI_PATH       Path to gemini binary (default: gemini)
//   OLLAMA_HOST       Ollama server URL (default: http://127.0.0.1:11434)
//   OPENAI_API_KEY    OpenAI API key (required for openai backend)
//   OPENAI_BASE_URL   OpenAI-compatible base URL (default: https://api.openai.com/v1)
//   ANTHROPIC_API_KEY Anthropic API key (required for anthropic backend)

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));

// --- Environment config ---

const CLAUDE_BIN    = process.env.CLAUDE_PATH    || "claude";
const CODEX_BIN     = process.env.CODEX_PATH     || "codex";
const GEMINI_BIN    = process.env.GEMINI_PATH    || "gemini";
const OLLAMA_HOST   = process.env.OLLAMA_HOST    || "http://127.0.0.1:11434";
const OPENAI_KEY    = process.env.OPENAI_API_KEY   || "";
const OPENAI_BASE   = process.env.OPENAI_BASE_URL  || "https://api.openai.com/v1";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

// --- Backend registry ---

const BACKENDS = {
  // CLI backends — spawn a local binary
  claude: {
    type: "cli",
    description: "Claude Code CLI (subscription)",
    defaultModel: "claude-haiku-4-5-20251001",
    run: runClaude,
  },
  codex: {
    type: "cli",
    description: "OpenAI Codex CLI",
    defaultModel: "o4-mini",
    run: runCodex,
  },
  gemini: {
    type: "cli",
    description: "Google Gemini CLI",
    defaultModel: "gemini-2.5-flash",
    run: runGemini,
  },
  // API backends — HTTP calls
  ollama: {
    type: "api",
    description: "Ollama (local LLM server)",
    defaultModel: "qwen2.5:7b",
    run: runOllama,
  },
  openai: {
    type: "api",
    description: "OpenAI API (OPENAI_API_KEY)",
    defaultModel: "gpt-4o-mini",
    run: runOpenAI,
  },
  anthropic: {
    type: "api",
    description: "Anthropic API (ANTHROPIC_API_KEY)",
    defaultModel: "claude-haiku-4-5-20251001",
    run: runAnthropic,
  },
};

// --- CLI argument parsing ---

const arg = (name) => process.argv.find((_, i, a) => a[i - 1] === `--${name}`);

if (process.argv.includes("--list-backends")) {
  console.log("Available backends:\n");
  for (const [name, b] of Object.entries(BACKENDS)) {
    const env = name === "claude" ? "CLAUDE_PATH"
      : name === "codex" ? "CODEX_PATH"
      : name === "gemini" ? "GEMINI_PATH"
      : name === "ollama" ? "OLLAMA_HOST"
      : name === "openai" ? "OPENAI_API_KEY"
      : name === "anthropic" ? "ANTHROPIC_API_KEY" : "";
    console.log(`  ${name.padEnd(12)} ${b.type.padEnd(5)} ${b.description}`);
    console.log(`  ${"".padEnd(12)} default model: ${b.defaultModel}${env ? `, env: ${env}` : ""}`);
  }
  process.exit(0);
}

const BACKEND_NAME = arg("backend") || "claude";
const backend = BACKENDS[BACKEND_NAME];

if (!backend) {
  console.error(`Unknown backend: ${BACKEND_NAME}`);
  console.error(`Available: ${Object.keys(BACKENDS).join(", ")}`);
  console.error(`Run with --list-backends for details.`);
  process.exit(1);
}

const PORT  = parseInt(arg("port") || "7880", 10);
const MODEL = arg("model") || backend.defaultModel;
const TOKEN = arg("token") || null;

// =========================================================================
// CLI backends
// =========================================================================

function spawnCli(bin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));

    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`${bin} exited ${code}: ${stderr.slice(0, 300)}`));
      else resolve(stdout.trim());
    });

    proc.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(new Error(`Binary not found: ${bin}. Install it or set the path via environment variable.`));
      } else {
        reject(err);
      }
    });

    proc.stdin.end();
  });
}

function runClaude(system, prompt, model) {
  const input = system ? `${system}\n\n---\n\n${prompt}` : prompt;
  return spawnCli(CLAUDE_BIN, ["-p", input, "--model", model]);
}

function runCodex(system, prompt, model) {
  const input = system ? `${system}\n\n---\n\n${prompt}` : prompt;
  return spawnCli(CODEX_BIN, ["-q", "--model", model, input]);
}

function runGemini(system, prompt, model) {
  const input = system ? `${system}\n\n---\n\n${prompt}` : prompt;
  return spawnCli(GEMINI_BIN, ["--model", model, input]);
}

// =========================================================================
// API backends
// =========================================================================

function runOllama(system, prompt, model) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const payload = JSON.stringify({ model, messages, stream: false });
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

async function runOpenAI(system, prompt, model) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY environment variable not set");

  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const resp = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${body.slice(0, 300)}`);
  }

  const data = await resp.json();
  return (data.choices[0].message.content || "").trim();
}

async function runAnthropic(system, prompt, model) {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY environment variable not set");

  const body = {
    model,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  };
  if (system) body.system = system;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Anthropic ${resp.status}: ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  return data.content[0].text;
}

// =========================================================================
// HTTP server
// =========================================================================

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
      backend: BACKEND_NAME,
      backendType: backend.type,
      model: MODEL,
      version: PKG.version,
      availableBackends: Object.keys(BACKENDS),
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
    const text = await backend.run(system, prompt, MODEL);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ text }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`De-Weaponize proxy on http://127.0.0.1:${PORT}`);
  console.log(`  backend: ${BACKEND_NAME} (${backend.type})`);
  console.log(`  model:   ${MODEL}`);
  if (TOKEN) console.log(`  token:   ${TOKEN.slice(0, 8)}…`);
  else console.log(`  token:   (none — open access)`);
  if (BACKEND_NAME === "ollama") console.log(`  ollama:  ${OLLAMA_HOST}`);
  if (BACKEND_NAME === "openai") console.log(`  api:     ${OPENAI_BASE}`);
});
