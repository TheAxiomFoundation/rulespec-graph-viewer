import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../api/axiom.js";
import { upstreamFor } from "../api/_upstream.js";
import { fakeResponse } from "./fake-response.js";

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

  it("drops any query string sent to the package routes", () => {
    expect(upstreamFor("GET", "/runtime/packages?admin=1")).toEqual({ ok: true, path: "/runtime/packages" });
    expect(upstreamFor("GET", "/runtime/packages/us-co/co-snap/graph?x=1&y=../admin")).toEqual({
      ok: true,
      path: "/runtime/packages/us-co/co-snap/graph",
    });
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
    // mulberry32: 32-bit integer arithmetic throughout, so the sequence does
    // not collapse into a short cycle the way a float LCG does.
    let state = 20260929;
    const random = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
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
    const word = (alphabet: string, min: number, max: number) => {
      const length = min + Math.floor(random() * (max - min + 1));
      let out = "";
      for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(random() * alphabet.length)];
      return out;
    };
    // Fresh valid-looking values half the time, hostile ones otherwise.
    const coordinate = () =>
      random() < 0.5
        ? word("abcdefghijklmnopqrstuvwxyz0123456789", 1, 1) + word("abcdefghijklmnopqrstuvwxyz0123456789-_", 0, 24)
        : pick(coordinates);
    const focus = () =>
      random() < 0.5
        ? `${word("abcdefghijklmnopqrstuvwxyz", 2, 2)}:${pick(["statutes", "regulations"])}/${word("0123456789", 1, 3)}/${word("0123456789abc", 1, 4)}${random() < 0.3 ? `%23${word("abcdefghijklmnopqrstuvwxyz_", 1, 12)}` : ""}`
        : pick(focuses);
    const shapes = [
      () => "/runtime/packages",
      () => `/runtime/packages/${coordinate()}/${coordinate()}/graph`,
      () => `/graph/compose?focus=${focus()}`,
    ];
    const allowed = [
      /^\/runtime\/packages$/,
      /^\/runtime\/packages\/[a-z0-9][a-z0-9_-]{0,63}\/[a-z0-9][a-z0-9_-]{0,63}\/graph$/,
      /^\/graph\/compose\?focus=[A-Za-z0-9%_.!~*'()-]+$/,
    ];
    let accepted = 0;
    const distinct = new Set<string>();
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
      distinct.add(`${method} ${suffix}`);
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
    // The property is only as good as the distinct cases it accepts.
    expect(accepted).toBeGreaterThan(5_000);
    expect(distinct.size).toBeGreaterThan(1_000);
  });
});

// The tables below pin each check in upstreamFor: loosening any one of them
// (a regex anchor, a character class, a length cap, a segment comparison, the
// focus rules) turns at least one row red. Every row runs through both the
// allowlist and the deployed handler; a refused row must never reach fetch.

const PRODUCTION_BASE = "https://axiom-api-eta.vercel.app/v1";
const PREFIXES = ["/api/axiom", "/graph-viewer/api/axiom"] as const;

/** Refused by the allowlist, and answered by the handler without a fetch. */
async function expectRefused(suffix: string, method = "GET") {
  const label = `${method} ${JSON.stringify(suffix)}`;
  expect(upstreamFor(method, suffix), label).toMatchObject({
    ok: false,
    status: method === "GET" || method === "HEAD" ? 404 : 405,
  });
  vi.stubEnv("AXIOM_API_KEY", "server-secret");
  const upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
  for (const prefix of PREFIXES) {
    const res = fakeResponse();
    await handler({ method, url: `${prefix}${suffix}`, headers: {} }, res);
    expect(res.statusCode, `${label} via ${prefix}`).toBe(method === "GET" || method === "HEAD" ? 404 : 405);
    expect(res.headers["cache-control"], label).toBe("no-store");
  }
  expect(upstream, label).not.toHaveBeenCalled();
}

/** Forwarded as exactly `path`, by the allowlist and by the handler. */
async function expectForwarded(suffix: string, path: string, method = "GET") {
  const label = `${method} ${JSON.stringify(suffix)}`;
  expect(upstreamFor(method, suffix), label).toEqual({ ok: true, path });
  vi.stubEnv("AXIOM_API_KEY", "server-secret");
  const upstream = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", upstream);
  for (const prefix of PREFIXES) {
    upstream.mockClear();
    await handler({ method, url: `${prefix}${suffix}`, headers: {} }, fakeResponse());
    expect(upstream, `${label} via ${prefix}`).toHaveBeenCalledOnce();
    expect(upstream.mock.calls[0]![0], `${label} via ${prefix}`).toBe(`${PRODUCTION_BASE}${path}`);
  }
}

