// Same-origin proxy to the Axiom API. Runs as a Vercel function so the API key
// lives in server-side env (AXIOM_API_KEY) and never reaches the browser
// bundle, and so the viewer makes only same-origin requests (no CORS).
//
// GET /api/axiom/runtime/packages -> GET {AXIOM_API_BASE}/runtime/packages

const UPSTREAM_BASE = process.env.AXIOM_API_BASE ?? "https://axiom-api-eta.vercel.app/v1";

export default async function handler(req: any, res: any) {
  const apiKey = process.env.AXIOM_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "AXIOM_API_KEY is not configured on the server." });
    return;
  }

  // Everything after /api/axiom, preserving the query string.
  const suffix = req.url.replace(/^\/api\/axiom/, "");
  const upstreamUrl = `${UPSTREAM_BASE.replace(/\/+$/, "")}${suffix}`;

  const init: Record<string, unknown> = {
    method: req.method,
    headers: {
      "x-api-key": apiKey,
      accept: "application/json",
    },
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.headers = { ...(init.headers as object), "content-type": "application/json" };
    init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
  }

  try {
    const upstream = await fetch(upstreamUrl, init);
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json");
    // Graphs and package lists are static per deploy; let the CDN cache them.
    // Never cache errors — a cached 404 would outlive the upstream fix.
    res.setHeader(
      "cache-control",
      upstream.ok ? "public, max-age=300, s-maxage=3600" : "no-store",
    );
    res.send(body);
  } catch (error) {
    res.status(502).json({ error: `Upstream request failed: ${String(error)}` });
  }
}
