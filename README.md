# Pharmakon

A Firefox WebExtension that rewrites harsh or aggressive text on web pages into a tone of your choosing, using Claude. Uses Relational Frame Theory as its analytical lens — instead of swapping vocabulary, it detects and reshapes the underlying frames (opposition, hierarchy, comparison, causation, perspective) to match a target tone.

## Features

- **Auto mode** — toggle ON in the sidebar to automatically detect and rewrite aggressive passages as you browse
- **Manual mode** — select any text, right-click, and choose *Pharmakon — Rewrite selection*
- **11 tone presets** — de-weaponize, neutral, casual, formal, warm, ELI5, humorous, academic, concise, poetic, and more
- **3 sensitivity levels** — low, moderate, high
- **Click to toggle** — click any rewritten passage to switch between the original and adjusted text
- **Multilingual** — preserves the language of the original text
- **Two provider modes** — use a local proxy (no API key needed, uses your Claude subscription) or the Anthropic API directly
- **Sidebar UI** — persistent sidebar panel with health indicator, onboarding wizard, and auto-save
- **Options page** — full-tab settings for provider, API key, model, proxy URL, token management, and debug log
- **Token auth** — shared secret between extension and proxy for security
- **Smart error handling** — contextual error messages with retry buttons

## Installation

No build step required — load directly in Firefox as a temporary add-on:

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json` from this directory

## Usage

### Quick start

1. Install the extension (see above)
2. Click the Pharmakon icon in the toolbar or press `Ctrl+Shift+U` to open the sidebar
3. If using the local proxy, follow the setup instructions shown in the sidebar
4. Toggle **ON** and browse normally — text is blurred until processed

### Local proxy (default)

Uses your Claude Code subscription — no API key needed.

To start the proxy automatically on login, run the install script once:

```bash
./install-proxy-service.sh
```

This installs a systemd user service that starts with your session and restarts on failure. To manage it:

```bash
systemctl --user status pharmakon-proxy
systemctl --user restart pharmakon-proxy
journalctl --user -u pharmakon-proxy -f   # logs
systemctl --user disable pharmakon-proxy  # uninstall
```

Or start it manually:

```bash
node proxy.js
node proxy.js --port 7880 --model claude-haiku-4-5-20251001
node proxy.js --token <TOKEN>   # get token from Settings page
```

The sidebar shows a green dot when the proxy is connected and auto-detects when it comes online.

### Anthropic API

Open the **Settings** page (link in sidebar footer), set **Provider** to `API key`, and enter your Anthropic API key.

## Settings

| Setting | Default | Options |
|---------|---------|---------|
| Tone | de-weaponize | 11 presets |
| Sensitivity | moderate | low / moderate / high |
| Model | claude-haiku-4-5-20251001 | Haiku / Sonnet |
| Provider | local | local / api |
| Proxy Token | auto-generated | shared secret for proxy auth |

## File Overview

```
manifest.json        Extension metadata, sidebar_action, options_ui
background.js        Message router, LLM calls, context menu, sidebar toggle
content.js           DOM patching, blur/reveal, click-toggle, error toast
content.css          Styles: blur, highlights, toast overlay with retry
proxy.js             Local HTTP proxy with /health endpoint and token auth
sidebar/             Sidebar panel (lean main UI)
options/             Options page (full tab, advanced settings)
core/                Platform-agnostic tone engine, prompts, and tone files
surfaces/            Per-site DOM strategies (Twitter, Reddit, Facebook, etc.)
icons/               Extension icons
```

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+U` | Toggle sidebar |

## License

MIT
