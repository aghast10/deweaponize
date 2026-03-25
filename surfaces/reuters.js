window.__pharmakonSurfaces = window.__pharmakonSurfaces || [];
window.__pharmakonSurfaces.push({
  name: "reuters",
  hostnames: ["reuters.com", "www.reuters.com"],

  container: "main",

  inbound: {
    content: [
      '[data-testid="TitleHeading"]',
      '[data-testid="Heading"]',
      '[class*="story-card-module"] > p',
      '[data-testid="paragraph"]',
      '[data-testid="Body"] p',
      'article p',
    ].join(", "),

    skip: [
      "nav", "header", "footer", "aside", "button",
      "[role='navigation']", "[role='banner']",
      "script", "style", "noscript",
      "time", ".timestamp",
    ].join(", "),
  },

  outbound: null,
});
