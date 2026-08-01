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

## Relationship to axiom.org

[axiom.org](https://github.com/TheAxiomFoundation/axiom.org) carries a scoped
copy of this viewer under `src/components/axiom/graph-viewer/` (its
`graph-styles.css` header records the copy). There is no automated sync in
either direction, and the copies have already diverged
(`InteractiveRuleGraph.tsx` differs between the repos; the site copy adds
site-only modules like `viewer-app.tsx` and `inspector-mini-graph.tsx`, and
drops this repo's `App.tsx`/`main.tsx` shell).

A fix to shared behavior — `api.ts`, `citations.ts`, `formula.ts`,
`types.ts`, `graph-styles.css`, `InteractiveRuleGraph.tsx` — lands in
**both** repos, as two PRs, or it quietly holds in only one. Tracking:
[#17](https://github.com/TheAxiomFoundation/rulespec-graph-viewer/issues/17).
