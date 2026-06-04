import type {
  ComputeResponse,
  Country,
  LegalId,
  ProgramGraph,
  ProgramRef,
  ProgramSummary,
  RuleNode,
} from "./types";
import ukUniversalCreditCompiled from "./compiled-graphs/uk-universal-credit-fy-2026-27.compiled.json";

export const DEFAULT_COMPUTE_URL =
  import.meta.env.VITE_COMPUTE_URL ?? "https://policyengine--dashboard-builder-compute.modal.run";

export const COUNTRY_OPTIONS: Array<{ id: Country; label: string; shortLabel: string }> = [
  { id: "us", label: "United States", shortLabel: "US" },
  { id: "uk", label: "United Kingdom", shortLabel: "UK" },
];

const US_PROGRAM_LABELS: Record<string, string> = {
  "rules-us-co/policies/cdhs/snap/fy-2026-benefit-calculation.yaml": "Colorado SNAP FY 2026",
  "rules-us-ca/programs/snap/fy-2026.yaml": "California SNAP FY 2026",
  "rules-us-ny/programs/snap/fy-2026.yaml": "New York SNAP FY 2026",
};

const UK_UNIVERSAL_CREDIT_PROGRAM: ProgramSummary = {
  repo: "axiom-programs",
  path: "uk/universal-credit/fy-2026-27.yaml",
  kind: "local-compiled",
  name: "universal_credit_fy_2026_27",
  summary:
    "End-to-end monthly Universal Credit award for FY 2026-27, composed from WRA 2012 s.8 and UC Regs 2013 regs 22, 24, 26, 27, 29, 34, and 36, including Schedule 4/5 housing-cost paths through reg 26. Uses a bundled compiled artifact because the deployed compute API does not currently expose UK repos.",
};

const UK_PROGRAM_LABELS: Record<string, string> = {
  [`${UK_UNIVERSAL_CREDIT_PROGRAM.repo}/${UK_UNIVERSAL_CREDIT_PROGRAM.path}`]:
    "UK Universal Credit FY 2026-27",
};

const PROGRAM_LABELS: Record<Country, Record<string, string>> = {
  us: US_PROGRAM_LABELS,
  uk: UK_PROGRAM_LABELS,
};

export const DEFAULT_PROGRAM_BY_COUNTRY: Record<Country, ProgramRef> = {
  us: {
  repo: "rules-us-co",
  path: "policies/cdhs/snap/fy-2026-benefit-calculation.yaml",
  displayName: "Colorado SNAP FY 2026",
  },
  uk: {
    repo: UK_UNIVERSAL_CREDIT_PROGRAM.repo,
    path: UK_UNIVERSAL_CREDIT_PROGRAM.path,
    displayName: UK_PROGRAM_LABELS[
      `${UK_UNIVERSAL_CREDIT_PROGRAM.repo}/${UK_UNIVERSAL_CREDIT_PROGRAM.path}`
    ],
  },
};

export const DEFAULT_PROGRAM = DEFAULT_PROGRAM_BY_COUNTRY.us;

export const DEFAULT_OUTPUTS_BY_COUNTRY: Record<Country, LegalId[]> = {
  us: [
    "us-co:policies/cdhs/snap/fy-2026-benefit-calculation#snap_eligible",
    "us-co:regulations/10-ccr-2506-1/4.207.2#snap_allotment",
  ],
  uk: [
    "uk:statutes/ukpga/2012/5/8#universal_credit_award_amount",
  ],
};

export const DEFAULT_OUTPUTS = DEFAULT_OUTPUTS_BY_COUNTRY.us;

export async function fetchProgramsForCountry(
  computeUrl: string,
  country: Country,
): Promise<ProgramSummary[]> {
  if (country === "uk") return [UK_UNIVERSAL_CREDIT_PROGRAM];

  const repos = await fetchRepos(computeUrl);
  const lists = await Promise.all(repos.map((repo) => fetchPrograms(computeUrl, repo)));
  return lists
    .flat()
    .filter((program) => isSupportedProgram(country, program))
    .sort((a, b) => displayNameForProgram(country, a).localeCompare(displayNameForProgram(country, b)));
}

export async function fetchRepos(computeUrl: string): Promise<string[]> {
  const response = await fetch(`${trimSlash(computeUrl)}/repos`);
  if (!response.ok) {
    throw new Error(`repos request failed (${response.status}): ${await response.text()}`);
  }
  const json = (await response.json()) as { repos?: string[] };
  return json.repos ?? [];
}

