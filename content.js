(() => {
  const BATCH_DELAY_MS = 800; // debounce before sending a batch to the API
  const MAX_BATCH_SIZE = 20; // max items per API call
  const PROCESSED_ATTR = "data-pharmakon";

  let enabled = false;
  let surface = null;
  let queue = []; // elements waiting to be processed
  let batchTimer = null;
  let overlayEl = null;
  let originalRange = null; // for manual selection mode

  // =========================================================================
  // Initialisation — runs at document_start
  // =========================================================================

  browser.storage.local.get({ enabled: false }).then((s) => {
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
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        startObserver();
        scanExisting();
      });
    }
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
    if (!enabled || !surface.inbound) return;

    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        collectContentElements(node);
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
    // Apply blur to this element until it's processed
    el.classList.add("pharmakon-pending");
    queue.push(el);
  }

  // Scan elements already on the page
  function scanExisting() {
    if (!surface || !surface.inbound) return;
    const root = document.body || document.documentElement;
    collectContentElements(root);
    if (queue.length > 0) scheduleBatch();
  }

  // =========================================================================
  // Batching — debounce and send to background
  // =========================================================================

  function scheduleBatch() {
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(flushBatch, BATCH_DELAY_MS);
  }

  function flushBatch() {
    batchTimer = null;
    if (queue.length === 0) return;

    // Take up to MAX_BATCH_SIZE items
    const batch = queue.splice(0, MAX_BATCH_SIZE);

    // Extract text, skip elements with very little text
    const items = [];
    for (const el of batch) {
      const text = extractText(el);
      if (text.length < 15) {
        // Too short to be meaningful, just reveal it
        revealElement(el, null);
        continue;
      }
      items.push({ el, text });
    }

    if (items.length === 0) {
      if (queue.length > 0) scheduleBatch();
      return;
    }

    // Store element refs by index so we can map results back
    const pendingBatch = items.map((it) => it.el);
    window.__pharmakonPendingBatch = (window.__pharmakonPendingBatch || []).concat([pendingBatch]);

    // Send to background
    browser.runtime.sendMessage({
      type: "pharmakon-batch",
      texts: items.map((it) => it.text),
      batchIndex: (window.__pharmakonPendingBatch || []).length - 1,
    });

    // If there's more in the queue, schedule another flush
    if (queue.length > 0) scheduleBatch();
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

    // Process each element in the batch
    for (let i = 0; i < batch.length; i++) {
      const el = batch[i];
      const rewrite = rewrites.get(i);
      revealElement(el, rewrite);
    }

    // Clean up
    batches[results.batchIndex] = null;
  }

  function revealElement(el, rewrite) {
    el.classList.remove("pharmakon-pending");
    el.setAttribute(PROCESSED_ATTR, "done");

    if (!rewrite) return; // no change needed

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
    overlayEl.textContent = text;
    document.body.appendChild(overlayEl);
  }

  function hideOverlay() {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }
})();
