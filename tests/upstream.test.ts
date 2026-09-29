import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../api/axiom.js";
import { upstreamFor } from "../api/_upstream.js";

describe("upstreamFor", () => {
  it("forwards the three reads the viewer makes", () => {
    expect(upstreamFor("GET", "/runtime/packages")).toEqual({ ok: true, path: "/runtime/packages" });
    expect(upstreamFor("GET", "/runtime/packages/us-co/co-snap/graph")).toEqual({
      ok: true,
      path: "/runtime/packages/us-co/co-snap/graph",
    });
    expect(upstreamFor("GET", "/graph/compose?focus=us%3Aregulations%2F47-cfr%2F54%2F403")).toEqual({
      ok: true,
      path: "/graph/compose?focus=us%3Aregulations%2F47-cfr%2F54%2F403",
    });
    expect(upstreamFor("GET", "/graph/compose?focus=us:statutes/26/24%23child_tax_credit")).toEqual({
      ok: true,
      path: "/graph/compose?focus=us%3Astatutes%2F26%2F24%23child_tax_credit",
    });
    expect(upstreamFor("HEAD", "/runtime/packages")).toMatchObject({ ok: true });
  });

  it("refuses every method but reads", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(upstreamFor(method, "/runtime/packages")).toMatchObject({ ok: false, status: 405 });
    }
  });

  it("refuses paths the viewer does not read, however they are spelled", () => {
    const attempts = [
      "/admin/usage",
      "/admin/keys",
      "/v1/admin/keys",
      "",
      "/",
      "/runtime/packages/",
      "/runtime/packages/us-co/co-snap",
      "/runtime/packages/us-co/co-snap/graph/extra",
      "/runtime/packages/../admin/keys",
      "/runtime/packages/%2E%2E/%2E%2E/admin/keys",
      "/runtime/packages/%2e%2e/admin/keys/graph",
      "/runtime/packages/us-co%2F..%2Fadmin/co-snap/graph",
      "/runtime/packages/US-CO/co-snap/graph",
      "/runtime//packages",
      "/runtime/packages/./x/graph",
      "/graph/compose",
      "/graph/compose?focus=",
      "/graph/compose?focus=../../admin/keys",
      "/graph/compose?focus=us:statutes/../../admin",
      "/graph/compose?focus=a%20b",
      "/graph/compose/../../admin/usage?focus=x",
      "/runtime\\packages",
      "//evil.example/runtime/packages",
    ];
    for (const suffix of attempts) {
      expect(upstreamFor("GET", suffix), suffix).toMatchObject({ ok: false });
    }
  });

  it("forwards only the focus parameter to compose", () => {
    expect(upstreamFor("GET", "/graph/compose?focus=us:statutes/26/24&v=2&admin=1")).toEqual({
      ok: true,
      path: "/graph/compose?focus=us%3Astatutes%2F26%2F24",
    });
  });

  it("never forwards anything outside the allowed shapes, for generated inputs", () => {
    // Seeded generator: start from the viewer's real route shapes, fill them
    // with ordinary and hostile values, and sometimes splice an attack
    // fragment in anywhere. Every accepted request must still be one of the
    // three shapes, resolve upstream to exactly that path, and never reach
    // anything else.
    let state = 20260929;
    const random = () => {
      state = (state * 1_103_515_245 + 12_345) >>> 0;
      return state / 4_294_967_296;
    };
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
    const coordinates = [
      "us-co", "co-snap", "ca", "canada-workers-benefit", "be", "worker-pit", "us_ny",
      "..", ".", "%2e%2e", "%2E", "ADMIN", "a/b", "x%2fy", "", "admin", "keys?x=1", "a#b",
    ];
    const focuses = [
      "us:statutes/26/24", "us:regulations/47-cfr/54/403", "us:statutes/26/24#child_tax_credit",
      "de:statutes/bgb/126", "../admin/keys", "us:statutes/../../admin", "a b", "", "./x",
      "us%3Astatutes%2F26%2F24", "x&admin=1",
    ];
    const fragments = ["/..", "/.", "/%2e%2e", "%2f", "/admin", "//", "\\", "?", "#", "/../admin/keys", "%5c"];
    const shapes = [
      () => "/runtime/packages",
      () => `/runtime/packages/${pick(coordinates)}/${pick(coordinates)}/graph`,
      () => `/graph/compose?focus=${pick(focuses)}`,
    ];
    const allowed = [
      /^\/runtime\/packages$/,
      /^\/runtime\/packages\/[a-z0-9][a-z0-9_-]{0,63}\/[a-z0-9][a-z0-9_-]{0,63}\/graph$/,
      /^\/graph\/compose\?focus=[A-Za-z0-9%_.!~*'()-]+$/,
    ];
    let accepted = 0;
    for (let run = 0; run < 20_000; run += 1) {
      let suffix = pick(shapes)();
      if (random() < 0.35) {
        const at = Math.floor(random() * (suffix.length + 1));
        suffix = suffix.slice(0, at) + pick(fragments) + suffix.slice(at);
      }
      const method = random() < 0.9 ? "GET" : pick(["POST", "PUT", "DELETE"]);
      const decision = upstreamFor(method, suffix);
      if (!decision.ok) continue;
      accepted += 1;
      const context = `run=${run} method=${method} suffix=${JSON.stringify(suffix)} -> ${decision.path}`;
      expect(method, context).toBe("GET");
      expect(allowed.some((shape) => shape.test(decision.path)), context).toBe(true);
      // The upstream URL resolves to exactly the path chosen: nothing in it
      // normalizes away (no dot segments, no encoded separators), so it
      // lands in the package or compose routes and nowhere else.
      const target = new URL(`https://api.invalid/v1${decision.path}`);
      expect(target.pathname, context).toBe(`/v1${decision.path.split("?")[0]}`);
      expect(/^\/v1\/(runtime\/packages(\/[^/]+\/[^/]+\/graph)?|graph\/compose)$/.test(target.pathname), context).toBe(true);
    }
    // The property is only as good as the cases it accepts.
    expect(accepted).toBeGreaterThan(5_000);
  });
});

