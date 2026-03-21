// Infovaticana — uses the proprietary Infovat FC comment system
// hosted on comments.infovaticana.com, injected dynamically.

window.__pharmakonSurfaces = window.__pharmakonSurfaces || [];
window.__pharmakonSurfaces.push({
  name: "infovaticana",
  hostnames: ["infovaticana.com"],

  container: ".fc-comment-list",

  inbound: {
    content: ".entry-content p, .fc-content",
    skip: ".fc-meta, .fc-actions, .fc-vote-wrap, .itts-player",
  },

  outbound: null,
});
