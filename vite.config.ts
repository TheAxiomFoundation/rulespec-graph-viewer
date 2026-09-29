import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { proxyAllowlist } from "./dev/proxy-guard";

// The viewer talks to the Axiom API only through a same-origin proxy so the
// API key stays server-side and there is no CORS dependency. In dev, Vite's
// proxy plays the role the Vercel function plays in production: it forwards
// the viewer's reads under /graph-viewer/api/axiom/ to the Axiom API and
// injects the key from AXIOM_API_KEY. dev/proxy-guard.ts applies the same
// allowlist as the function before anything reaches the proxy.
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
