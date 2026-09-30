import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import viteConfig from "../vite.config";
import { PROXY_PREFIX, proxyAllowlist, proxyGuard } from "../dev/proxy-guard";

function response() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: "",
    headers,
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    },
    end: (body?: string) => {
      res.body = body ?? "";
    },
  };
  return res;
}

function run(method: string, url: string) {
  const req = { method, url } as IncomingMessage;
  const res = response();
  const next = vi.fn();
  proxyGuard(req, res as unknown as ServerResponse, next);
  return { req, res, next };
}

describe("dev proxy guard", () => {
  it("passes an allowed read on, rewritten to its validated path", () => {
    const { req, next } = run("GET", "/graph-viewer/api/axiom/graph/compose?focus=us:statutes/26/24&admin=1");
    expect(next).toHaveBeenCalledOnce();
    expect(req.url).toBe("/graph-viewer/api/axiom/graph/compose?focus=us%3Astatutes%2F26%2F24");
  });

  it("answers anything else itself, so it never reaches Vite's proxy", () => {
    const write = run("POST", "/graph-viewer/api/axiom/runtime/packages");
    expect(write.next).not.toHaveBeenCalled();
    expect(write.res.statusCode).toBe(405);
    expect(write.res.headers.allow).toBe("GET, HEAD");

    const admin = run("GET", "/graph-viewer/api/axiom/admin/keys");
    expect(admin.next).not.toHaveBeenCalled();
    expect(admin.res.statusCode).toBe(404);
  });

  it("leaves other requests alone", () => {
    const { next, req } = run("GET", "/graph-viewer/assets/app.js");
    expect(next).toHaveBeenCalledOnce();
    expect(req.url).toBe("/graph-viewer/assets/app.js");
  });

  it("registers ahead of Vite's middlewares in dev and preview", () => {
    // A configure hook that returns nothing installs its middleware before
    // Vite's internal ones (the proxy included); returning a function would
    // install it after them.
    const plugin = proxyAllowlist();
    for (const hook of [plugin.configureServer, plugin.configurePreviewServer]) {
      const use = vi.fn();
      const returned = (hook as (server: unknown) => unknown)({ middlewares: { use } });
      expect(returned).toBeUndefined();
      expect(use).toHaveBeenCalledWith(proxyGuard);
    }
  });

  it("is part of the Vite config, and guards every path the proxy covers", () => {
    const config = (viteConfig as (env: { mode: string; command: "serve" }) => {
      plugins: unknown[];
      server: { proxy: Record<string, unknown> };
    })({ mode: "test", command: "serve" });
    const names = config.plugins.flat(Infinity).map((plugin) => (plugin as { name?: string } | null)?.name);
    expect(names).toContain("viewer-proxy-allowlist");
    // Every proxied prefix must fall under the guard's prefix.
    for (const key of Object.keys(config.server.proxy)) {
      expect(key.startsWith(PROXY_PREFIX), key).toBe(true);
    }
  });
});
