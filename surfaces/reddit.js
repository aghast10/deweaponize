window.__dwzSurfaces = window.__dwzSurfaces || [];
window.__dwzSurfaces.push({
  name: "reddit",
  hostnames: ["reddit.com"],
  container: "main, .main-content, #main-content",

  inbound: {
    content:
      '[slot="text-body"], .md, [data-click-id="text"], .RichTextJSON-root, shreddit-comment [slot="comment"]',
    skip: "button, nav, aside, .sidebar",
  },

  outbound: null,
});
