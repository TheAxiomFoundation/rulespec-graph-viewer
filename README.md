# RuleSpec Graph Viewer

Standalone React tool for exploring Axiom RuleSpec computation graphs.

This repo was extracted from `dashboard-builder` so the rule-graph experience
can evolve independently from the dashboard-building workflow.

## What It Does

- Loads a RuleSpec program graph from the compute API.
- Computes selected outputs in explain mode.
- Renders the selected outputs as an interactive DAG with pan, zoom, minimap,
  expand/collapse controls, and optional live values.
- Starts with Colorado SNAP FY 2026, but the repo/path fields can point at any
  program exposed by the compute service.

## Development

```bash
pnpm install
pnpm dev
```

By default the app uses:

```text
https://policyengine--dashboard-builder-compute.modal.run
```

Override at build/dev time with:

```bash
VITE_COMPUTE_URL=http://127.0.0.1:8787 pnpm dev
```
