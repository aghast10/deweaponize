// =========================================================================
// De-Weaponize — Options Page (advanced settings, full tab)
// =========================================================================

const providerEl = document.getElementById("provider");
const apiKeyEl = document.getElementById("api-key");
const apiKeyGroup = document.getElementById("api-key-group");
const proxyGroup = document.getElementById("proxy-group");
const proxyUrlEl = document.getElementById("proxy-url");
const toneEl = document.getElementById("tone");
const sensitivityEl = document.getElementById("sensitivity");
const modelEl = document.getElementById("model");
const tokenValue = document.getElementById("token-value");
const saveBar = document.getElementById("save-bar");

const TONE_SLUGS = [
  "de-weaponize", "neutral", "casual", "formal", "warm",
  "eli5", "humorous", "academic", "concise", "poetic", "nacional",
];

// =========================================================================
// Tabs
// =========================================================================

const tabBtns = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabBtns.forEach((b) => b.setAttribute("aria-selected", "false"));
    tabPanels.forEach((p) => p.classList.remove("active"));
    btn.setAttribute("aria-selected", "true");
    document.getElementById(btn.getAttribute("aria-controls")).classList.add("active");
  });
});

// =========================================================================
// Load tones
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
// Init
// =========================================================================

loadTones().then((defaultTone) => {
  return browser.storage.local.get({
    apiKey: "",
    tone: defaultTone,
    sensitivity: "moderate",
    model: "claude-haiku-4-5-20251001",
    provider: "local",
    proxyUrl: "http://127.0.0.1:7880",
    proxyToken: "",
  });
}).then((s) => {
  providerEl.value = s.provider;
  apiKeyEl.value = s.apiKey;
  proxyUrlEl.value = s.proxyUrl;
  toneEl.value = s.tone;
  sensitivityEl.value = s.sensitivity;
  modelEl.value = s.model;
  displayToken(s.proxyToken);
  updateProviderUI(s.provider);
});

// Version info
const manifest = browser.runtime.getManifest();
document.getElementById("version").textContent = `v${manifest.version}`;
document.getElementById("footer-version").textContent = `v${manifest.version}`;

// =========================================================================
// Provider UI toggle
// =========================================================================

providerEl.addEventListener("change", () => updateProviderUI(providerEl.value));

function updateProviderUI(provider) {
  if (provider === "api") {
    apiKeyGroup.classList.remove("hidden");
    proxyGroup.classList.add("hidden");
  } else {
    apiKeyGroup.classList.add("hidden");
    proxyGroup.classList.remove("hidden");
  }
}

// =========================================================================
// API key show/hide
// =========================================================================

document.getElementById("toggle-key-vis").addEventListener("click", () => {
  const btn = document.getElementById("toggle-key-vis");
  if (apiKeyEl.type === "password") {
    apiKeyEl.type = "text";
    btn.textContent = "Hide";
  } else {
    apiKeyEl.type = "password";
    btn.textContent = "Show";
  }
});

// =========================================================================
// Auto-save with debounce
// =========================================================================

let saveTimer = null;

function saveSettings() {
  clearTimeout(saveTimer);
  saveBar.className = "save-status saving";

  saveTimer = setTimeout(() => {
    browser.storage.local.set({
      provider: providerEl.value,
      apiKey: apiKeyEl.value.trim(),
      proxyUrl: proxyUrlEl.value.trim(),
      tone: toneEl.value,
      sensitivity: sensitivityEl.value,
      model: modelEl.value,
    });
    saveBar.className = "save-status saved";
    setTimeout(() => { saveBar.className = "save-status"; }, 800);
  }, 500);
}

for (const el of [providerEl, apiKeyEl, proxyUrlEl, toneEl, sensitivityEl, modelEl]) {
  el.addEventListener("change", saveSettings);
  el.addEventListener("input", saveSettings);
}

// Sync changes from sidebar
browser.storage.onChanged.addListener((changes) => {
  if (changes.tone && changes.tone.newValue !== toneEl.value) toneEl.value = changes.tone.newValue;
  if (changes.sensitivity && changes.sensitivity.newValue !== sensitivityEl.value) sensitivityEl.value = changes.sensitivity.newValue;
  if (changes.proxyToken) displayToken(changes.proxyToken.newValue);
});

// =========================================================================
// Token management
// =========================================================================

function displayToken(token) {
  tokenValue.textContent = token || "(none — proxy is open access)";
}

function generateToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

document.getElementById("copy-token").addEventListener("click", async () => {
  const { proxyToken } = await browser.storage.local.get({ proxyToken: "" });
  if (!proxyToken) return;
  const btn = document.getElementById("copy-token");
  navigator.clipboard.writeText(proxyToken).then(() => {
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = "Copy"; }, 2000);
  });
});

document.getElementById("regen-token").addEventListener("click", async () => {
  const token = generateToken();
  await browser.storage.local.set({ proxyToken: token });
  displayToken(token);
});

// =========================================================================
// Debug log
// =========================================================================

const debugLogEl = document.getElementById("debug-log");

async function refreshDebugLog() {
  const resp = await browser.runtime.sendMessage({ type: "dwz-get-debug-log" });
  if (!resp || !resp.log) {
    debugLogEl.textContent = "(no entries)";
    return;
  }
  debugLogEl.textContent = resp.log.length ? resp.log.join("\n") : "(no entries)";
}

document.getElementById("debug-refresh").addEventListener("click", refreshDebugLog);
document.getElementById("debug-clear").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "dwz-clear-debug-log" });
  debugLogEl.textContent = "(cleared)";
});
