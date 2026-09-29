import { defineConfig, loadEnv, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { upstreamFor } from "./api/_upstream";

const PROXY_PREFIX = "/graph-viewer/api/axiom";

// The same allowlist the production function applies (api/_upstream.ts),
// run ahead of Vite's proxy in `dev` and `preview`: a server started with
// --host must not lend the key to anyone on the network either.
const guard: Connect.NextHandleFunction = (req, res, next) => {
  if (!req.url?.startsWith(PROXY_PREFIX)) return next();
  const decision = upstreamFor(
    (req.method ?? "GET").toUpperCase(),
    req.url.slice(PROXY_PREFIX.length),
  );
  if (!decision.ok) {
    res.statusCode = decision.status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: decision.error }));
    return;
  }
  req.url = `${PROXY_PREFIX}${decision.path}`;
  next();
};

function proxyAllowlist(): Plugin {
  return {
    name: "viewer-proxy-allowlist",
    configureServer: (server) => void server.middlewares.use(guard),
    configurePreviewServer: (server) => void server.middlewares.use(guard),
  };
}

// The viewer talks to the Axiom API only through a same-origin proxy so the
// API key stays server-side and there is no CORS dependency. In dev, Vite's
// proxy plays the role the Vercel function plays in production: it forwards
// /graph-viewer/api/axiom/* to the Axiom API and injects the key from
// AXIOM_API_KEY.
//
// The app is served under https://axiom.org/graph-viewer via reverse-proxy
// rewrites on the main site, so every asset and API URL carries the
// /graph-viewer/ base.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const upstream = env.AXIOM_API_BASE ?? "https://axiom-api-eta.vercel.app/v1";
  const apiKey = env.AXIOM_API_KEY ?? "";
  return {
    base: "/graph-viewer/",
    plugins: [react(), proxyAllowlist()],
    server: {
      proxy: {
        "/graph-viewer/api/axiom": {
          target: upstream,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/graph-viewer\/api\/axiom/, ""),
          headers: apiKey ? { "x-api-key": apiKey } : undefined,
        },
      },
    },
  };
});
