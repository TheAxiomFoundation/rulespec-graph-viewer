import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The viewer talks to the Axiom API only through a same-origin proxy so the
// API key stays server-side and there is no CORS dependency. In dev, Vite's
// proxy plays the role the Vercel function plays in production: it forwards
// /api/axiom/* to the Axiom API and injects the key from AXIOM_API_KEY.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const upstream = env.AXIOM_API_BASE ?? "https://axiom-api-eta.vercel.app/v1";
  const apiKey = env.AXIOM_API_KEY ?? "";
  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api/axiom": {
          target: upstream,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/axiom/, ""),
          headers: apiKey ? { "x-api-key": apiKey } : undefined,
        },
      },
    },
  };
});