function fakeResponse() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
    },
    json(value: unknown) {
      res.body = value;
      return res;
    },
    send(value: unknown) {
      res.body = value;
      return res;
    },
  };
  return res;
}

describe("proxy handler", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("never sends the key upstream for a refused request", async () => {
    vi.stubEnv("AXIOM_API_KEY", "server-secret");
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);

    const post = fakeResponse();
    await handler({ method: "POST", url: "/graph-viewer/api/axiom/admin/keys", body: { id: "x" } }, post);
    expect(post.statusCode).toBe(405);
    expect(post.headers.allow).toBe("GET, HEAD");

    const admin = fakeResponse();
    await handler({ method: "GET", url: "/api/axiom/admin/usage" }, admin);
    expect(admin.statusCode).toBe(404);
    expect(admin.headers["cache-control"]).toBe("no-store");

    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards an allowed read with the key and caches success", async () => {
    vi.stubEnv("AXIOM_API_KEY", "server-secret");
    const upstream = vi.fn(async () => new Response('{"data":{"packages":[]}}', {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", upstream);

    const res = fakeResponse();
    await handler({ method: "GET", url: "/graph-viewer/api/axiom/runtime/packages" }, res);
    expect(res.statusCode).toBe(200);
    expect(upstream).toHaveBeenCalledWith(
      "https://axiom-api-eta.vercel.app/v1/runtime/packages",
      expect.objectContaining({ method: "GET", headers: expect.objectContaining({ "x-api-key": "server-secret" }) }),
    );
    expect(res.headers["cache-control"]).toBe("public, max-age=300, s-maxage=3600");
  });
});
