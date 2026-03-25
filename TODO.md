# De-Weaponize — Future Ideas

## New Adaptations

- **WhatsApp companion app** — Standalone local web app for outbound message rewriting. User writes a message, picks a recipient with a saved tone profile, LLM rewrites, then sends via `whatsapp://` deep link or clipboard. Uses existing core engine + proxy.js transport. Per-recipient tone profiles are the key feature ("formal" for boss, "casual" for friends, "gentle" for mom).

## Surfaces

- More site-specific surfaces as needed (current: Twitter, Reddit, Facebook, YouTube, Hacker News, generic fallback)

## Big Ideas

- **Send/receive prompt negotiation** — Each user has two prompts: a send prompt ("how I want to come across") and a receive prompt ("how I want to receive messages"). When two De-Weaponize users communicate, the system negotiates a "channel style" that satisfies both constraints — like a TLS handshake for tone. The negotiated style persists for that pair; either party can adjust, triggering renegotiation. This turns De-Weaponize from a single-user tool into a communication protocol with network effects.

## Core

- Support for paired prompt negotiation (merge/reconcile sender's send prompt with receiver's receive prompt into a channel style)
