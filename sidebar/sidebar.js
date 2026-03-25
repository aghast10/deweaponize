// =========================================================================
// De-Weaponize — Sidebar (lean main UI)
// =========================================================================

const toneEl = document.getElementById("tone");
const sensitivityEl = document.getElementById("sensitivity");
const toggleBtn = document.getElementById("toggle-btn");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const saveFlash = document.getElementById("save-flash");
const setupWizard = document.getElementById("setup-wizard");
const setupCmd = document.getElementById("setup-cmd");
const copyCmd = document.getElementById("copy-cmd");
const setupTokenHint = document.getElementById("setup-token-hint");
const versionInfo = document.getElementById("version-info");
const debugToggle = document.getElementById("debug-toggle");
const debugPanel = document.getElementById("debug-panel");
const debugLogEl = document.getElementById("debug-log");

const TONE_SLUGS = [
  "de-weaponize",
];

// =========================================================================
// Load tones from .md files
// =========================================================================

async function loadTones() {
  const tones = await Promise.all(TONE_SLUGS.map(async (slug) => {
    const url = browser.runtime.getURL(`core/tones/${slug}.md`);
    const text = await fetch(url).then((r) => r.text());
    const lines = text.trim().split("\n");
    const label = lines[0].replace(/^#\s*/, "");
    const value = lines.slice(1).join("\n").trim();
    return { label, value };
  }));

  toneEl.innerHTML = "";
  for (const { label, value } of tones) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    toneEl.appendChild(opt);
  }

  return tones[0].value;
}

// =========================================================================
// Init: load tones → load settings → start health polling
// =========================================================================

loadTones().then((defaultTone) => {
  return browser.storage.local.get({
    tone: defaultTone,
    sensitivity: "moderate",
    enabled: true,
    provider: "local",
    proxyUrl: "http://127.0.0.1:7880",
    proxyToken: "",
  });
}).then((s) => {
  toneEl.value = s.tone;
  sensitivityEl.value = s.sensitivity;
  setToggleState(s.enabled);
  updateSetupCommand(s.proxyToken);
  startHealthPolling(s);
});

// Show version
const manifest = browser.runtime.getManifest();
versionInfo.textContent = `v${manifest.version}`;

// =========================================================================
// Auto-save with debounce
// =========================================================================

let saveTimer = null;

function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    browser.storage.local.set({
      tone: toneEl.value,
      sensitivity: sensitivityEl.value,
    });
    showSaveFlash();
  }, 500);
}

function showSaveFlash() {
  saveFlash.textContent = "Saved";
  saveFlash.classList.add("visible");
  setTimeout(() => {
    saveFlash.classList.remove("visible");
  }, 1500);
}

toneEl.addEventListener("change", saveSettings);
sensitivityEl.addEventListener("change", saveSettings);

// =========================================================================
// Toggle ON/OFF
// =========================================================================

toggleBtn.addEventListener("click", async () => {
  const settings = await browser.storage.local.get({ enabled: true, provider: "local", apiKey: "", openaiKey: "" });

  if (settings.provider === "api" && !settings.apiKey) {
    statusText.textContent = "Set an Anthropic API key in Settings first";
    statusDot.className = "status-dot error";
    return;
  }
  if (settings.provider === "openai" && !settings.openaiKey) {
    statusText.textContent = "Set an OpenAI API key in Settings first";
    statusDot.className = "status-dot error";
    return;
  }

  const newState = !settings.enabled;
  await browser.storage.local.set({ enabled: newState });
  setToggleState(newState);

  // Notify all tabs
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    browser.tabs.sendMessage(tab.id, {
      type: "dwz-set-enabled",
      enabled: newState,
    }).catch(() => {});
  }
});

function setToggleState(on) {
  toggleBtn.textContent = on ? "ON" : "OFF";
  toggleBtn.className = "toggle " + (on ? "on" : "off");
  toggleBtn.setAttribute("aria-checked", on ? "true" : "false");
}

