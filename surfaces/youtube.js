window.__pharmakonSurfaces = window.__pharmakonSurfaces || [];
window.__pharmakonSurfaces.push({
  name: "youtube",
  hostnames: ["youtube.com"],
  container: "#content",

  inbound: {
    content: "#content-text, #comment-content, ytd-text-inline-expander",
    skip: "button, nav, #menu",
  },

  outbound: null,
});
