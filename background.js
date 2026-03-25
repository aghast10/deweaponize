// =========================================================================
// De-Weaponize — Browser Extension Adaptation (background script)
//
// Handles browser plumbing: context menu, messaging, badge, settings.
// Delegates all tone detection/rewriting to DWZCore (core/tone-engine.js).
// =========================================================================

// --- Transport: routes LLM calls to local proxy or Anthropic API ---

async function callLocalProxy(systemPrompt, userContent, settings) {
  const url = (settings.proxyUrl || "http://127.0.0.1:7880") + "/message";
  dbg(`fetch → ${url}`);

  const headers = { "Content-Type": "application/json" };
  if (settings.proxyToken) {
    headers["Authorization"] = `Bearer ${settings.proxyToken}`;
  }

  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ system: systemPrompt, prompt: userContent }),
    });
  } catch (fetchErr) {
    dbg(`fetch FAILED: ${fetchErr}`);
    throw fetchErr;
  }

  dbg(`fetch status: ${resp.status}`);

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Proxy ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.text;
}

async function callAnthropicAPI(systemPrompt, userContent, settings) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.content[0].text;
}

async function callOpenAIAPI(systemPrompt, userContent, settings) {
  const baseUrl = (settings.openaiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: userContent });

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${settings.openaiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json();
  return (data.choices[0].message.content || "").trim();
}

function llmTransport(systemPrompt, userContent, settings) {
  if (settings.provider === "local") {
    return callLocalProxy(systemPrompt, userContent, settings);
  }
  if (settings.provider === "openai") {
    return callOpenAIAPI(systemPrompt, userContent, settings);
  }
  return callAnthropicAPI(systemPrompt, userContent, settings);
}

// Streaming variant — calls onDelta(text) for each chunk, returns full text.
// Used for API providers (Anthropic, OpenAI); local proxy doesn't support streaming.

async function callAnthropicAPIStream(systemPrompt, userContent, settings, onDelta) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 4096,
      stream: true,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`${resp.status}: ${body.slice(0, 200)}`);
  }

  return readSSEStream(resp, onDelta, (event) => {
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      return event.delta.text;
    }
    return null;
  });
}

async function callOpenAIAPIStream(systemPrompt, userContent, settings, onDelta) {
  const baseUrl = (settings.openaiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: userContent });

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${settings.openaiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      stream: true,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`${resp.status}: ${body.slice(0, 200)}`);
  }

  return readSSEStream(resp, onDelta, (event) => {
    const delta = event.choices?.[0]?.delta?.content;
    return delta || null;
  });
}

// Shared SSE stream reader. extractDelta(event) → string|null
async function readSSEStream(resp, onDelta, extractDelta) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });

    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return fullText;
      try {
        const event = JSON.parse(data);
        const text = extractDelta(event);
        if (text) {
          fullText += text;
          onDelta(text);
        }
      } catch {}
    }
  }
  return fullText;
}

// Pick the right streaming function for the current provider
function callAPIStream(systemPrompt, userContent, settings, onDelta) {
  if (settings.provider === "openai") {
    return callOpenAIAPIStream(systemPrompt, userContent, settings, onDelta);
  }
  return callAnthropicAPIStream(systemPrompt, userContent, settings, onDelta);
}

// Extract complete JSON objects from a streaming buffer.
// Returns { items: parsed[], remaining: string } — call with accumulated buf + new delta.
function extractJsonObjects(buf, newText) {
  buf += newText;
  const items = [];
  let searchFrom = 0;

  while (true) {
    const start = buf.indexOf("{", searchFrom);
    if (start === -1) break;

    let depth = 0;
    let inStr = false;
    let escape = false;
    let end = -1;

    for (let j = start; j < buf.length; j++) {
      const c = buf[j];
      if (escape) { escape = false; continue; }
      if (c === "\\" && inStr) { escape = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { end = j; break; } }
    }

    if (end === -1) break; // incomplete object, wait for more data
    try { items.push(JSON.parse(buf.slice(start, end + 1))); } catch {}
    searchFrom = end + 1;
  }

  return { items, remaining: buf.slice(searchFrom) };
}

// Parse a single detect-response item (mirrors core's parseDetectResponse logic).
function parseDetectItem(raw) {
  if (raw.action === "rewrite" && Array.isArray(raw.patches)) {
    return { rewritten: true, patches: raw.patches };
  }
  return { rewritten: null };
}

// --- Toggle sidebar on browser action click ---

browser.browserAction.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});

// --- Generate proxy token on first install ---

browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const arr = new Uint8Array(24);
    crypto.getRandomValues(arr);
    const token = Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
    await browser.storage.local.set({ proxyToken: token });
    dbg("Generated proxy token on first install");
  }
});

// --- Debug log ---

const _debugLog = [];
function dbg(msg) {
  const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
  _debugLog.unshift(entry);
  if (_debugLog.length > 50) _debugLog.pop();
}

// --- Core engine instance ---

