window.__pharmakonSurfaces = window.__pharmakonSurfaces || [];
window.__pharmakonSurfaces.push({
  name: "twitter",
  hostnames: ["twitter.com", "x.com"],
  container: "main",

  inbound: {
    content: '[data-testid="tweetText"]',
    skip: '[role="button"], button, a[href^="/hashtag"], nav',
  },

  outbound: null,
});
