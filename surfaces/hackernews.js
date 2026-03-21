window.__pharmakonSurfaces = window.__pharmakonSurfaces || [];
window.__pharmakonSurfaces.push({
  name: "hackernews",
  hostnames: ["news.ycombinator.com"],
  container: "#hnmain",

  inbound: {
    content: ".commtext",
    skip: "a.hn-nav",
  },

  outbound: null,
});
