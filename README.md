# RuleSpec Graph Viewer

Standalone React tool for exploring Axiom RuleSpec computation graphs.

## What It Does

- Lists every executable program the Axiom API exposes, grouped by country.
- Loads a program's rule graph and renders it as an interactive DAG with pan,
  zoom, minimap, expand/collapse controls, and per-output selection.
- The program list is **registry-driven**: it comes from the Axiom API's
  runtime-package registry, so a newly compiled program appears in the dropdown
  with no change to this app. There is no per-program allowlist and no bundled
  graph artifact.

## Architecture

```
browser ──/api/axiom/*──▶ same-origin proxy ──x-api-key──▶ Axiom API (/v1)
```

- The browser only ever makes **same-origin** requests to `/api/axiom/*`. A
  proxy forwards them to the Axiom API and injects the API key server-side, so
  the key never reaches the browser bundle and there is no CORS dependency.
  - Local dev: the Vite dev-server proxy (`vite.config.ts`).
  - Production: a Vercel function (`api/axiom/[...path].ts`).
- Program graphs come from `GET /v1/runtime/packages/{jurisdiction}/{program_id}/graph`.
  The viewer no longer builds graphs client-side.

## Development

```bash
pnpm install
cp .env.example .env.local   # then set AXIOM_API_KEY
pnpm dev
```

Environment variables (see `.env.example`):

- `AXIOM_API_KEY` (required) — used by the proxy to authenticate to the Axiom
  API. Never exposed to the browser.
- `AXIOM_API_BASE` (optional) — override the upstream Axiom API base. Defaults
  to `https://axiom-api-eta.vercel.app/v1`. Point it at a local API instance
  (e.g. `http://localhost:8799/v1`) when testing unreleased endpoints.

## Deployment (Vercel)

Set `AXIOM_API_KEY` (and optionally `AXIOM_API_BASE`) as a project environment
variable. The `api/axiom/[...path].ts` function reads it at request time. The
graph endpoint must be available on the deployed Axiom API.