// Listen for external changes (e.g. from options page)
browser.storage.onChanged.addListener((changes) => {
  if (changes.enabled) setToggleState(changes.enabled.newValue);
  if (changes.tone && changes.tone.newValue !== toneEl.value) toneEl.value = changes.tone.newValue;
  if (changes.sensitivity && changes.sensitivity.newValue !== sensitivityEl.value) sensitivityEl.value = changes.sensitivity.newValue;
  if (changes.proxyToken) updateSetupCommand(changes.proxyToken.newValue);
});

// =========================================================================
// Debug log
// =========================================================================

debugToggle.addEventListener("click", () => {
  const open = debugPanel.hidden;
  debugPanel.hidden = !open;
  debugToggle.setAttribute("aria-expanded", open ? "true" : "false");
});

async function refreshDebugLog() {
  const resp = await browser.runtime.sendMessage({ type: "dwz-get-debug-log" });
  if (!resp || !resp.log) { debugLogEl.textContent = "(no entries)"; return; }
  debugLogEl.textContent = resp.log.length ? resp.log.join("\n") : "(no entries)";
}

document.getElementById("debug-refresh").addEventListener("click", refreshDebugLog);
document.getElementById("debug-clear").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "dwz-clear-debug-log" });
  debugLogEl.textContent = "(cleared)";
});

// =========================================================================
// Health check polling
// =========================================================================

let healthInterval = null;
let lastHealthy = 0;
const GRACE_PERIOD_MS = 90000; // 90s transient grace period

function startHealthPolling(settings) {
  checkHealth(settings);
  healthInterval = setInterval(() => {
    browser.storage.local.get({
      provider: "local",
      proxyUrl: "http://127.0.0.1:7880",
      proxyToken: "",
      apiKey: "",
      openaiKey: "",
    }).then(checkHealth);
  }, 5000);
}

async function checkHealth(settings) {
  if (settings.provider === "api") {
    if (settings.apiKey) {
      setHealthOk("Anthropic API configured");
    } else {
      setHealthError("No Anthropic API key — set one in Settings");
      setupWizard.classList.remove("visible");
    }
    return;
  }

  if (settings.provider === "openai") {
    if (settings.openaiKey) {
      setHealthOk("OpenAI API configured");
    } else {
      setHealthError("No OpenAI API key — set one in Settings");
      setupWizard.classList.remove("visible");
    }
    return;
  }

  // Local proxy mode — hit /health
  const url = (settings.proxyUrl || "http://127.0.0.1:7880") + "/health";
  try {
    const fetchOpts = { signal: AbortSignal.timeout(3000) };
    if (settings.proxyToken) {
      fetchOpts.headers = { "Authorization": `Bearer ${settings.proxyToken}` };
    }
    const resp = await fetch(url, fetchOpts);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    if (data.authenticated === false) {
      setHealthWarn("Proxy online, token mismatch — check Settings");
      setupWizard.classList.remove("visible");
    } else {
      setHealthOk(`Connected — ${data.backend} / ${data.model}`);
      setupWizard.classList.remove("visible");
      lastHealthy = Date.now();
    }
  } catch (err) {
    // Transient grace period
    if (Date.now() - lastHealthy < GRACE_PERIOD_MS && lastHealthy > 0) {
      setHealthWarn("Reconnecting...");
    } else {
      setHealthError("Proxy unreachable");
      setupWizard.classList.add("visible");
    }
  }
}

function setHealthOk(msg) {
  statusDot.className = "status-dot ok";
  statusText.textContent = msg;
}

function setHealthWarn(msg) {
  statusDot.className = "status-dot warn";
  statusText.textContent = msg;
}

function setHealthError(msg) {
  statusDot.className = "status-dot error";
  statusText.textContent = msg;
}

// =========================================================================
// Setup command + copy
// =========================================================================

function updateSetupCommand(token) {
  if (token) {
    setupCmd.textContent = `node proxy.js --token ${token}`;
    setupTokenHint.style.display = "block";
  } else {
    setupCmd.textContent = "node proxy.js";
    setupTokenHint.style.display = "none";
  }
}

copyCmd.addEventListener("click", () => {
  navigator.clipboard.writeText(setupCmd.textContent).then(() => {
    copyCmd.textContent = "Copied!";
    setTimeout(() => { copyCmd.textContent = "Copy"; }, 2000);
  });
});
