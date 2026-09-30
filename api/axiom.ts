// Same-origin proxy to the Axiom API. Runs as a Vercel function so the API key
// lives in server-side env (AXIOM_API_KEY) and never reaches the browser
// bundle, and so the viewer makes only same-origin requests (no CORS).
//
// GET /api/axiom/runtime/packages -> GET {AXIOM_API_BASE}/runtime/packages
//
// Only the reads the viewer makes are forwarded (see ./_upstream.ts); the key
// behind this proxy must never be lent to arbitrary paths or methods.

import { upstreamFor } from "./_upstream.js";

const UPSTREAM_BASE = process.env.AXIOM_API_BASE ?? "https://axiom-api-eta.vercel.app/v1";

export default async function handler(req: any, res: any) {
  const apiKey = process.env.AXIOM_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "AXIOM_API_KEY is not configured on the server." });
    return;
  }

  // Everything after /api/axiom, preserving the query string. Vercel hands the
  // function the original request URL, so tolerate the public /graph-viewer
  // prefix (the app is served under axiom.org/graph-viewer and calls
  // /graph-viewer/api/axiom/*, rewritten to this function by vercel.json).
  const suffix = String(req.url ?? "").replace(/^(?:\/graph-viewer)?\/api\/axiom/, "");
  const decision = upstreamFor(String(req.method ?? "GET").toUpperCase(), suffix);
  if (!decision.ok) {
    if (decision.status === 405) res.setHeader("allow", "GET, HEAD");
    res.setHeader("cache-control", "no-store");
    res.status(decision.status).json({ error: decision.error });
    return;
  }
  const upstreamUrl = `${UPSTREAM_BASE.replace(/\/+$/, "")}${decision.path}`;

  // Built from scratch: nothing from the caller (headers, body, query string)
  // rides along, only the validated path and our own two headers.
  const init: RequestInit = {
    method: req.method === "HEAD" ? "HEAD" : "GET",
    headers: {
      "x-api-key": apiKey,
      accept: "application/json",
    },
    // Never follow a redirect. fetch keeps custom headers such as x-api-key
    // when it follows one, even to another origin, so a 3xx from upstream
    // would carry the key to whatever URL it names, or spend it on a path the
    // allowlist never approved. A redirect fails the request instead.
    redirect: "error",
  };

  let upstream: Response;
  let body: string;
  try {
    upstream = await fetch(upstreamUrl, init);
    body = await upstream.text();
  } catch (error) {
    // A redirect, a network failure or a broken body. The error's cause can
    // name upstream addresses ("connect ECONNREFUSED 10.0.0.1:443"), so it
    // goes to the server log only; the caller gets a generic, uncached 502,
    // and nothing is retried elsewhere.
    console.error("Axiom API proxy: upstream request failed", error);
    res.setHeader("cache-control", "no-store");
    res.status(502).json({ error: "Upstream request failed." });
    return;
  }

  res.status(upstream.status);
  res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json");
  // Graphs and package lists are static per deploy; let the CDN cache them.
  // Never cache errors — a cached 404 would outlive the upstream fix.
  res.setHeader(
    "cache-control",
    upstream.ok ? "public, max-age=300, s-maxage=3600" : "no-store",
  );
  res.send(body);
}
