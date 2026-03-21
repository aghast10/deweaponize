// =========================================================================
// Pharmakon — Browser Extension Adaptation (background script)
//
// Handles browser plumbing: context menu, messaging, badge, settings.
// Delegates all tone detection/rewriting to PharmakonCore (core/tone-engine.js).
// =========================================================================

// --- Transport: routes LLM calls to local proxy or Anthropic API ---

async function callLocalProxy(systemPrompt, userContent, settings) {
  const url = (settings.proxyUrl || "http://127.0.0.1:7880") + "/message";
  dbg(`fetch → ${url}`);

  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

function llmTransport(systemPrompt, userContent, settings) {
  if (settings.provider === "local") {
    return callLocalProxy(systemPrompt, userContent, settings);
  }
  return callAnthropicAPI(systemPrompt, userContent, settings);
}

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
  return PharmakonCore.createEngine(llmTransport, { detectPrompt, rewritePrompt });
})();

// =========================================================================
// Context menu — manual selection rewrite
// =========================================================================

browser.contextMenus.create({
  id: "pharmakon-rewrite",
  title: "Pharmakon — Rewrite selection",
  contexts: ["selection"],
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "pharmakon-rewrite") return;

  const settings = await getSettings();
  if (!validateSettings(settings, tab.id)) return;

  notify(tab.id, "loading", "Rewriting…");

  try {
    const engine = await enginePromise;
    const rewritten = await engine.rewriteSingle(info.selectionText, settings);
    browser.tabs.sendMessage(tab.id, { type: "pharmakon-selection-result", text: rewritten });
  } catch (err) {
    notify(tab.id, "error", err.message);
  }
});

// =========================================================================
// Messages from content script / popup
// =========================================================================

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "pharmakon-batch") {
    handleBatch(sender.tab.id, msg.texts, msg.batchIndex);
  }
  if (msg.type === "pharmakon-get-settings") {
    return getSettings();
  }
  if (msg.type === "pharmakon-get-debug-log") {
    return Promise.resolve({ log: _debugLog });
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
    tone: "de-weaponized: disarm opposition, flatten hierarchy, replace blame with description, preserve all factual content",
    model: "claude-haiku-4-5-20251001",
    enabled: false,
    sensitivity: "moderate",
    provider: "local",
    proxyUrl: "http://127.0.0.1:7880",
  };
  return browser.storage.local.get(defaults);
}

function validateSettings(settings, tabId) {
  if (settings.provider === "api" && !settings.apiKey) {
    notify(tabId, "error", "No API key set. Click the Pharmakon icon to configure.");
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

async function handleBatch(tabId, texts, batchIndex) {
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

  if (uncachedTexts.length === 0) {
    browser.tabs.sendMessage(tabId, {
      type: "pharmakon-batch-result",
      results: { batchIndex, items: results },
    });
    return;
  }

  batchStart();

  try {
    const engine = await enginePromise;
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

    // Fill any gaps with no-op
    for (let i = 0; i < results.length; i++) {
      if (!results[i]) results[i] = { index: i, rewritten: null };
    }

    const rewrites = results.filter((r) => r.rewritten).length;
    dbg(`Batch #${batchIndex} done: ${rewrites}/${texts.length} rewritten`);

    browser.tabs.sendMessage(tabId, {
      type: "pharmakon-batch-result",
      results: { batchIndex, items: results },
    });
  } catch (err) {
    batchEnd();
    dbg(`Batch #${batchIndex} ERROR: ${err.message}`);
    const fallback = texts.map((_, i) => ({ index: i, rewritten: null }));
    browser.tabs.sendMessage(tabId, {
      type: "pharmakon-batch-result",
      results: { batchIndex, items: fallback },
    });
    notify(tabId, "error", "API error: " + err.message);
  }
}

// =========================================================================
// Notifications
// =========================================================================

function notify(tabId, level, text) {
  const type = level === "error" ? "pharmakon-error" : "pharmakon-loading";
  browser.tabs.sendMessage(tabId, { type, [level === "error" ? "error" : "text"]: text });
}
