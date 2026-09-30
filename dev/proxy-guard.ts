// The allowlist the production proxy function applies (api/_upstream.ts),
// run ahead of Vite's own proxy in `vite` and `vite preview`, so a dev
// server started with --host does not lend AXIOM_API_KEY to the network.
import type { Connect, Plugin } from "vite";
import { upstreamFor } from "../api/_upstream";

export const PROXY_PREFIX = "/graph-viewer/api/axiom";

export const proxyGuard: Connect.NextHandleFunction = (req, res, next) => {
  if (!req.url?.startsWith(PROXY_PREFIX)) return next();
  const decision = upstreamFor(
    (req.method ?? "GET").toUpperCase(),
    req.url.slice(PROXY_PREFIX.length),
  );
  if (!decision.ok) {
    if (decision.status === 405) res.setHeader("allow", "GET, HEAD");
    res.statusCode = decision.status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: decision.error }));
    return;
  }
  req.url = `${PROXY_PREFIX}${decision.path}`;
  next();
};

/** Registers the guard as a pre-middleware: returning nothing from the
 *  configure hooks installs it before Vite's internal middlewares, the
 *  proxy included. (Returning a function would run it after them.) */
export function proxyAllowlist(): Plugin {
  return {
    name: "viewer-proxy-allowlist",
    configureServer: (server) => void server.middlewares.use(proxyGuard),
    configurePreviewServer: (server) => void server.middlewares.use(proxyGuard),
  };
}