const enginePromise = (async () => {
  const [detectPrompt, rewritePrompt] = await Promise.all([
    fetch(browser.runtime.getURL("core/prompts/detect.md")).then((r) => r.text()),
    fetch(browser.runtime.getURL("core/prompts/rewrite.md")).then((r) => r.text()),
  ]);
  return DWZCore.createEngine(llmTransport, { detectPrompt, rewritePrompt });
})();

// =========================================================================
// Context menu — manual selection rewrite
// =========================================================================

browser.contextMenus.create({
  id: "dwz-rewrite",
  title: "De-Weaponize — Rewrite selection",
  contexts: ["selection"],
});

browser.contextMenus.create({
  id: "dwz-reader",
  title: "De-Weaponize — Reader Mode",
  contexts: ["page"],
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "dwz-reader") {
    browser.tabs.sendMessage(tab.id, { type: "dwz-reader-mode" });
    return;
  }
  if (info.menuItemId !== "dwz-rewrite") return;

  const settings = await getSettings();
  if (!validateSettings(settings, tab.id)) return;

  notify(tab.id, "loading", "Rewriting…");

  try {
    const engine = await enginePromise;
    const rewritten = await engine.rewriteSingle(info.selectionText, settings);
    browser.tabs.sendMessage(tab.id, { type: "dwz-selection-result", text: rewritten });
  } catch (err) {
    notify(tab.id, "error", err.message);
  }
});

// =========================================================================
// Messages from content script / popup
// =========================================================================

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "dwz-batch") {
    handleBatch(sender.tab.id, msg.texts, msg.batchIndex, "dwz-batch");
  }
  if (msg.type === "dwz-reader-batch") {
    handleBatch(sender.tab.id, msg.texts, msg.batchIndex, "dwz-reader-batch");
  }
  if (msg.type === "dwz-get-settings") {
    return getSettings();
  }
  if (msg.type === "dwz-get-debug-log") {
    return Promise.resolve({ log: _debugLog });
  }
  if (msg.type === "dwz-clear-debug-log") {
    _debugLog.length = 0;
    return Promise.resolve({ ok: true });
  }
});

// Keyboard shortcut for reader mode
browser.commands.onCommand.addListener((command) => {
  if (command === "reader-mode") {
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab) browser.tabs.sendMessage(tab.id, { type: "dwz-reader-mode" });
    });
  }
});

// =========================================================================
// Badge — show ON/OFF state
// =========================================================================

browser.storage.local.get({ enabled: false }).then((s) => updateBadge(s.enabled));
browser.storage.onChanged.addListener((changes) => {
  if (changes.enabled) updateBadge(changes.enabled.newValue);
});

let _enabled = false;
let _inflight = 0;

browser.storage.local.get({ enabled: false }).then((s) => { _enabled = s.enabled; });

function updateBadge(on) {
  _enabled = on;
  refreshBadge();
}

function refreshBadge() {
  if (_inflight > 0) {
    browser.browserAction.setBadgeText({ text: "…" });
    browser.browserAction.setBadgeBackgroundColor({ color: "#f0a500" });
  } else {
    browser.browserAction.setBadgeText({ text: _enabled ? "ON" : "" });
    browser.browserAction.setBadgeBackgroundColor({ color: _enabled ? "#648cff" : "#666" });
  }
}

function batchStart() { _inflight++; refreshBadge(); }
function batchEnd()   { _inflight = Math.max(0, _inflight - 1); refreshBadge(); }

// =========================================================================
// Settings
// =========================================================================

async function getSettings() {
  const defaults = {
    apiKey: "",
    openaiKey: "",
    openaiBaseUrl: "https://api.openai.com/v1",
    tone: "de-weaponized: disarm opposition, flatten hierarchy, replace blame with description, preserve all factual content",
    model: "claude-haiku-4-5-20251001",
    enabled: true,
    sensitivity: "moderate",
    provider: "local",
    proxyUrl: "http://127.0.0.1:7880",
    proxyToken: "",
  };
  return browser.storage.local.get(defaults);
}

function validateSettings(settings, tabId) {
  if (settings.provider === "api" && !settings.apiKey) {
    notify(tabId, "error", "No Anthropic API key set. Open Settings to configure.");
    return false;
  }
  if (settings.provider === "openai" && !settings.openaiKey) {
    notify(tabId, "error", "No OpenAI API key set. Open Settings to configure.");
    return false;
  }
  return true;
}

// =========================================================================
// Cache — keyed per text + tone + sensitivity, max 500 entries (LRU eviction)
// =========================================================================

const _cache = new Map();
const CACHE_MAX = 500;

function cacheKey(text, settings) {
  return `${settings.tone}||${settings.sensitivity}||${text}`;
}

function cacheGet(text, settings) {
  const key = cacheKey(text, settings);
  if (!_cache.has(key)) return undefined;
  // Refresh recency: delete and re-insert
  const val = _cache.get(key);
  _cache.delete(key);
  _cache.set(key, val);
  return val;
}

