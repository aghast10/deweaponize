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
    const rewritten = await rewriteSingle(info.selectionText, settings);
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
});

// =========================================================================
// Badge — show ON/OFF state
// =========================================================================

browser.storage.local.get({ enabled: false }).then((s) => updateBadge(s.enabled));
browser.storage.onChanged.addListener((changes) => {
  if (changes.enabled) updateBadge(changes.enabled.newValue);
});

function updateBadge(on) {
  browser.browserAction.setBadgeText({ text: on ? "ON" : "" });
  browser.browserAction.setBadgeBackgroundColor({ color: on ? "#648cff" : "#666" });
}

// =========================================================================
// Settings
// =========================================================================

async function getSettings() {
  const defaults = {
    apiKey: "",
    tone: "neutral and calm",
    model: "claude-haiku-4-5-20251001",
    enabled: false,
    sensitivity: "moderate",
    provider: "local", // "local" (proxy) or "api" (direct Anthropic API)
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
// Batch processing — receives an array of texts, returns per-item results
// =========================================================================

async function handleBatch(tabId, texts, batchIndex) {
  const settings = await getSettings();
  if (!validateSettings(settings, tabId)) return;

  try {
    const items = await detectBatch(texts, settings);
    browser.tabs.sendMessage(tabId, {
      type: "pharmakon-batch-result",
      results: { batchIndex, items },
    });
  } catch (err) {
    // On error, tell content to unblur everything (reveal as-is)
    const fallback = texts.map((_, i) => ({ index: i, rewritten: null }));
    browser.tabs.sendMessage(tabId, {
      type: "pharmakon-batch-result",
      results: { batchIndex, items: fallback },
    });
    notify(tabId, "error", "API error: " + err.message);
  }
}

function buildDetectPrompts(texts, settings) {
  const sensitivityDesc = {
    low: "Only flag clearly aggressive, hostile, or hateful text.",
    moderate: "Flag aggressive, hostile, passive-aggressive, demeaning, fear-mongering, or manipulative text.",
    high: "Flag aggressive, negative, sarcastic, condescending, sensationalist, or harsh text.",
  };

  const numbered = texts.map((t, i) => `[${i}] ${t}`).join("\n\n");

  const systemPrompt = [
    "You are a tone filter. You receive numbered text items from a web page.",
    "",
    `Sensitivity: ${settings.sensitivity}. ${sensitivityDesc[settings.sensitivity] || sensitivityDesc.moderate}`,
    `Target tone: "${settings.tone}"`,
    "",
    "For EACH numbered item, decide:",
    '- If the tone is fine, return: {"index": N, "action": "keep"}',
    '- If it needs adjustment, return: {"index": N, "action": "rewrite", "patches": [{"original": "exact substring", "rewritten": "adjusted version"}]}',
    "",
    "Rules:",
    "- Keep ALL facts, names, numbers, dates exactly as they are.",
    "- Only change tone/style. Do not add or remove information.",
    "- Preserve the original language (do not translate).",
    '- "original" must be an EXACT character-for-character substring of the input text.',
    "- If the whole item needs rewriting, a single patch covering most of the text is fine.",
    "- Most items will likely be fine — only flag what truly needs adjustment.",
    "",
    "Return ONLY a JSON array, no markdown fences:",
    '[{"index": 0, "action": "keep"}, {"index": 1, "action": "rewrite", "patches": [...]}, ...]',
  ].join("\n");

  return { systemPrompt, numbered };
}

async function detectBatch(texts, settings) {
  const { systemPrompt, numbered } = buildDetectPrompts(texts, settings);

  const raw = await llmCall(systemPrompt, numbered, settings);
  const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return texts.map((_, i) => ({ index: i, rewritten: null }));
  }

  if (!Array.isArray(parsed)) {
    return texts.map((_, i) => ({ index: i, rewritten: null }));
  }

  return parsed.map((item) => {
    if (item.action === "rewrite" && item.patches) {
      return { index: item.index, rewritten: true, patches: item.patches };
    }
    return { index: item.index, rewritten: null };
  });
}

// =========================================================================
// Single selection rewrite
// =========================================================================

async function rewriteSingle(text, settings) {
  const systemPrompt = [
    `You rewrite text in a "${settings.tone}" tone.`,
    "Rules:",
    "- Keep ALL facts, names, numbers, dates, and claims exactly as they are.",
    "- Change only the style and tone.",
    "- Preserve the original language (do not translate).",
    "- Preserve approximate length.",
    "- Return ONLY the rewritten text, no preamble.",
  ].join("\n");

  return llmCall(systemPrompt, text, settings);
}

// =========================================================================
// LLM call — routes to local proxy or Anthropic API based on provider
// =========================================================================

async function llmCall(systemPrompt, userContent, settings) {
  if (settings.provider === "local") {
    return callLocalProxy(systemPrompt, userContent, settings);
  }
  return callAnthropicAPI(systemPrompt, userContent, settings);
}

// --- Local proxy (uses Claude Code subscription via cli) ---

async function callLocalProxy(systemPrompt, userContent, settings) {
  const url = (settings.proxyUrl || "http://127.0.0.1:7880") + "/message";

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system: systemPrompt,
      prompt: userContent,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Proxy ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.text;
}

// --- Direct Anthropic API ---

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

function notify(tabId, level, text) {
  const type = level === "error" ? "pharmakon-error" : "pharmakon-loading";
  browser.tabs.sendMessage(tabId, { type, [level === "error" ? "error" : "text"]: text });
}
