import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeResponse } from "./fake-response.js";

// The handler reads AXIOM_API_BASE once, at import, so each test loads a fresh
// copy after stubbing the env. Bases here are .invalid hosts (never resolve)
// or 127.0.0.1 servers this file starts; nothing leaves the machine.
async function loadHandler(base: string) {
  vi.stubEnv("AXIOM_API_KEY", "server-secret");
  vi.stubEnv("AXIOM_API_BASE", base);
  vi.resetModules();
  return (await import("../api/axiom.js")).default as (req: unknown, res: unknown) => Promise<void>;
}

const STUB_BASE = "https://api.test.invalid/v1";
const GENERIC_502 = { error: "Upstream request failed." };

// Everything a caller could try to smuggle through: credentials of its own,
// a key of its own, forwarding and content headers, and a body.
const HOSTILE_HEADERS = {
  authorization: "Bearer caller-token",
  cookie: "session=caller",
  "x-api-key": "caller-key",
  "X-API-Key": "caller-key-2",
  "x-forwarded-for": "203.0.113.9",
  "x-forwarded-host": "attacker.example",
  host: "attacker.example",
  "content-type": "application/json",
  "content-length": "17",
  origin: "https://attacker.example",
};
const HOSTILE_BODY = { admin: true, keys: ["x"] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the upstream call", () => {
  const routes = [
    {
      url: "/graph-viewer/api/axiom/runtime/packages?admin=1&x-api-key=caller",
      upstream: `${STUB_BASE}/runtime/packages`,
    },
    {
      url: "/api/axiom/runtime/packages",
      upstream: `${STUB_BASE}/runtime/packages`,
    },
    {
      url: "/graph-viewer/api/axiom/runtime/packages/us-co/co-snap/graph?path=/admin/keys",
      upstream: `${STUB_BASE}/runtime/packages/us-co/co-snap/graph`,
    },
    {
      url: "/api/axiom/runtime/packages/canada/canada-workers-benefit/graph",
      upstream: `${STUB_BASE}/runtime/packages/canada/canada-workers-benefit/graph`,
    },
    {
      url: "/graph-viewer/api/axiom/graph/compose?admin=1&focus=us:statutes/26/24%23child_tax_credit&focus=../../admin&v=2",
      upstream: `${STUB_BASE}/graph/compose?focus=us%3Astatutes%2F26%2F24%23child_tax_credit`,
    },
    {
      url: "/api/axiom/graph/compose?focus=us%3Aregulations%2F47-cfr%2F54%2F403",
      upstream: `${STUB_BASE}/graph/compose?focus=us%3Aregulations%2F47-cfr%2F54%2F403`,
    },
  ];

  for (const method of ["GET", "HEAD"] as const) {
    for (const route of routes) {
      it(`${method} ${route.url} is exactly one bare ${method} of ${route.upstream}`, async () => {
        const handler = await loadHandler(STUB_BASE);
        const upstream = vi.fn(
          async (_url: unknown, _init?: RequestInit) =>
            new Response(method === "HEAD" ? null : '{"data":{}}', {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        );
        vi.stubGlobal("fetch", upstream);

        const res = fakeResponse();
        await handler({ method, url: route.url, headers: { ...HOSTILE_HEADERS }, body: HOSTILE_BODY }, res);

        expect(res.statusCode).toBe(200);
        expect(upstream).toHaveBeenCalledOnce();
        const [url, init] = upstream.mock.calls[0]!;
        expect(url).toBe(route.upstream);
        // The whole init, not a subset: nothing else rides along.
        expect(Object.keys(init ?? {}).sort()).toEqual(["headers", "method", "redirect"]);
        expect(init!.method).toBe(method);
        expect(init!.redirect).toBe("error");
        expect(init!.body).toBeUndefined();
        expect([...new Headers(init!.headers).entries()]).toEqual([
          ["accept", "application/json"],
          ["x-api-key", "server-secret"],
        ]);
      });
    }
  }

  it("joins a base with a trailing slash the same way", async () => {
    const handler = await loadHandler(`${STUB_BASE}//`);
    const upstream = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", upstream);
    await handler({ method: "GET", url: "/api/axiom/runtime/packages" }, fakeResponse());
    expect(upstream.mock.calls[0]![0]).toBe(`${STUB_BASE}/runtime/packages`);
  });
});

describe("a failed upstream request", () => {
  beforeEach(() => {
    // The handler logs the failure for operators; keep test output quiet.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("answers a generic, uncached 502 and tries nothing else", async () => {
    const handler = await loadHandler(STUB_BASE);
    const failure = Object.assign(new TypeError("fetch failed"), {
      cause: new Error("redirect to https://attacker.example/steal from 10.1.2.3 refused"),
    });
    const upstream = vi.fn(async (_url: unknown, _init?: RequestInit): Promise<Response> => {
      throw failure;
    });
    vi.stubGlobal("fetch", upstream);

    const res = fakeResponse();
    await handler({ method: "GET", url: "/api/axiom/runtime/packages" }, res);
    expect(res.statusCode).toBe(502);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual(GENERIC_502);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("answers the same when the upstream body breaks mid-read", async () => {
    const handler = await loadHandler(STUB_BASE);
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new Error("socket hang up at 10.1.2.3"));
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(broken, { status: 200 })));

    const res = fakeResponse();
    await handler({ method: "GET", url: "/api/axiom/runtime/packages" }, res);
    expect(res.statusCode).toBe(502);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual(GENERIC_502);
  });
});

