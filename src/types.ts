export type LegalId = string;
// A country groups one or more jurisdictions (e.g. "us" covers "us-co",
// "us-az"). Kept as an open string so new countries appear from the registry
// with no code change.
export type Country = string;

export interface ProgramRef {
  jurisdiction: string;
  programId: string;
  displayName?: string;
}

export interface ProgramSummary {
  jurisdiction: string;
  programId: string;
  runtimeId: string;
  mode: string;
  status: string;
  defaultOutputs: LegalId[];
  outputCount?: number;
  entityCount?: number;
  inputCount?: number;
}

export interface PeriodRef {
  kind: "month";
  start: string;
}

export interface OutputBinding {
  id: string;
  legalId: LegalId;
  label: string;
}

export interface DashboardSpec {
  specVersion: "0.1";
  meta: {
    title: string;
    description?: string;
  };
  program: ProgramRef;
  period: PeriodRef;
  inputs: [];
  outputs: OutputBinding[];
}

export interface TraceNode {
  legalId: LegalId;
  label?: string;
  ruleKind?: string | null;
  value: number | string | boolean | null;
  dtype: "money" | "decimal" | "integer" | "boolean" | "date" | "judgment" | "string" | "input";
  source?: string;
  sourceUrl?: string | null;
  formula?: string | null;
  inputSource?: "user" | "default";
  homeFile?: string;
  children?: TraceNode[];
}

export interface OutputValue {
  legalId: LegalId;
  value: number | string | boolean | null;
  dtype: TraceNode["dtype"];
}

export interface ComputeResponse {
  outputs: OutputValue[];
  traces: Record<string, TraceNode>;
  warnings?: string[];
  mode: string;
}

export interface RuleNode {
  legalId: LegalId;
  name: string;
  fileLegalId: string;
  kind: string | null;
  entity: string | null;
  dtype: string | null;
  period: string | null;
  unit: string | null;
  source: string | null;
  sourceUrl?: string | null;
  ruleDeps: string[];
  inputDeps: string[];
  relationDeps: string[];
  formula?: string | null;
}

export interface InputNode {
  legalId: LegalId;
  name: string;
  fileLegalId: string;
  sample?: unknown;
  entity?: string | null;
  relationLegalId?: LegalId | null;
}

export interface RelationNode {
  legalId: LegalId;
  name: string;
  fileLegalId: string;
  memberInputIds?: LegalId[];
}

export interface ProgramGraph {
  rules: RuleNode[];
  inputs: InputNode[];
  relations: RelationNode[];
  ownOutputs: LegalId[];
  terminalOutputs: LegalId[];
}

export interface ParameterRule {
  legalId: string;
  name: string;
  fileLegalId: string;
  source?: string | null;
  sourceUrl?: string | null;
  unit?: string | null;
  dtype?: string | null;
  formula?: string | null;
}
