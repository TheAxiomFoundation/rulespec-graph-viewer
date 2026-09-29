// Which Axiom API requests the viewer's proxy may make on a visitor's behalf.
//
// The proxy holds a server-side API key and is reachable by anyone at
// axiom.org/graph-viewer/api/axiom/*. Forwarding whatever path and method
// arrived would lend that key's full authority, admin endpoints included,
// to every visitor. So the proxy forwards only the reads the viewer makes,
// and it builds the upstream URL from the validated parts rather than from
// the raw request path, so encoded dot segments, extra slashes and stray
// query parameters cannot steer it elsewhere.

export type UpstreamDecision =
  | { ok: true; path: string }
  | { ok: false; status: 404 | 405; error: string };

// A package coordinate: jurisdiction (e.g. "us-co") or program id
// (e.g. "co-snap", "canada-workers-benefit").
const COORDINATE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

// Compose focus: a legal id such as "us:regulations/47-cfr/54/403" or
// "us:statutes/26/24#child_tax_credit". Bounded, no whitespace, no dot
// segments.
function validFocus(focus: string): boolean {
  if (focus.length === 0 || focus.length > 512 || /\s/.test(focus)) return false;
  return !focus.split(/[/#]/).some((segment) => segment === "." || segment === "..");
}

/**
 * Map a request to the proxy (`method`, and everything after `/api/axiom`
 * including the query string) to the upstream path it may fetch, relative to
 * the API's `/v1` base.
 */
export function upstreamFor(method: string, suffix: string): UpstreamDecision {
  if (method !== "GET" && method !== "HEAD") {
    return { ok: false, status: 405, error: "The viewer proxy only reads." };
  }
  let url: URL;
  try {
    url = new URL(suffix, "https://proxy.invalid");
  } catch {
    return { ok: false, status: 404, error: "Not a viewer route." };
  }
  // Match the path exactly as it arrived, before any normalization: a
  // request that needs dot segments or percent-encoded separators to reach
  // an allowed route is not a viewer request.
  const raw = suffix.split(/[?#]/, 1)[0] ?? "";
  if (raw !== url.pathname || /%2f|%5c|%2e/i.test(raw)) {
    return { ok: false, status: 404, error: "Not a viewer route." };
  }
  const segments = raw.split("/").slice(1);

  if (segments.length === 2 && segments[0] === "runtime" && segments[1] === "packages") {
    return { ok: true, path: "/runtime/packages" };
  }
  if (
    segments.length === 5 &&
    segments[0] === "runtime" &&
    segments[1] === "packages" &&
    segments[4] === "graph" &&
    COORDINATE.test(segments[2]!) &&
    COORDINATE.test(segments[3]!)
  ) {
    return { ok: true, path: `/runtime/packages/${segments[2]}/${segments[3]}/graph` };
  }
  if (segments.length === 2 && segments[0] === "graph" && segments[1] === "compose") {
    const focus = url.searchParams.get("focus");
    if (focus === null || !validFocus(focus)) {
      return { ok: false, status: 404, error: "Not a viewer route." };
    }
    return { ok: true, path: `/graph/compose?focus=${encodeURIComponent(focus)}` };
  }
  return { ok: false, status: 404, error: "Not a viewer route." };
}