// Real sockets: the redirect behavior under test belongs to Node's fetch, so a
// stub cannot show it. Two servers on 127.0.0.1 stand in for the configured
// upstream (A) and the place a redirect points (B).
type Hit = { method: string; url: string; headers: IncomingHttpHeaders };

async function listen(respond: (hit: Hit, res: import("node:http").ServerResponse) => void) {
  const hits: Hit[] = [];
  const server = createServer((req, res) => {
    const hit = { method: req.method ?? "", url: req.url ?? "", headers: req.headers };
    hits.push(hit);
    respond(hit, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, hits, origin: `http://127.0.0.1:${port}` };
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/** Pass fetches to 127.0.0.1 through to the real fetch; refuse anything else. */
function localFetchOnly() {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (!url.startsWith("http://127.0.0.1:")) throw new Error(`test refused a non-local fetch: ${url}`);
    return realFetch(input, init);
  });
  return calls;
}

describe("an upstream redirect", () => {
  const servers: Server[] = [];
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
  });

  for (const status of [301, 302, 303, 307, 308]) {
    for (const method of ["GET", "HEAD"] as const) {
      it(`is never followed: ${status} on ${method} gives 502 and the key never reaches the target`, async () => {
        const b = await listen((_hit, res) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end('{"stolen":true}');
        });
        const a = await listen((_hit, res) => {
          res.writeHead(status, { location: `${b.origin}/v1/admin/keys` });
          res.end();
        });
        servers.push(a.server, b.server);
        const handler = await loadHandler(`${a.origin}/v1`);
        const calls = localFetchOnly();

        const res = fakeResponse();
        await handler({ method, url: "/graph-viewer/api/axiom/runtime/packages", headers: {} }, res);

        expect(res.statusCode).toBe(502);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.body).toEqual(GENERIC_502);
        // One request, to the configured upstream, which did get the key.
        expect(calls).toEqual([`${a.origin}/v1/runtime/packages`]);
        expect(a.hits).toHaveLength(1);
        expect(a.hits[0]!.headers["x-api-key"]).toBe("server-secret");
        expect(b.hits).toEqual([]);
      });
    }
  }

  it("is never followed within the upstream either", async () => {
    // A same-origin redirect would still spend the key on a path the
    // allowlist never approved.
    const a = await listen((hit, res) => {
      if (hit.url === "/v1/runtime/packages") {
        res.writeHead(302, { location: "/v1/admin/keys" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"keys":["admin"]}');
    });
    servers.push(a.server);
    const handler = await loadHandler(`${a.origin}/v1`);
    localFetchOnly();

    const res = fakeResponse();
    await handler({ method: "GET", url: "/api/axiom/runtime/packages" }, res);

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual(GENERIC_502);
    expect(a.hits.map((hit) => hit.url)).toEqual(["/v1/runtime/packages"]);
  });

  it("does not stop a direct answer from passing through", async () => {
    const a = await listen((_hit, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"data":{"packages":[]}}');
    });
    servers.push(a.server);
    const handler = await loadHandler(`${a.origin}/v1`);
    localFetchOnly();

    const res = fakeResponse();
    await handler({ method: "GET", url: "/api/axiom/runtime/packages" }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('{"data":{"packages":[]}}');
    expect(res.headers["cache-control"]).toBe("public, max-age=300, s-maxage=3600");
  });

  it("gives the same generic 502 when the upstream refuses the connection", async () => {
    const gone = await listen(() => {});
    await close(gone.server);
    const handler = await loadHandler(`${gone.origin}/v1`);
    const calls = localFetchOnly();

    const res = fakeResponse();
    await handler({ method: "GET", url: "/api/axiom/runtime/packages" }, res);

    expect(res.statusCode).toBe(502);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual(GENERIC_502);
    expect(calls).toHaveLength(1);
  });
});
