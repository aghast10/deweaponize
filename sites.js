// Site-specific selectors for known platforms.
// Each entry maps a hostname pattern to CSS selectors for content elements
// that should be intercepted and processed.
//
// "content"  — elements whose text gets sent to the LLM
// "skip"     — elements inside content that should NOT be processed (buttons, UI)
// "container"— scrollable container to observe for new content (default: document)

const SITE_PROFILES = {
  "twitter.com": {
    content: '[data-testid="tweetText"]',
    skip: '[role="button"], button, a[href^="/hashtag"], nav',
    container: "main",
  },
  "x.com": {
    content: '[data-testid="tweetText"]',
    skip: '[role="button"], button, a[href^="/hashtag"], nav',
    container: "main",
  },
  "reddit.com": {
    content:
      '[slot="text-body"], .md, [data-click-id="text"], .RichTextJSON-root, shreddit-comment [slot="comment"]',
    skip: "button, nav, aside, .sidebar",
    container: "main, .main-content, #main-content",
  },
  "facebook.com": {
    content: '[data-ad-preview="message"], [data-ad-comet-preview="message"], div[dir="auto"]',
    skip: 'nav, [role="banner"], [role="navigation"], button, a, span[dir="auto"] > span',
    container: '[role="main"]',
  },
  "youtube.com": {
    content: "#content-text, #comment-content, ytd-text-inline-expander",
    skip: "button, nav, #menu",
    container: "#content",
  },
  "news.ycombinator.com": {
    content: ".commtext",
    skip: "a.hn-nav",
    container: "#hnmain",
  },
};

// Default profile for unknown sites — targets common semantic content elements
const DEFAULT_PROFILE = {
  content: "article p, main p, [role='main'] p, .post-content p, .entry-content p, .article-body p",
  skip: "nav, header, footer, aside, button, [role='navigation'], [role='banner'], script, style, noscript, .nav, .menu, .sidebar, .ad, .advertisement",
  container: null,
};

/**
 * Get the profile for the current hostname.
 * Matches subdomains: "old.reddit.com" matches "reddit.com".
 */
function getProfile(hostname) {
  for (const [domain, profile] of Object.entries(SITE_PROFILES)) {
    if (hostname === domain || hostname.endsWith("." + domain)) {
      return profile;
    }
  }
  return DEFAULT_PROFILE;
}

// Make available to content.js (both run in the same content script scope)
window.__pharmakonGetProfile = getProfile;
