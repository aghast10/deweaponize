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

// Load saved settings
browser.storage.local
  .get({
    apiKey: "",
    tone: "neutral and calm",
    sensitivity: "moderate",
    model: "claude-haiku-4-5-20251001",
    enabled: false,
    provider: "local",
    proxyUrl: "http://127.0.0.1:7880",
  })
  .then((s) => {
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
