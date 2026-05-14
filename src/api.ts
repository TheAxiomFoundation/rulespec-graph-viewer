import type { ComputeResponse, LegalId, ProgramGraph, ProgramRef } from "./types";

export const DEFAULT_COMPUTE_URL =
  import.meta.env.VITE_COMPUTE_URL ?? "https://policyengine--dashboard-builder-compute.modal.run";

export const DEFAULT_PROGRAM: ProgramRef = {
  repo: "rules-us-co",
  path: "policies/cdhs/snap/fy-2026-benefit-calculation.yaml",
  displayName: "Colorado SNAP FY 2026",
};

export const DEFAULT_OUTPUTS = [
  "us-co:policies/cdhs/snap/fy-2026-benefit-calculation#snap_eligible",
  "us-co:regulations/10-ccr-2506-1/4.207.2#snap_allotment",
];

export async function fetchProgramGraph(
  computeUrl: string,
  program: ProgramRef,
): Promise<ProgramGraph> {
  const url = `${trimSlash(computeUrl)}/repos/${encodeURIComponent(program.repo)}/programs/${program.path}/graph`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`graph request failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as ProgramGraph;
}

export async function computeTrace(
  computeUrl: string,
  program: ProgramRef,
  outputs: LegalId[],
): Promise<ComputeResponse> {
  const response = await fetch(`${trimSlash(computeUrl)}/compute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      program,
      period: { kind: "month", start: "2026-01-01" },
      inputs: {},
      relations: {},
      queried_outputs: outputs,
    }),
  });
  if (!response.ok) {
    throw new Error(`compute request failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as ComputeResponse;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