const GRAPH = (jurisdiction: string, program: string) => `/runtime/packages/${jurisdiction}/${program}/graph`;

describe("allowlist tables", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("accepts package coordinates at the edges of the allowed alphabet and length", async () => {
    for (const coordinate of ["a", "0", "us_ny", "a-", "a_", "canada-workers-benefit", "a".repeat(64)]) {
      await expectForwarded(GRAPH(coordinate, "co-snap"), GRAPH(coordinate, "co-snap"));
      await expectForwarded(GRAPH("us-co", coordinate), GRAPH("us-co", coordinate));
    }
  });

  it("refuses hostile package coordinates in either position", async () => {
    const hostile = [
      // Empty, or too long by one.
      "",
      "a".repeat(65),
      "a".repeat(200),
      // Must start with a lowercase letter or digit.
      "-rf",
      "_x",
      // Uppercase anywhere.
      "US-CO",
      "us-CO",
      "Us",
      // Percent-encoding of any kind.
      "%41",
      "us-co%41",
      "us%2dco",
      "us-co%00",
      "us-co%0a",
      // Dots inside a segment.
      "us.co",
      "co-snap.json",
      "a..b",
      ".hidden",
      // Junk after a valid prefix: the URL parser leaves these characters
      // alone, so only the pattern's end anchor refuses them.
      "us-co~",
      "us-co!",
      "us-co:1",
      "us-co@x",
      "us-co+x",
      "us-co;x",
      "us-co,x",
      "us-co=x",
      "us-co$",
      "us-co'",
      "us-co*",
      "us-co(x)",
      "us-co|x",
      // Whitespace and controls: the URL parser strips or encodes these, so
      // the raw-path check refuses them before the pattern sees them.
      "us-co\n",
      "us-co\r\n",
      "us-co\t",
      "us-co ",
      "us-co^",
      "ｕｓ",
    ];
    for (const coordinate of hostile) {
      await expectRefused(GRAPH(coordinate, "co-snap"));
      await expectRefused(GRAPH("us-co", coordinate));
    }
  });

  it("refuses every route that differs from an allowed shape by one segment", async () => {
    const literals = ["runtime", "packages", "graph", "compose"];
    const shapes: { segments: string[]; query: string; literal: boolean[] }[] = [
      { segments: ["runtime", "packages"], query: "", literal: [true, true] },
      {
        segments: ["runtime", "packages", "us-co", "co-snap", "graph"],
        query: "",
        literal: [true, true, false, false, true],
      },
      { segments: ["graph", "compose"], query: "?focus=us:statutes/26/24", literal: [true, true] },
    ];
    const variants = new Set<string>();
    for (const { segments, query, literal } of shapes) {
      const build = (parts: string[]) => `/${parts.join("/")}${query}`;
      segments.forEach((segment, i) => {
        // Drop the segment.
        variants.add(build(segments.filter((_, j) => j !== i)));
        // Replace a fixed segment with a near miss or another route's word.
        if (literal[i]) {
          for (const other of ["x", segment.toUpperCase(), `${segment}s`, `${segment}x`, ...literals]) {
            if (other !== segment) variants.add(build(segments.map((s, j) => (j === i ? other : s))));
          }
        }
      });
      // Insert an extra segment anywhere, and add a trailing slash.
      for (let i = 0; i <= segments.length; i += 1) {
        for (const extra of ["x", "graph", "v1", "admin"]) {
          variants.add(build([...segments.slice(0, i), extra, ...segments.slice(i)]));
        }
      }
      variants.add(`/${segments.join("/")}/${query}`);
    }
    // Cross-shape splices.
    for (const suffix of [
      "/runtime/compose?focus=x",
      "/graph/packages",
      "/packages/runtime",
      "/compose/graph?focus=x",
      "/runtime/packages/us-co/co-snap/compose?focus=x",
      "/graph/compose/us-co/co-snap/graph?focus=x",
      "/runtime/packages/us-co/graph",
      "/runtime/packages/graph",
    ]) {
      variants.add(suffix);
    }
    expect(variants.size).toBeGreaterThan(80);
    for (const suffix of variants) await expectRefused(suffix);
  });

  it("matches the whole path, not a tail after junk", async () => {
    // Via the handler, "x/runtime/packages" is /api/axiomx/runtime/packages.
    // The URL parser drops or rewrites what comes before the first slash, so
    // only the raw-path comparison refuses these.
    for (const suffix of [
      "x/runtime/packages",
      "s/runtime/packages/us-co/co-snap/graph",
      "x/graph/compose?focus=us:statutes/26/24",
      " /runtime/packages",
      "\t/runtime/packages",
      "\\x/runtime/packages",
      "runtime/packages",
    ]) {
      await expectRefused(suffix);
    }
  });

  it("drops every query parameter the route does not take", async () => {
    await expectForwarded("/runtime/packages?admin=1&x-api-key=caller", "/runtime/packages");
    await expectForwarded("/runtime/packages?focus=us:statutes/26/24", "/runtime/packages");
    await expectForwarded("/runtime/packages#admin", "/runtime/packages");
    await expectForwarded(`${GRAPH("us-co", "co-snap")}?path=/admin/keys&y=..%2Fadmin`, GRAPH("us-co", "co-snap"));
    await expectForwarded(
      "/graph/compose?admin=1&focus=us:statutes/26/24&path=/admin/keys&v=2",
      "/graph/compose?focus=us%3Astatutes%2F26%2F24",
    );
    // An encoded & inside the focus stays inside the one parameter.
    await expectForwarded("/graph/compose?focus=a%26focus%3Db", "/graph/compose?focus=a%26focus%3Db");
  });

  it("uses only the first focus, and never goes looking for a better one", async () => {
    await expectForwarded(
      "/graph/compose?focus=us:statutes/26/24&focus=../../admin/keys",
      "/graph/compose?focus=us%3Astatutes%2F26%2F24",
    );
    await expectForwarded("/graph/compose?focus=a&focus=b", "/graph/compose?focus=a");
    await expectRefused("/graph/compose?focus=../../admin/keys&focus=us:statutes/26/24");
    await expectRefused("/graph/compose?focus=&focus=us:statutes/26/24");
    await expectRefused("/graph/compose?focuses=us:statutes/26/24");
    await expectRefused("/graph/compose?Focus=us:statutes/26/24");
  });

  it("refuses dot segments in the focus, however they are separated or encoded", async () => {
    // Decoded focus values. Each is sent fully percent-encoded, and as typed
    // with only "#" escaped (a bare "#" would end the query string).
    const hostile = [
      ".",
      "..",
      "./x",
      "../x",
      "x/.",
      "x/..",
      "x/./y",
      "x/../y",
      "x#.",
      "x#..",
      "#..",
      "#.",
      "x/y#../z",
      "us:statutes/26/24#..",
      "us:statutes/26/24#./x",
    ];
    for (const focus of hostile) {
      await expectRefused(`/graph/compose?focus=${encodeURIComponent(focus)}`);
      await expectRefused(`/graph/compose?focus=${focus.replace(/#/g, "%23")}`);
    }
    for (const encoded of ["x%2F..%2Fy", "%2E%2E", "%2e", "x/%2e%2e/y", "x%2F.", "x%23%2E%2E"]) {
      await expectRefused(`/graph/compose?focus=${encoded}`);
    }
    // Dots inside a segment are ordinary legal-id text.
    await expectForwarded("/graph/compose?focus=us:statutes/26/24.1", "/graph/compose?focus=us%3Astatutes%2F26%2F24.1");
    await expectForwarded("/graph/compose?focus=a..b/c", "/graph/compose?focus=a..b%2Fc");
  });

  it("refuses an empty, over-long or whitespace focus", async () => {
    const hostile = ["", "a%20b", "a+b", "a%09b", "a%0Ab", "a%0Db", "a%0Cb", "a%C2%A0b", "a%E2%80%A8b", "x".repeat(513)];
    for (const focus of hostile) await expectRefused(`/graph/compose?focus=${focus}`);
    await expectForwarded(`/graph/compose?focus=${"x".repeat(512)}`, `/graph/compose?focus=${"x".repeat(512)}`);
  });

  it("refuses writes on every allowed route", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "CONNECT"]) {
      for (const suffix of ["/runtime/packages", GRAPH("us-co", "co-snap"), "/graph/compose?focus=us:statutes/26/24"]) {
        await expectRefused(suffix, method);
      }
    }
  });
});

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
