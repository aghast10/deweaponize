// =========================================================================
// Pharmakon Reader Mode — Content Extractor
//
// Dual-path extraction:
//   1. Feed/thread pages (known surfaces) → collect items via surface selectors
//   2. Article pages → Mozilla Readability.js
//   3. Fallback → surface selectors on unknown pages
//
// Exposes: window.__pharmakonExtractForReader(surface)
// Returns: { type: "article"|"feed", title, byline, siteName, items: [{text, tag?}] }
// =========================================================================

window.__pharmakonExtractForReader = function (surface) {
  const FEED_SURFACES = ["twitter", "reddit", "hackernews", "youtube", "facebook"];

  if (surface && FEED_SURFACES.includes(surface.name)) {
    return extractFeed(surface);
  }

  const article = extractArticle();
  if (article) return article;

  // Fallback: treat as feed using surface selectors
  return extractFeed(surface);
};

function extractArticle() {
  // Readability mutates the DOM — clone first
  const clone = document.cloneNode(true);
  let result;
  try {
    result = new Readability(clone).parse();
  } catch {
    return null;
  }

  if (!result || !result.textContent || result.textContent.length < 200) return null;

  // Parse the HTML content into text blocks.
  // Walk the tree and collect leaf-level block elements (elements whose children
  // are all inline or text). This avoids both missing content (divs, tables) and
  // double-counting (a <p> inside an <li>).
  const div = document.createElement("div");
  div.innerHTML = result.content;
  const items = [];
  const seen = new Set(); // track text to skip duplicates from nesting

  collectBlocks(div, items, seen);

  return {
    type: "article",
    title: result.title || document.title,
    byline: result.byline || "",
    siteName: result.siteName || location.hostname,
    items,
  };
}

// Inline-level tags that don't form their own block
const INLINE_TAGS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn",
  "em", "i", "kbd", "mark", "q", "rp", "rt", "ruby", "s", "samp",
  "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
]);

function isLeafBlock(el) {
  // A leaf block has no block-level children — only text and inline elements
  for (const child of el.children) {
    if (!INLINE_TAGS.has(child.tagName.toLowerCase())) return false;
  }
  return true;
}

function tagFor(el) {
  const tag = el.tagName.toLowerCase();
  // Propagate semantic tag from ancestors (e.g. p inside blockquote → blockquote)
  if (el.closest("blockquote") && tag !== "blockquote") return "blockquote";
  return tag;
}

function collectBlocks(root, items, seen) {
  for (const child of root.children) {
    const tag = child.tagName.toLowerCase();

    // Skip non-content elements
    if (tag === "figure" || tag === "img" || tag === "svg" || tag === "video" ||
        tag === "audio" || tag === "iframe" || tag === "script" || tag === "style") {
      // But check for figcaption inside figure
      if (tag === "figure") {
        const cap = child.querySelector("figcaption");
        if (cap) {
          const text = cap.textContent.trim();
          if (text.length > 5 && !seen.has(text)) {
            seen.add(text);
            items.push({ text, tag: "figcaption" });
          }
        }
      }
      continue;
    }

    if (isLeafBlock(child)) {
      const text = child.textContent.trim();
      if (text.length > 5 && !seen.has(text)) {
        seen.add(text);
        items.push({ text, tag: tagFor(child) });
      }
    } else {
      // Recurse into container elements (div, section, article, etc.)
      collectBlocks(child, items, seen);
    }
  }
}

function extractFeed(surface) {
  if (!surface || !surface.inbound) {
    return {
      type: "feed",
      title: document.title,
      byline: "",
      siteName: location.hostname,
      items: [],
    };
  }

  const selector = surface.inbound.content;
  const skip = surface.inbound.skip;
  const elements = document.querySelectorAll(selector);
  const items = [];

  for (const el of elements) {
    let text;
    if (skip) {
      const clone = el.cloneNode(true);
      for (const s of clone.querySelectorAll(skip)) s.remove();
      text = (clone.innerText || clone.textContent || "").trim();
    } else {
      text = (el.innerText || el.textContent || "").trim();
    }
    if (text.length > 10) {
      items.push({ text });
    }
  }

  return {
    type: "feed",
    title: document.title,
    byline: "",
    siteName: surface.name || location.hostname,
    items,
  };
}
