// Fallback surface for unknown sites — targets common semantic content elements.
// Loaded last so named surfaces take priority.

window.__dwzSurfaces = window.__dwzSurfaces || [];
window.__dwzSurfaces.push({
  name: "default",
  hostnames: null, // matches everything — used as fallback

  container: null,

  inbound: {
    content: [
      // Headlines — semantic containers
      "article h1", "article h2", "article h3",
      "main h1", "main h2", "main h3",
      "[role='main'] h2", "[role='main'] h3",
      ".entry-title", ".post-title", ".article-title",
      ".card-title", ".tease-title", ".entry-header h2",

      // Headlines — data-testid patterns (React/SPA sites)
      '[data-testid="TitleHeading"]',
      '[data-testid="Heading"]',
      '[data-testid="title"]',
      '[data-testid="headline"]',

      // Headlines — standalone headings inside list items (news feeds, card layouts)
      "li h2", "li h3", "li h4",

      // Paragraphs — semantic containers
      "article p",
      "main p",
      "[role='main'] p",
      ".post-content p",
      ".entry-content p",
      ".article-body p",
      ".post-body p",
      ".story-body p",

      // Paragraphs — data-testid patterns
      '[data-testid="paragraph"]',
      '[data-testid="Body"] p',

      // Paragraphs — inside list/card layouts (modern SPA news sites)
      // Target the <p> inside, not the container, to avoid swallowing child text
      '[class*="story-card"] > p',
      '[class*="card-module"] > p',
      '[class*="story-module"] > p',
      "li > p",

      // Paragraphs — section-based layouts (no article/main wrapper)
      "section p",
      "[role='region'] p",

      // Comment text
      ".comment-body p",
      ".comment-content",
      ".comment-text",
      ".comment-message",
    ].join(", "),

    skip: [
      // Chrome / layout
      "nav", "header", "footer", "aside", "button",
      "[role='navigation']", "[role='banner']",
      "script", "style", "noscript",
      ".nav", ".menu", ".sidebar",
      ".ad", ".advertisement",
      "time", ".timestamp", "[class*='timestamp']",

      // Comment metadata — skip author, date, actions so only the body text is processed
      ".comment-author", ".comment-meta", ".comment-date",
      ".comment-time", ".comment-reply", ".comment-actions",
      ".comment-edit-link",
    ].join(", "),
  },

  outbound: null,
});
