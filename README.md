# Pharmakon

A Firefox WebExtension that rewrites harsh or aggressive text on web pages into a tone of your choosing, using Claude.

## Features

- **Auto mode** — click "Scan this page" to automatically detect and soften aggressive passages as you browse
- **Manual mode** — select any text, right-click, and choose *Pharmakon — Rewrite selection*
- **10 tone presets** — casual, formal, ELI5, humorous, neutral, and more
- **3 sensitivity levels** — low, moderate, high
- **Click to toggle** — click any rewritten passage to switch between the original and adjusted text
- **Multilingual** — preserves the language of the original text
- **Two provider modes** — use a local proxy (no API key needed, uses your Claude subscription) or the Anthropic API directly

## Installation

No build step required — load directly in Firefox as a temporary add-on:

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json` from this directory

## Usage

### Local proxy (default)

Uses your Claude Code subscription — no API key needed.

```bash
node proxy.js
# or with options:
node proxy.js --port 7880 --model claude-haiku-4-5-20251001
```

Then open the extension popup, ensure **Provider** is set to `local`, and start browsing.

### Anthropic API

Open the extension popup, set **Provider** to `api`, and enter your Anthropic API key.

## Settings

| Setting | Default | Options |
|---------|---------|---------|
| Tone | `neutral and calm` | 10 presets |
| Sensitivity | `moderate` | low / moderate / high |
| Model | `claude-haiku-4-5-20251001` | Haiku / Sonnet |
| Provider | `local` | local / api |

## File Overview

```
manifest.json        Extension metadata and permissions
background.js        Message router, LLM calls (detection + rewriting), context menu
content.js           DOM patching, blur/reveal, click-toggle
content.css          Styles: blur, highlights, toast overlay
sites.js             Per-site CSS selectors (Twitter, Reddit, Facebook, YouTube, HN)
proxy.js             Local HTTP proxy (port 7880) — bridges extension → claude CLI
popup/               Settings panel (HTML/JS/CSS)
icons/               SVG icons
```

## License

MIT