export async function fetchPrograms(
  computeUrl: string,
  repo: string,
): Promise<ProgramSummary[]> {
  const response = await fetch(`${trimSlash(computeUrl)}/repos/${encodeURIComponent(repo)}/programs`);
  if (!response.ok) {
    throw new Error(`programs request failed (${response.status}): ${await response.text()}`);
  }
  const json = (await response.json()) as { programs?: ProgramSummary[] };
  return json.programs ?? [];
}

export async function fetchProgramGraph(
  computeUrl: string,
  program: ProgramRef,
): Promise<ProgramGraph> {
  if (isLocalUniversalCreditProgram(program)) return buildUniversalCreditGraph();

  const url = `${trimSlash(computeUrl)}/repos/${encodeURIComponent(program.repo)}/programs/${program.path}/graph`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`graph request failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as ProgramGraph;
}

export function displayNameForProgram(country: Country, program: ProgramSummary | ProgramRef): string {
  const label = PROGRAM_LABELS[country][`${program.repo}/${program.path}`];
  if (label) return label;
  if ("displayName" in program && program.displayName) return program.displayName;
  const fallback = program.path.replace(/\.yaml$/, "").split("/").pop() ?? program.path;
  return humanize(("name" in program && program.name) || fallback);
}

export function isSupportedProgram(country: Country, program: ProgramSummary): boolean {
  return Boolean(PROGRAM_LABELS[country][`${program.repo}/${program.path}`]);
}

export function summaryForProgram(programs: ProgramSummary[], program: ProgramRef): string {
  const match = programs.find((item) => item.repo === program.repo && item.path === program.path);
  return match?.summary ?? program.path;
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

function isLocalUniversalCreditProgram(program: ProgramRef): boolean {
  return program.repo === UK_UNIVERSAL_CREDIT_PROGRAM.repo && program.path === UK_UNIVERSAL_CREDIT_PROGRAM.path;
}

type CompiledProgram = {
  program: {
    relations: Array<{ name: string; arity: number }>;
    parameters: Array<{
      id: string;
      name: string;
      unit?: string | null;
      versions?: Array<{ values?: Record<string, { kind: string; value: unknown }> }>;
    }>;
    derived: Array<{
      id?: string;
      name: string;
      entity?: string | null;
      dtype?: string | null;
      period?: string | null;
      unit?: string | null;
      source?: string | null;
      expr?: CompiledExpr;
    }>;
  };
};

type CompiledExpr =
  | { kind: "literal"; value: CompiledLiteral }
  | CompiledLiteral
  | { kind: "input"; name: string }
  | { kind: "derived"; name: string }
  | { kind: "parameter_lookup"; parameter: string; index?: CompiledExpr }
  | { kind: "add" | "and" | "or" | "max" | "min"; items: CompiledExpr[] }
  | { kind: "sub" | "mul"; left: CompiledExpr; right: CompiledExpr }
  | { kind: "not"; item: CompiledExpr }
  | { kind: "comparison"; op: string; left: CompiledExpr; right: CompiledExpr }
  | { kind: "if"; condition: CompiledExpr; then_expr: CompiledExpr; else_expr: CompiledExpr }
  | {
      kind: "sum_related";
      relation: string;
      value: CompiledExpr;
      where?: CompiledExpr | null;
    };

type CompiledLiteral =
  | { kind: "bool"; value: boolean }
  | { kind: "integer"; value: number }
  | { kind: "decimal"; value: string }
  | { kind: "string"; value: string };

function buildUniversalCreditGraph(): ProgramGraph {
  const compiled = ukUniversalCreditCompiled as CompiledProgram;
  const derivedIdByName = new Map(
    compiled.program.derived.map((rule) => [rule.name, compiledRuleId(rule)]),
  );
  const parametersByName = new Map(compiled.program.parameters.map((parameter) => [parameter.name, parameter]));
  const relationIdByName = new Map(
    compiled.program.relations.map((relation) => [
      relation.name,
      `${UK_UNIVERSAL_CREDIT_PROGRAM.repo}:${UK_UNIVERSAL_CREDIT_PROGRAM.path}#relation.${relation.name}`,
    ]),
  );
  const inputsByName = new Map<string, {
    legalId: LegalId;
    name: string;
    fileLegalId: string;
    sample: null;
    entity: string;
    relationLegalId?: LegalId;
  }>();

  const parameterRules: RuleNode[] = compiled.program.parameters.map((parameter) => {
    const latest = parameter.versions?.[parameter.versions.length - 1];
    const firstValue: { kind: string; value: unknown } | undefined = latest?.values
      ? Object.values(latest.values)[0]
      : undefined;
    return {
      legalId: parameter.id,
      name: parameter.name,
      fileLegalId: fileLegalId(parameter.id),
      kind: "parameter",
      entity: null,
      dtype: firstValue?.kind ?? "decimal",
      period: null,
      unit: parameter.unit ?? null,
      source: null,
      ruleDeps: [],
      inputDeps: [],
      relationDeps: [],
      formula: firstValue ? String(firstValue.value) : null,
    };
  });

  const derivedRules: RuleNode[] = compiled.program.derived.map((rule) => {
    const deps = collectCompiledDeps(rule.expr);
    const legalId = compiledRuleId(rule);
    const fileId = fileLegalId(legalId);
    const inputDeps = [...deps.inputs].sort().map((name) => {
      const existing = inputsByName.get(name);
      if (existing) return existing.legalId;
      const relationName = relationForInput(name, rule.entity, deps.relations);
      const input = {
        legalId: `${fileId}#input.${name}`,
        name,
        fileLegalId: fileId,
        sample: null,
        entity: relationName ? "Person" : "Household",
        relationLegalId: relationName ? relationIdByName.get(relationName) : undefined,
      };
      inputsByName.set(name, input);
      return input.legalId;
    });

    return {
      legalId,
      name: rule.name,
      fileLegalId: fileId,
      kind: "derived",
      entity: rule.entity ?? null,
      dtype: normalizeCompiledDtype(rule.dtype),
      period: rule.period ?? null,
      unit: rule.unit ?? null,
      source: rule.source ?? null,
      ruleDeps: [
        ...[...deps.derived]
          .map((name) => derivedIdByName.get(name))
          .filter((id): id is string => Boolean(id)),
        ...[...deps.parameters]
          .map((name) => parametersByName.get(name)?.id)
          .filter((id): id is string => Boolean(id)),
      ].sort(),
      inputDeps,
      relationDeps: [...deps.relations]
        .map((name) => relationIdByName.get(name))
        .filter((id): id is string => Boolean(id))
        .sort(),
      formula: rule.expr ? formulaFromCompiledExpr(rule.expr) : null,
    };
  });

  const relations = compiled.program.relations.map((relation) => {
    const legalId = relationIdByName.get(relation.name)!;
    return {
      legalId,
      name: relation.name,
      fileLegalId: `${UK_UNIVERSAL_CREDIT_PROGRAM.repo}:${UK_UNIVERSAL_CREDIT_PROGRAM.path}`,
      memberInputIds: [...inputsByName.values()]
        .filter((input) => input.relationLegalId === legalId)
        .map((input) => input.legalId)
        .sort(),
    };
  });

  const rules = [...derivedRules, ...parameterRules];
  return {
    rules,
    inputs: [...inputsByName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    relations,
    ownOutputs: DEFAULT_OUTPUTS_BY_COUNTRY.uk,
    terminalOutputs: terminalOutputs(rules),
  };
}