function cacheSet(text, settings, result) {
  const key = cacheKey(text, settings);
  if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value);
  _cache.set(key, result);
}

// =========================================================================
// Batch processing
// =========================================================================

async function handleBatch(tabId, texts, batchIndex, msgPrefix) {
  msgPrefix = msgPrefix || "dwz-batch";
  const settings = await getSettings();
  if (!validateSettings(settings, tabId)) return;

  // Split into cached and uncached
  const results = new Array(texts.length);
  const uncachedIndices = [];
  const uncachedTexts = [];

  for (let i = 0; i < texts.length; i++) {
    const cached = cacheGet(texts[i], settings);
    if (cached !== undefined) {
      results[i] = { index: i, ...cached };
    } else {
      uncachedIndices.push(i);
      uncachedTexts.push(texts[i]);
    }
  }

  const cachedCount = texts.length - uncachedTexts.length;
  dbg(`Batch #${batchIndex}: ${uncachedTexts.length} uncached + ${cachedCount} cached → ${settings.provider}`);

  // Send cache hits immediately as partials — no need to wait for LLM
  for (let i = 0; i < texts.length; i++) {
    if (results[i]) {
      browser.tabs.sendMessage(tabId, {
        type: msgPrefix + "-partial",
        batchIndex,
        item: results[i],
      });
    }
  }

  if (uncachedTexts.length === 0) {
    browser.tabs.sendMessage(tabId, {
      type: msgPrefix + "-result",
      results: { batchIndex, items: results },
    });
    return;
  }

  batchStart();

  try {
    const engine = await enginePromise;

    if (settings.provider === "api" || settings.provider === "openai") {
      // Streaming path: parse JSON objects as they arrive, send each as a partial
      const { systemPrompt, userContent } = engine.buildDetectPrompt(uncachedTexts, settings);
      let jsonBuf = "";
      const seen = new Set();

      await callAPIStream(systemPrompt, userContent, settings, (delta) => {
        const { items, remaining } = extractJsonObjects(jsonBuf, delta);
        jsonBuf = remaining;
        for (const raw of items) {
          if (typeof raw.index !== "number" || seen.has(raw.index)) continue;
          seen.add(raw.index);
          const originalIndex = uncachedIndices[raw.index];
          if (originalIndex === undefined) continue;
          const entry = parseDetectItem(raw);
          cacheSet(uncachedTexts[raw.index], settings, entry);
          results[originalIndex] = { index: originalIndex, ...entry };
          if (entry.rewritten && entry.patches) {
            for (const p of entry.patches) {
              dbg(`  patch[${originalIndex}]: "${p.original || ""}" → "${p.rewritten || ""}"`);
            }
          }
          browser.tabs.sendMessage(tabId, {
            type: msgPrefix + "-partial",
            batchIndex,
            item: results[originalIndex],
          });
        }
      });

      batchEnd();

      // Fill any items the stream didn't emit (parse failures) as no-ops
      for (let i = 0; i < uncachedIndices.length; i++) {
        const originalIndex = uncachedIndices[i];
        if (!results[originalIndex]) {
          results[originalIndex] = { index: originalIndex, rewritten: null };
        }
      }
    } else {
      // Non-streaming path (local proxy): call LLM, then send all results at once
      const items = await engine.detectBatch(uncachedTexts, settings);
      batchEnd();

      for (const item of items) {
        const originalIndex = uncachedIndices[item.index];
        const entry = item.rewritten
          ? { rewritten: true, patches: item.patches }
          : { rewritten: null };
        cacheSet(uncachedTexts[item.index], settings, entry);
        results[originalIndex] = { index: originalIndex, ...entry };
        if (item.rewritten && item.patches) {
          for (const p of item.patches) {
            dbg(`  patch[${originalIndex}]: "${p.original || ""}" → "${p.rewritten || ""}"`);
          }
        }
      }

      // Fill gaps with no-op
      for (let i = 0; i < results.length; i++) {
        if (!results[i]) results[i] = { index: i, rewritten: null };
      }
    }

    const rewrites = results.filter((r) => r && r.rewritten).length;
    dbg(`Batch #${batchIndex} done: ${rewrites}/${texts.length} rewritten`);

    browser.tabs.sendMessage(tabId, {
      type: msgPrefix + "-result",
      results: { batchIndex, items: results },
    });
  } catch (err) {
    batchEnd();
    dbg(`Batch #${batchIndex} ERROR: ${err.message}`);
    const fallback = texts.map((_, i) => ({ index: i, rewritten: null }));
    browser.tabs.sendMessage(tabId, {
      type: msgPrefix + "-result",
      results: { batchIndex, items: fallback },
    });
    notify(tabId, "error", "API error: " + err.message);
  }
}

// =========================================================================
// Notifications
// =========================================================================

function notify(tabId, level, text) {
  const type = level === "error" ? "dwz-error" : "dwz-loading";
  browser.tabs.sendMessage(tabId, { type, [level === "error" ? "error" : "text"]: text });
}
