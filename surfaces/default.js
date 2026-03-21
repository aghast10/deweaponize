// Fallback surface for unknown sites — targets common semantic content elements.
// Loaded last so named surfaces take priority.

window.__pharmakonSurfaces = window.__pharmakonSurfaces || [];
window.__pharmakonSurfaces.push({
  name: "default",
  hostnames: null, // matches everything — used as fallback

  container: null,

  inbound: {
    content: [
      // Headlines / titulares — h2/h3 inside article cards and common title classes
      "article h1", "article h2", "article h3",
      "main h1", "main h2", "main h3",
      "[role='main'] h2", "[role='main'] h3",
      ".entry-title", ".post-title", ".article-title",
      ".card-title", ".tease-title", ".entry-header h2",

      // Article / page body — paragraphs inside common content containers
      "article p",
      "main p",
      "[role='main'] p",
      ".post-content p",
      ".entry-content p",
      ".article-body p",
      ".post-body p",
      ".story-body p",

      // Comment text — often a div, not a p (lesson from Infovat FC)
      ".comment-body p",    // WordPress native (body includes meta, target p inside)
      ".comment-content",   // generic
      ".comment-text",      // generic
      ".comment-message",   // some platforms
    ].join(", "),

    skip: [
      // Chrome / layout
      "nav", "header", "footer", "aside", "button",
      "[role='navigation']", "[role='banner']",
      "script", "style", "noscript",
      ".nav", ".menu", ".sidebar",
      ".ad", ".advertisement",

      // Comment metadata — skip author, date, actions so only the body text is processed
      ".comment-author", ".comment-meta", ".comment-date",
      ".comment-time", ".comment-reply", ".comment-actions",
      ".comment-edit-link",
    ].join(", "),
  },

  outbound: null,
});
