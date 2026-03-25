(() => {
  const BATCH_DELAY_MS = 200;        // debounce for subsequent batches (new content)
  const FIRST_BATCH_DELAY_MS = 1500; // longer wait on first batch so page finishes rendering
  const MAX_BATCH_SIZE = 20; // max items per API call
  const PROCESSED_ATTR = "data-pharmakon";

  let enabled = false;
  let surface = null;
  let queue = []; // elements waiting to be processed
  let batchTimer = null;
  let firstBatchSent = false;
  let overlayEl = null;
  let originalRange = null; // for manual selection mode

  // =========================================================================
  // Initialisation — runs at document_start
  // =========================================================================

  browser.storage.local.get({ enabled: true }).then((s) => {
    enabled = s.enabled;
    if (enabled) {
      document.documentElement.classList.add("pharmakon-active");
      boot();
    }
  });

  // Listen for enable/disable toggle from popup
  browser.runtime.onMessage.addListener((msg) => {
    switch (msg.type) {
      case "pharmakon-set-enabled":
        enabled = msg.enabled;
        if (enabled) {
          document.documentElement.classList.add("pharmakon-active");
          boot();
          scanExisting();
        } else {
          document.documentElement.classList.remove("pharmakon-active");
        }
        break;

      case "pharmakon-batch-partial":
        handlePartialResult(msg.batchIndex, msg.item);
        break;

      case "pharmakon-batch-result":
        handleBatchResult(msg.results);
        break;

      case "pharmakon-error":
        hideOverlay();
        showOverlay(msg.error, true);
        setTimeout(hideOverlay, 5000);
        break;

      // Manual selection result (right-click)
      case "pharmakon-selection-result":
        hideOverlay();
        replaceSelection(msg.text);
        break;

      case "pharmakon-loading":
        showOverlay(msg.text || "Processing…");
        break;

      // --- Reader Mode ---
      case "pharmakon-reader-mode":
        if (window.__pharmakonReader && !window.__pharmakonReader.active) {
          const surf = window.__pharmakonResolveSurface
            ? window.__pharmakonResolveSurface(location.hostname)
            : null;
          const data = window.__pharmakonExtractForReader
            ? window.__pharmakonExtractForReader(surf)
            : { type: "feed", title: document.title, items: [] };
          window.__pharmakonReader.enter(data);
        }
        break;

      case "pharmakon-reader-batch-result":
        if (window.__pharmakonReader && window.__pharmakonReader.active) {
          window.__pharmakonReader.handleBatchResult(msg.results);
        }
        break;

      case "pharmakon-reader-batch-partial":
        if (window.__pharmakonReader && window.__pharmakonReader.active) {
          window.__pharmakonReader.handlePartialResult(msg.batchIndex, msg.item);
        }
        break;
    }
  });

  // =========================================================================
  // Boot — resolve surface and set up observer
  // =========================================================================

  let observer = null;

  function boot() {
    if (observer) return; // already running

    surface = window.__pharmakonResolveSurface(location.hostname);
    if (!surface) return;

    // Wait for body to exist (we run at document_start)
    if (document.body) {
      startObserver();
      scanExisting();
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        startObserver();
        scanExisting();
      });
    }

    // Re-scan after page has had time to finish rendering dynamic content.
    // Catches elements that were still loading when the initial scan ran.
    setTimeout(scanExisting, 2000);
  }

  function startObserver() {
    if (!surface.inbound) return; // no inbound config — nothing to observe

    const root =
      (surface.container && document.querySelector(surface.container)) || document.body;

    observer = new MutationObserver(onMutations);
    observer.observe(root, { childList: true, subtree: true });
  }

  // =========================================================================
  // Mutation observer — catch new content as it appears
  // =========================================================================

  function onMutations(mutations) {
    if (!enabled) return;

    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        removeAlarmingIn(node);
        if (surface && surface.inbound) collectContentElements(node);
      }
    }

    if (queue.length > 0) scheduleBatch();
  }

  function collectContentElements(root) {
    const selector = surface.inbound.content;

    // Check if root itself matches
    if (root.matches && root.matches(selector) && !root.hasAttribute(PROCESSED_ATTR)) {
      enqueue(root);
    }
    // Check descendants
    const els = root.querySelectorAll ? root.querySelectorAll(selector) : [];
    for (const el of els) {
      if (!el.hasAttribute(PROCESSED_ATTR)) {
        enqueue(el);
      }
    }
  }

  function enqueue(el) {
    // Mark immediately so we don't double-queue
    el.setAttribute(PROCESSED_ATTR, "pending");
    el.classList.add("pharmakon-pending");
    el.addEventListener("click", onPendingClick);
    queue.push(el);
  }

  function onPendingClick(e) {
    const el = e.currentTarget;
    if (el.classList.contains("pharmakon-pending")) {
      el.classList.toggle("pharmakon-peeking");
    }
  }

  // Scan elements already on the page
  function scanExisting() {
    const root = document.body || document.documentElement;
    removeAlarmingIn(root);
    if (!surface || !surface.inbound) return;
    collectContentElements(root);
    if (queue.length > 0) scheduleBatch();
  }

  // =========================================================================
  // Alarming element removal
  // =========================================================================

  const ALARMING_ATTR = "data-pharmakon-cleaned";

  const ALARMING_TEXT = /^(en\s+directo|breaking(\s+news)?|última\s+hora|urgente|en\s+vivo|directo|live(\s+now)?|alert|noticia\s+urgente|última\s+hora\s+informativa)$/i;

  function isRedish(color) {
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return false;
    const r = +m[1], g = +m[2], b = +m[3];
    return r > 160 && g < 80 && b < 80;
  }

  function isAlarming(el) {
    if (el.hasAttribute(ALARMING_ATTR)) return false;
    if (el.children.length > 3) return false; // too structural
    const text = el.textContent.trim();
    if (text.length === 0 || text.length > 60) return false;
    if (ALARMING_TEXT.test(text)) return true;
    // Red color or background (only check small elements to avoid performance hit)
    const s = window.getComputedStyle(el);
    if (isRedish(s.color) || isRedish(s.backgroundColor)) return true;
    return false;
  }

  function removeAlarmingIn(root) {
    if (!enabled) return;
    const candidates = root.querySelectorAll
      ? root.querySelectorAll("a, span, em, strong, b, small, mark, div, li, p")
      : [];
    for (const el of candidates) {
      if (isAlarming(el)) {
        el.setAttribute(ALARMING_ATTR, "true");
        el.style.display = "none";
      }
    }
    // Check root itself
    if (root !== document.body && root.tagName && isAlarming(root)) {
      root.setAttribute(ALARMING_ATTR, "true");
      root.style.display = "none";
    }
  }

  // =========================================================================
  // Batching — debounce and send to background
  // =========================================================================

  function scheduleBatch() {
    if (batchTimer) clearTimeout(batchTimer);
    const delay = firstBatchSent ? BATCH_DELAY_MS : FIRST_BATCH_DELAY_MS;
    batchTimer = setTimeout(flushBatch, delay);
  }

  function flushBatch() {
    batchTimer = null;
    if (queue.length === 0) return;

    // Sort entire queue by document order (top → bottom) before taking a slice
    queue.sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    );

    // Take up to MAX_BATCH_SIZE items
    const batch = queue.splice(0, MAX_BATCH_SIZE);

    // Extract text, skip elements with very little text
    const items = [];
    for (const el of batch) {
      const text = extractText(el);
      if (text.length < 15) {
        // Too short to be meaningful — unblur immediately, no LLM call
        el.classList.remove("pharmakon-pending", "pharmakon-peeking");
        el.removeEventListener("click", onPendingClick);
        el.setAttribute(PROCESSED_ATTR, "done");
        continue;
      }
      items.push({ el, text });
    }

    if (items.length === 0) {
      // All items were short text — no LLM call needed, proceed to next batch immediately
      if (queue.length > 0) scheduleBatch();
      return;
    }

    // Store element refs by index so we can map results back
    const pendingBatch = items.map((it) => it.el);
    window.__pharmakonPendingBatch = (window.__pharmakonPendingBatch || []).concat([pendingBatch]);

    // Send to background
    firstBatchSent = true;
    browser.runtime.sendMessage({
      type: "pharmakon-batch",
      texts: items.map((it) => it.text),
      batchIndex: (window.__pharmakonPendingBatch || []).length - 1,
    });

    // Next batch is triggered from handleBatchResult to preserve top→bottom order.
    // (Sending all batches at once lets the smallest/fastest finish first, which is
    // usually the bottom of the page.)
  }

  function extractText(el) {
    const skip = surface.inbound && surface.inbound.skip;
    if (!skip) return el.innerText || el.textContent || "";

    const clone = el.cloneNode(true);
    for (const s of clone.querySelectorAll(skip)) {
      s.remove();
    }
    return clone.innerText || clone.textContent || "";
  }

  // =========================================================================
  // Handle results from background
  // =========================================================================

  function handleBatchResult(results) {
    // results: { batchIndex, items: [{index, original, rewritten}] }
    const batches = window.__pharmakonPendingBatch || [];
    const batch = batches[results.batchIndex];
    if (!batch) return;

    // Build a map of index → rewrite
    const rewrites = new Map();
    for (const item of results.items) {
      if (item.rewritten) {
        rewrites.set(item.index, item);
      }
    }

    // Process each element in the batch; null = already handled by a partial
    for (let i = 0; i < batch.length; i++) {
      const el = batch[i];
      if (!el) continue;
      const rewrite = rewrites.get(i);
      revealElement(el, rewrite);
    }

    // Clean up
    batches[results.batchIndex] = null;

    // Trigger the next batch now that this one is done (preserves top→bottom order)
    if (queue.length > 0) scheduleBatch();
  }

  function handlePartialResult(batchIndex, item) {
    const batches = window.__pharmakonPendingBatch || [];
    const batch = batches[batchIndex];
    if (!batch) return;
    const el = batch[item.index];
    if (!el) return; // null = already handled
    batch[item.index] = null; // mark done so batch-result skips it
    revealElement(el, item);
  }

  function revealElement(el, rewrite) {
    el.classList.remove("pharmakon-pending", "pharmakon-peeking");
    el.removeEventListener("click", onPendingClick);
    el.setAttribute(PROCESSED_ATTR, "done");

    if (!rewrite || !rewrite.rewritten) return; // no change needed

    // Store original for toggle
    const originalHTML = el.innerHTML;

    // Apply each patch from the rewrite
    if (rewrite.patches && rewrite.patches.length > 0) {
      for (const patch of rewrite.patches) {
        applyPatchToElement(el, patch.original, patch.rewritten);
      }
    } else if (rewrite.rewritten) {
      // Full element rewrite (fallback)
      el.classList.add("pharmakon-replaced-block");
      el.dataset.pharmakonOriginal = originalHTML;
      el.innerText = rewrite.rewritten;
      el.addEventListener("click", toggleBlockRevert, { once: false });
    }
  }

  function applyPatchToElement(el, searchStr, replacement) {
    // Collect all text nodes with cumulative offsets into the element's full text
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let pos = 0;
    while (walker.nextNode()) {
      const n = walker.currentNode;
      nodes.push({ node: n, start: pos, end: pos + n.textContent.length });
      pos += n.textContent.length;
    }

    const fullText = nodes.map((n) => n.node.textContent).join("");

    // Tolerate whitespace differences (innerText normalizes spaces; DOM nodes may have double spaces)
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
    wrapper.addEventListener("click", toggleInlineRevert);

    range.deleteContents();
    range.insertNode(wrapper);
  }

  // =========================================================================
  // Toggle original/rewritten on click
  // =========================================================================

  function toggleInlineRevert(e) {
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

  function toggleBlockRevert(e) {
    const el = e.currentTarget;
    if (el.dataset.showingOriginal === "true") {
      el.innerHTML = el.dataset.pharmakonRewritten;
      el.dataset.showingOriginal = "false";
      el.classList.remove("pharmakon-showing-original");
    } else {
      el.dataset.pharmakonRewritten = el.innerHTML;
      el.innerHTML = el.dataset.pharmakonOriginal;
      el.dataset.showingOriginal = "true";
      el.classList.add("pharmakon-showing-original");
    }
  }

  // =========================================================================
  // Manual selection mode (right-click → Pharmakon)
  // =========================================================================

  document.addEventListener("mouseup", () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      originalRange = sel.getRangeAt(0).cloneRange();
    }
  });

  function replaceSelection(newText) {
    if (!originalRange) return;
    const originalText = originalRange.toString();
    originalRange.deleteContents();

    const wrapper = document.createElement("span");
    wrapper.className = "pharmakon-replaced";
    wrapper.title = "Click to see original";
    wrapper.textContent = newText;
    wrapper.dataset.pharmakonOriginalText = originalText;
    wrapper.addEventListener("click", toggleInlineRevert);

    originalRange.insertNode(wrapper);
    originalRange = null;
  }

  // =========================================================================
  // Overlay (toast notifications)
  // =========================================================================

  function showOverlay(text, isError = false) {
    hideOverlay();
    overlayEl = document.createElement("div");
    overlayEl.className = "pharmakon-overlay" + (isError ? " pharmakon-error" : "");

    const textSpan = document.createElement("span");
    textSpan.className = "pharmakon-overlay-text";
    textSpan.textContent = friendlyError(text, isError);
    overlayEl.appendChild(textSpan);

    if (isError) {
      const retryBtn = document.createElement("button");
      retryBtn.className = "pharmakon-overlay-retry";
      retryBtn.textContent = "Retry";
      retryBtn.addEventListener("click", () => {
        hideOverlay();
        scanExisting();
      });
      overlayEl.appendChild(retryBtn);

      const closeBtn = document.createElement("button");
      closeBtn.className = "pharmakon-overlay-close";
      closeBtn.textContent = "\u00d7";
      closeBtn.setAttribute("aria-label", "Dismiss");
      closeBtn.addEventListener("click", hideOverlay);
      overlayEl.appendChild(closeBtn);
    }

    document.body.appendChild(overlayEl);
  }

  function friendlyError(msg, isError) {
    if (!isError) return msg;
    if (/fetch|ECONNREFUSED|Failed to fetch|NetworkError/i.test(msg)) {
      return "Proxy unreachable — is it running? Check the sidebar for setup instructions.";
    }
    if (/401|token|unauthorized/i.test(msg)) {
      return "Authentication failed — token mismatch. Check Settings.";
    }
    if (/429|rate.?limit/i.test(msg)) {
      return "Rate limited — too many requests. Wait a moment and retry.";
    }
    if (/403|forbidden/i.test(msg)) {
      return "Access denied — check your API key in Settings.";
    }
    if (/500|internal.?server/i.test(msg)) {
      return "Server error — the proxy or API returned an internal error.";
    }
    return msg;
  }

  function hideOverlay() {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }
})();
