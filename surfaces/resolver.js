// Surface resolver — picks the right surface for the current hostname.
// Must be loaded AFTER all surface definitions.

window.__dwzResolveSurface = function (hostname) {
  const surfaces = window.__dwzSurfaces || [];
  let fallback = null;

  for (const surface of surfaces) {
    if (!surface.hostnames) {
      fallback = surface;
      continue;
    }
    for (const domain of surface.hostnames) {
      if (hostname === domain || hostname.endsWith("." + domain)) {
        return surface;
      }
    }
  }

  return fallback;
};
