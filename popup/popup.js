const providerEl = document.getElementById("provider");
const apiKeyEl = document.getElementById("api-key");
const apiKeyGroup = document.getElementById("api-key-group");
const proxyGroup = document.getElementById("proxy-group");
const proxyUrlEl = document.getElementById("proxy-url");
const toneEl = document.getElementById("tone");
const sensitivityEl = document.getElementById("sensitivity");
const modelEl = document.getElementById("model");
const modelGroup = document.getElementById("model-group");
const toggleBtn = document.getElementById("toggle-btn");
const statusEl = document.getElementById("status");

const TONE_SLUGS = [
  "de-weaponize", "neutral", "casual", "formal", "warm",
  "eli5", "humorous", "academic", "concise", "poetic", "nacional",
];

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

  return tones[0].value; // default: first tone
}

// Initialize: load tones then settings
loadTones().then((defaultTone) => {
  return browser.storage.local.get({
    apiKey: "",
    tone: defaultTone,
    sensitivity: "moderate",
    model: "claude-haiku-4-5-20251001",
    enabled: false,
    provider: "local",
    proxyUrl: "http://127.0.0.1:7880",
  });
}).then((s) => {
  providerEl.value = s.provider;
  apiKeyEl.value = s.apiKey;
  proxyUrlEl.value = s.proxyUrl;
  toneEl.value = s.tone;
  sensitivityEl.value = s.sensitivity;
  modelEl.value = s.model;
  setToggleState(s.enabled);
  updateProviderUI(s.provider);
});

// Auto-save settings on change
for (const el of [providerEl, apiKeyEl, proxyUrlEl, toneEl, sensitivityEl, modelEl]) {
  el.addEventListener("change", saveSettings);
  el.addEventListener("input", saveSettings);
}

// Show/hide fields based on provider
providerEl.addEventListener("change", () => updateProviderUI(providerEl.value));

function updateProviderUI(provider) {
  if (provider === "api") {
    apiKeyGroup.classList.remove("hidden");
    modelGroup.classList.remove("hidden");
    proxyGroup.classList.add("hidden");
  } else {
    apiKeyGroup.classList.add("hidden");
    modelGroup.classList.add("hidden");
    proxyGroup.classList.remove("hidden");
  }
}

function saveSettings() {
  browser.storage.local.set({
    provider: providerEl.value,
    apiKey: apiKeyEl.value.trim(),
    proxyUrl: proxyUrlEl.value.trim(),
    tone: toneEl.value,
    sensitivity: sensitivityEl.value,
    model: modelEl.value,
  });
  statusEl.textContent = "Saved";
  statusEl.style.color = "";
  setTimeout(() => (statusEl.textContent = ""), 1500);
}

// Toggle ON/OFF
toggleBtn.addEventListener("click", async () => {
  const settings = await browser.storage.local.get({ enabled: false, provider: "local", apiKey: "" });

  if (settings.provider === "api" && !settings.apiKey) {
    statusEl.textContent = "Enter an API key first";
    statusEl.style.color = "#f66";
    setTimeout(() => { statusEl.textContent = ""; statusEl.style.color = ""; }, 3000);
    return;
  }

  const newState = !settings.enabled;
  await browser.storage.local.set({ enabled: newState });
  setToggleState(newState);

  // Notify ALL tabs
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    browser.tabs.sendMessage(tab.id, {
      type: "pharmakon-set-enabled",
      enabled: newState,
    }).catch(() => {});
  }
});

function setToggleState(on) {
  toggleBtn.textContent = on ? "ON" : "OFF";
  toggleBtn.className = "toggle " + (on ? "on" : "off");
}

// Debug log
const debugLogEl = document.getElementById("debug-log");
const debugSection = document.getElementById("debug-section");

async function refreshDebugLog() {
  const resp = await browser.runtime.sendMessage({ type: "pharmakon-get-debug-log" });
  if (!resp || !resp.log) {
    debugLogEl.textContent = "(no entries)";
    return;
  }
  debugLogEl.textContent = resp.log.length ? resp.log.join("\n") : "(no entries)";
}

document.getElementById("debug-refresh").addEventListener("click", refreshDebugLog);
document.getElementById("debug-clear").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "pharmakon-get-debug-log" }); // prime
  debugLogEl.textContent = "(cleared — new entries will appear after next activity)";
});

debugSection.addEventListener("toggle", () => {
  if (debugSection.open) refreshDebugLog();
});