function collectCompiledDeps(expr: CompiledExpr | undefined): {
  derived: Set<string>;
  inputs: Set<string>;
  parameters: Set<string>;
  relations: Set<string>;
} {
  const deps = {
    derived: new Set<string>(),
    inputs: new Set<string>(),
    parameters: new Set<string>(),
    relations: new Set<string>(),
  };
  walkCompiledExpr(expr, (node) => {
    if (node.kind === "derived") deps.derived.add(node.name);
    if (node.kind === "input") deps.inputs.add(node.name);
    if (node.kind === "parameter_lookup") deps.parameters.add(node.parameter);
    if (node.kind === "sum_related") deps.relations.add(node.relation);
  });
  return deps;
}

function walkCompiledExpr(expr: CompiledExpr | undefined, visit: (expr: CompiledExpr) => void): void {
  if (!expr) return;
  visit(expr);
  switch (expr.kind) {
    case "literal":
      walkCompiledExpr(expr.value, visit);
      return;
    case "add":
    case "and":
    case "or":
    case "max":
    case "min":
      expr.items.forEach((item) => walkCompiledExpr(item, visit));
      return;
    case "sub":
    case "mul":
    case "comparison":
      walkCompiledExpr(expr.left, visit);
      walkCompiledExpr(expr.right, visit);
      return;
    case "not":
      walkCompiledExpr(expr.item, visit);
      return;
    case "if":
      walkCompiledExpr(expr.condition, visit);
      walkCompiledExpr(expr.then_expr, visit);
      walkCompiledExpr(expr.else_expr, visit);
      return;
    case "parameter_lookup":
      walkCompiledExpr(expr.index, visit);
      return;
    case "sum_related":
      walkCompiledExpr(expr.value, visit);
      walkCompiledExpr(expr.where ?? undefined, visit);
      return;
  }
}

