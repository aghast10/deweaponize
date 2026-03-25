// Pharmakon Core — Tone Translation Engine
//
// Platform-agnostic engine for detecting and rewriting tone in text.
// No DOM, no browser APIs, no network calls — just prompt logic and parsing.
//
// Usage:
//   const engine = PharmakonCore.createEngine(transportFn, { detectPrompt, rewritePrompt });
//   const results = await engine.detectBatch(texts, settings);
//   const rewritten = await engine.rewriteSingle(text, settings);
//
// The transportFn signature: (systemPrompt, userContent, settings) => Promise<string>
// detectPrompt / rewritePrompt: markdown template strings loaded by the adaptation layer.
// Each adaptation (browser extension, API server, CLI) provides its own transport and loader.

const PharmakonCore = (() => {
  // =========================================================================
  // Sensitivity descriptions — shared vocabulary across all adaptations
  // =========================================================================

  const SENSITIVITY_DESC = {
    low: "Only flag text whose relational framing strongly clashes with the target tone.",
    moderate:
      "Flag text whose relational framing noticeably diverges from the target tone.",
    high: "Flag any relational framing that differs from the target tone, including subtle or indirect forms.",
  };

  // =========================================================================
  // Template rendering
  // =========================================================================

  function render(template, vars) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
  }

  // =========================================================================
  // Prompt builders
  // =========================================================================

  function buildDetectPrompt(template, texts, settings) {
    const numbered = texts.map((t, i) => `[${i}] ${t}`).join("\n\n");
    const systemPrompt = render(template, {
      sensitivity: settings.sensitivity,
      sensitivity_desc: SENSITIVITY_DESC[settings.sensitivity] || SENSITIVITY_DESC.moderate,
      tone: settings.tone,
    });
    return { systemPrompt, userContent: numbered };
  }

  function buildRewritePrompt(template, text, settings) {
    const systemPrompt = render(template, { tone: settings.tone });
    return { systemPrompt, userContent: text };
  }

  // =========================================================================
  // Response parsers
  // =========================================================================

  function parseDetectResponse(raw, itemCount) {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```$/m, "")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return fallback(itemCount);
    }

    if (!Array.isArray(parsed)) {
      return fallback(itemCount);
    }

    return parsed.map((item) => {
      if (item.action === "rewrite" && item.patches) {
        return { index: item.index, rewritten: true, patches: item.patches };
      }
      return { index: item.index, rewritten: null };
    });
  }

  function fallback(count) {
    return Array.from({ length: count }, (_, i) => ({ index: i, rewritten: null }));
  }

  // =========================================================================
  // Engine factory
  // =========================================================================

  function createEngine(transport, { detectPrompt, rewritePrompt }) {
    return {
      /**
       * Build the detect prompt for a batch without invoking transport.
       * Useful for adaptations that want to manage transport themselves (e.g. streaming).
       */
      buildDetectPrompt(texts, settings) {
        return buildDetectPrompt(detectPrompt, texts, settings);
      },

      /**
       * Detect and rewrite tone issues in a batch of texts.
       * Returns an array of {index, rewritten, patches?} per item.
       */
      async detectBatch(texts, settings) {
        const { systemPrompt, userContent } = buildDetectPrompt(detectPrompt, texts, settings);
        const raw = await transport(systemPrompt, userContent, settings);
        return parseDetectResponse(raw, texts.length);
      },

      /**
       * Rewrite a single text passage into the target tone.
       * Returns the rewritten string.
       */
      async rewriteSingle(text, settings) {
        const { systemPrompt, userContent } = buildRewritePrompt(rewritePrompt, text, settings);
        return transport(systemPrompt, userContent, settings);
      },
    };
  }

  // =========================================================================
  // Public API
  // =========================================================================

  return {
    createEngine,
    parseDetectResponse,
    SENSITIVITY_DESC,
  };
})();

// Support Node.js require() for server-side adaptations
if (typeof module !== "undefined" && module.exports) {
  module.exports = PharmakonCore;
}
