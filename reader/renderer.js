// =========================================================================
// Pharmakon Reader Mode — Renderer
//
// Manages the reader view lifecycle: enter, render items, apply patches,
// handle toggles, exit. Fetches reader.css dynamically and injects it.
//
// Exposes: window.__pharmakonReader
// =========================================================================

(() => {
  const MAX_BATCH_SIZE = 20;

  let active = false;
  let items = [];          // extracted items: [{text, tag?}]
  let pendingBatches = []; // [{startIdx, count}]
  let currentBatch = 0;
  let showingOriginals = false;
  let cssLoaded = false;
  let cssText = "";
  let toneLabelText = "";

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  window.__pharmakonReader = {
    get active() { return active; },

    async enter(data) {
      if (active) return;
      active = true;
      items = data.items || [];

      // Load settings for tone label
      try {
        const settings = await browser.runtime.sendMessage({ type: "pharmakon-get-settings" });
        // Extract first line of tone as label (tone files start with strategy prose)
        toneLabelText = (settings.tone || "").split("\n")[0].slice(0, 40);
      } catch {
        toneLabelText = "";
      }

      // Load CSS if not cached
      if (!cssLoaded) {
        try {
          const url = browser.runtime.getURL("reader/reader.css");
          cssText = await fetch(url).then((r) => r.text());
          cssLoaded = true;
        } catch {
          cssText = "";
        }
      }

      render(data);
      sendBatches();
    },

    exit() {
      exitReaderMode();
    },

    handleBatchResult(results) {
      if (!active) return;
      const batch = pendingBatches[results.batchIndex];
      if (!batch) return;

      for (const item of results.items) {
        if (item.rewritten) {
          const globalIdx = batch.startIdx + item.index;
          applyResult(globalIdx, item);
        } else {
          // No change — just unblur
          const globalIdx = batch.startIdx + item.index;
          unblur(globalIdx);
        }
      }

      // Send next batch
      currentBatch++;
      if (currentBatch < pendingBatches.length) {
        sendOneBatch(currentBatch);
      }
    },

    handlePartialResult(batchIndex, item) {
      if (!active) return;
      const batch = pendingBatches[batchIndex];
      if (!batch) return;
      const globalIdx = batch.startIdx + item.index;
      if (item.rewritten) {
        applyResult(globalIdx, item);
      } else {
        unblur(globalIdx);
      }
    },
  };

  // -----------------------------------------------------------------------
  // Render the reader view
  // -----------------------------------------------------------------------

  function render(data) {
    // Replace the entire page
    const html = document.documentElement;
    html.innerHTML = "";

    // Inject CSS
    const head = document.createElement("head");
    const meta = document.createElement("meta");
    meta.setAttribute("charset", "UTF-8");
    head.appendChild(meta);

    if (cssText) {
      const style = document.createElement("style");
      style.textContent = cssText;
      head.appendChild(style);
    }

    html.appendChild(head);

    const body = document.createElement("body");
    body.style.margin = "0";
    body.style.padding = "0";
    body.style.background = "#121220";

    const root = document.createElement("div");
    root.className = "pharmakon-reader";

    // --- Toolbar ---
    const toolbar = document.createElement("div");
    toolbar.className = "pharmakon-reader-toolbar";

    const toolbarLeft = document.createElement("div");
    toolbarLeft.className = "pharmakon-reader-toolbar-left";

    const exitBtn = document.createElement("button");
    exitBtn.className = "pharmakon-reader-exit";
    exitBtn.textContent = "\u2190 Back to page";
    exitBtn.addEventListener("click", exitReaderMode);

    const brand = document.createElement("span");
    brand.className = "pharmakon-reader-brand";
    brand.textContent = "Pharmakon";

    const toneLabel = document.createElement("span");
    toneLabel.className = "pharmakon-reader-tone-label";
    toneLabel.textContent = toneLabelText ? `Tone: ${toneLabelText}` : "";

    toolbarLeft.appendChild(exitBtn);
    toolbarLeft.appendChild(brand);
    toolbarLeft.appendChild(toneLabel);

    const toggleAllBtn = document.createElement("button");
    toggleAllBtn.className = "pharmakon-reader-toggle-all";
    toggleAllBtn.textContent = "Show originals";
    toggleAllBtn.addEventListener("click", toggleAll);

    toolbar.appendChild(toolbarLeft);
    toolbar.appendChild(toggleAllBtn);
    root.appendChild(toolbar);

    // --- Header ---
    const header = document.createElement("div");
    header.className = "pharmakon-reader-header";

    const title = document.createElement("h1");
    title.className = "pharmakon-reader-title";
    title.textContent = data.title || "";

    header.appendChild(title);

    if (data.byline || data.siteName) {
      const byline = document.createElement("p");
      byline.className = "pharmakon-reader-byline";
      const parts = [data.byline, data.siteName].filter(Boolean);
      byline.textContent = parts.join(" \u00B7 ");
      header.appendChild(byline);
    }

    if (data.type === "feed") {
      const meta = document.createElement("p");
      meta.className = "pharmakon-reader-meta";
      meta.textContent = `${items.length} item${items.length !== 1 ? "s" : ""} captured`;
      header.appendChild(meta);
    }

    root.appendChild(header);

    // --- Content ---
    if (data.type === "article") {
      const body = document.createElement("article");
      body.className = "pharmakon-reader-body";

      for (let i = 0; i < items.length; i++) {
        const el = document.createElement("p");
        el.className = "pharmakon-reader-paragraph pharmakon-reader-pending";
        el.setAttribute("data-pharmakon-reader-idx", i);
        if (items[i].tag) el.setAttribute("data-tag", items[i].tag);
        el.textContent = items[i].text;
        body.appendChild(el);
      }

      root.appendChild(body);
    } else {
      const feed = document.createElement("div");
      feed.className = "pharmakon-reader-feed";

      for (let i = 0; i < items.length; i++) {
        const el = document.createElement("div");
        el.className = "pharmakon-reader-item pharmakon-reader-pending";
        el.setAttribute("data-pharmakon-reader-idx", i);

        const p = document.createElement("p");
        p.textContent = items[i].text;
        el.appendChild(p);

        feed.appendChild(el);
      }

      root.appendChild(feed);
    }

    body.appendChild(root);
    html.appendChild(body);

    // Keyboard shortcut: Escape to exit
    document.addEventListener("keydown", onKeyDown);
  }

  function onKeyDown(e) {
    if (e.key === "Escape" && active) {
      exitReaderMode();
    }
  }

  // -----------------------------------------------------------------------
  // Batch orchestration
  // -----------------------------------------------------------------------

  function sendBatches() {
    if (items.length === 0) return;

    // Split items into batches of MAX_BATCH_SIZE
    pendingBatches = [];
    for (let i = 0; i < items.length; i += MAX_BATCH_SIZE) {
      const count = Math.min(MAX_BATCH_SIZE, items.length - i);
      pendingBatches.push({ startIdx: i, count });
    }

    currentBatch = 0;
    sendOneBatch(0);
  }

  function sendOneBatch(batchIdx) {
    const batch = pendingBatches[batchIdx];
    if (!batch) return;

    const texts = [];
    for (let i = 0; i < batch.count; i++) {
      texts.push(items[batch.startIdx + i].text);
    }

    browser.runtime.sendMessage({
      type: "pharmakon-reader-batch",
      texts,
      batchIndex: batchIdx,
    });
  }

  // -----------------------------------------------------------------------
  // Apply results to DOM
  // -----------------------------------------------------------------------

  function getElement(globalIdx) {
    return document.querySelector(`[data-pharmakon-reader-idx="${globalIdx}"]`);
  }

  function unblur(globalIdx) {
    const el = getElement(globalIdx);
    if (el) el.classList.remove("pharmakon-reader-pending");
  }

  function applyResult(globalIdx, result) {
    const el = getElement(globalIdx);
    if (!el) return;
    el.classList.remove("pharmakon-reader-pending");

    if (!result.patches || result.patches.length === 0) return;

    // Store original text for toggle
    el.setAttribute("data-pharmakon-original-html", el.innerHTML);

    // Apply patches via TreeWalker
    for (const patch of result.patches) {
      applyPatch(el, patch.original, patch.rewritten);
    }
  }

  function applyPatch(el, searchStr, replacement) {
    // TreeWalker-based text-node patching (same logic as content.js)
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let pos = 0;
    while (walker.nextNode()) {
      const n = walker.currentNode;
      nodes.push({ node: n, start: pos, end: pos + n.textContent.length });
      pos += n.textContent.length;
    }

    const fullText = nodes.map((n) => n.node.textContent).join("");

    // Tolerate whitespace differences
    const escaped = searchStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flexRegex = new RegExp(escaped.replace(/\s+/g, "\\s*"), "s");
    const match = flexRegex.exec(fullText);
    if (!match) return;

    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;

    const startEntry = nodes.find((n) => matchStart >= n.start && matchStart < n.end);
    const endEntry = nodes.find((n) => matchEnd > n.start && matchEnd <= n.end);
    if (!startEntry || !endEntry) return;

    const range = document.createRange();
    range.setStart(startEntry.node, matchStart - startEntry.start);
    range.setEnd(endEntry.node, matchEnd - endEntry.start);

    const wrapper = document.createElement("span");
    wrapper.className = "pharmakon-replaced";
    wrapper.title = "Click to see original";
    wrapper.textContent = replacement;
    wrapper.dataset.pharmakonOriginalText = searchStr;
    wrapper.addEventListener("click", toggleInline);

    range.deleteContents();
    range.insertNode(wrapper);
  }

  // -----------------------------------------------------------------------
  // Toggle original ↔ adjusted
  // -----------------------------------------------------------------------

  function toggleInline(e) {
    e.stopPropagation();
    const el = e.currentTarget;
    if (el.dataset.showingOriginal === "true") {
      el.textContent = el.dataset.pharmakonRewritten;
      el.dataset.showingOriginal = "false";
      el.classList.remove("pharmakon-showing-original");
    } else {
      el.dataset.pharmakonRewritten = el.textContent;
      el.textContent = el.dataset.pharmakonOriginalText;
      el.dataset.showingOriginal = "true";
      el.classList.add("pharmakon-showing-original");
    }
  }

  function toggleAll() {
    const spans = document.querySelectorAll(".pharmakon-reader .pharmakon-replaced");
    if (spans.length === 0) return;

    showingOriginals = !showingOriginals;

    for (const span of spans) {
      const isShowingOrig = span.dataset.showingOriginal === "true";
      if (showingOriginals && !isShowingOrig) {
        span.click();
      } else if (!showingOriginals && isShowingOrig) {
        span.click();
      }
    }

    const btn = document.querySelector(".pharmakon-reader-toggle-all");
    if (btn) btn.textContent = showingOriginals ? "Show adjusted" : "Show originals";
  }

  // -----------------------------------------------------------------------
  // Exit
  // -----------------------------------------------------------------------

  function exitReaderMode() {
    if (!active) return;
    active = false;
    items = [];
    pendingBatches = [];
    currentBatch = 0;
    showingOriginals = false;
    document.removeEventListener("keydown", onKeyDown);
    window.location.reload();
  }
})();