function formulaFromCompiledExpr(expr: CompiledExpr): string {
  switch (expr.kind) {
    case "literal":
      return formulaFromCompiledExpr(expr.value);
    case "bool":
      return expr.value ? "true" : "false";
    case "integer":
      return String(expr.value);
    case "decimal":
      return expr.value;
    case "string":
      return JSON.stringify(expr.value);
    case "input":
    case "derived":
      return expr.name;
    case "parameter_lookup":
      return expr.parameter;
    case "add":
      return joinItems("+", expr.items);
    case "and":
      return joinItems("and", expr.items);
    case "or":
      return joinItems("or", expr.items);
    case "max":
    case "min":
      return `${expr.kind}(${expr.items.map(formulaFromCompiledExpr).join(", ")})`;
    case "sub":
      return `(${formulaFromCompiledExpr(expr.left)} - ${formulaFromCompiledExpr(expr.right)})`;
    case "mul":
      return `(${formulaFromCompiledExpr(expr.left)} * ${formulaFromCompiledExpr(expr.right)})`;
    case "not":
      return `not ${formulaFromCompiledExpr(expr.item)}`;
    case "comparison":
      return `(${formulaFromCompiledExpr(expr.left)} ${comparisonOp(expr.op)} ${formulaFromCompiledExpr(expr.right)})`;
    case "if":
      return `if ${formulaFromCompiledExpr(expr.condition)}: ${formulaFromCompiledExpr(expr.then_expr)} else: ${formulaFromCompiledExpr(expr.else_expr)}`;
    case "sum_related": {
      const args = [expr.relation, formulaFromCompiledExpr(expr.value)];
      if (expr.where) args.push(formulaFromCompiledExpr(expr.where));
      return `sum_related(${args.join(", ")})`;
    }
  }
}

function joinItems(op: string, items: CompiledExpr[]): string {
  return items.map((item) => `(${formulaFromCompiledExpr(item)})`).join(` ${op} `);
}

function comparisonOp(op: string): string {
  const map: Record<string, string> = { eq: "==", ne: "!=", lt: "<", lte: "<=", gt: ">", gte: ">=" };
  return map[op] ?? op;
}

function relationForInput(
  inputName: string,
  ruleEntity: string | null | undefined,
  relationDeps: Set<string>,
): string | undefined {
  if (ruleEntity !== "Person") return undefined;
  if (relationDeps.has("child_of_benefit_unit") && inputName.includes("child")) return "child_of_benefit_unit";
  if (relationDeps.has("adult_of_benefit_unit")) return "adult_of_benefit_unit";
  if (relationDeps.has("child_of_benefit_unit")) return "child_of_benefit_unit";
  return undefined;
}

function fileLegalId(legalId: LegalId): LegalId {
  return legalId.split("#")[0] ?? legalId;
}

function compiledRuleId(rule: { id?: string; name: string }): LegalId {
  return rule.id ?? `${UK_UNIVERSAL_CREDIT_PROGRAM.repo}:${UK_UNIVERSAL_CREDIT_PROGRAM.path}#${rule.name}`;
}

function normalizeCompiledDtype(dtype: string | null | undefined): string {
  const normalized = (dtype ?? "").toLowerCase();
  if (normalized === "money") return "decimal";
  if (normalized === "bool") return "boolean";
  return normalized || "decimal";
}

function terminalOutputs(rules: RuleNode[]): LegalId[] {
  const dependedOn = new Set(rules.flatMap((rule) => rule.ruleDeps));
  return rules
    .filter((rule) => rule.kind === "derived" && !dependedOn.has(rule.legalId))
    .map((rule) => rule.legalId)
    .sort();
}

function humanize(value: string): string {
  return value.replace(/^snap_/, "").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
