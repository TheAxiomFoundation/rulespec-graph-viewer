import { useEffect, useMemo, useState } from "react";
import { InteractiveRuleGraph } from "./InteractiveRuleGraph";
import {
  DEFAULT_COMPUTE_URL,
  DEFAULT_OUTPUTS,
  DEFAULT_PROGRAM,
  fetchPrograms,
  fetchProgramGraph,
  fetchRepos,
} from "./api";
import type { DashboardSpec, LegalId, ParameterRule, ProgramGraph, ProgramRef, ProgramSummary, RuleNode, TraceNode } from "./types";

const SNAP_PROGRAM_LABELS: Record<string, string> = {
  "rules-us-co/policies/cdhs/snap/fy-2026-benefit-calculation.yaml": "Colorado SNAP FY 2026",
  "rules-us-ny/policies/otda/snap/fy-2026-benefit-calculation.yaml": "New York SNAP FY 2026",
};

export function App() {
  const computeUrl = DEFAULT_COMPUTE_URL;
  const [program, setProgram] = useState<ProgramRef>(DEFAULT_PROGRAM);
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [graph, setGraph] = useState<ProgramGraph | null>(null);
  const [selectedOutputs, setSelectedOutputs] = useState<LegalId[]>(DEFAULT_OUTPUTS);
  const [error, setError] = useState<string | null>(null);
  const [programsLoading, setProgramsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [outputSearch, setOutputSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setProgramsLoading(true);
    fetchRepos(computeUrl)
      .then((repos) => Promise.all(repos.map((repo) => fetchPrograms(computeUrl, repo))))
      .then((lists) => filterProgramsWithCalculationStructure(computeUrl, lists.flat()))
      .then((visualizablePrograms) => {
        if (cancelled) return;
        setPrograms(visualizablePrograms);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setProgramsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [computeUrl]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchProgramGraph(computeUrl, program)
      .then((nextGraph) => {
        if (cancelled) return;
        setGraph(nextGraph);
        setSelectedOutputs((current) => {
          const legalIds = new Set(nextGraph.rules.map((rule) => rule.legalId));
          const retained = current.filter((id) => legalIds.has(id));
          if (retained.length > 0) return retained;
          return pickDefaultOutputs(nextGraph);
        });
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [computeUrl, program]);

  const outputRules = useMemo(() => rankOutputRules(graph), [graph]);
  const filteredOutputRules = useMemo(() => {
    const query = outputSearch.trim().toLowerCase();
    if (!query) return outputRules;
    return outputRules.filter((rule) => {
      const haystack = [
        rule.name,
        humanize(rule.name),
        rule.legalId,
        rule.dtype,
        rule.kind,
        rule.source,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [outputRules, outputSearch]);
  const parameterRules = useMemo<ParameterRule[]>(
    () =>
      (graph?.rules ?? [])
        .filter((rule) => rule.kind === "parameter")
        .map((rule) => ({
          legalId: rule.legalId,
          name: rule.name,
          fileLegalId: rule.fileLegalId,
          source: rule.source,
          unit: rule.unit,
          dtype: rule.dtype,
          formula: rule.formula,
        })),
    [graph],
  );
  const spec = useMemo<DashboardSpec>(
    () => ({
      specVersion: "0.1",
      meta: {
        title: program.displayName ?? program.path,
      },
      program,
      period: { kind: "month", start: "2026-01-01" },
      inputs: [],
      outputs: selectedOutputs.map((legalId) => ({
        id: legalId.split("#").pop() ?? legalId,
        legalId,
        label: labelForRule(graph, legalId),
      })),
    }),
    [graph, program, selectedOutputs],
  );

  const selectedSet = useMemo(() => new Set(selectedOutputs), [selectedOutputs]);
  const structureTraces = useMemo(
    () => buildStructureTraces(graph, selectedOutputs),
    [graph, selectedOutputs],
  );

  function toggleOutput(legalId: LegalId) {
    setSelectedOutputs((current) =>
      current.includes(legalId)
        ? current.filter((id) => id !== legalId)
        : [...current, legalId],
    );
  }

  function selectProgram(value: string) {
    const next = programs.find((item) => `${item.repo}/${item.path}` === value);
    if (!next) return;
    setProgram({
      repo: next.repo,
      path: next.path,
      displayName: displayNameForProgram(next),
    });
    setGraph(null);
    setSelectedOutputs([]);
  }

  return (
    <main className="app-shell">
      <aside className="side-panel">
        <div className="brand">
          <span>Axiom</span>
          <strong>Rule Graph</strong>
          <p>Explore the structure of a RuleSpec computation without the dashboard builder workflow.</p>
        </div>

        <section className="control-block program-controls">
          <div className="section-head stacked">
            <h2>Program</h2>
            <span>
              {programsLoading
                ? "Loading programs"
                : graph
                  ? `${graph.rules.length} rules loaded`
                  : "Loading graph"}
            </span>
          </div>
          <label>
            Select program
            <select
              value={`${program.repo}/${program.path}`}
              onChange={(event) => selectProgram(event.target.value)}
            >
              {programs.length === 0 && (
                <option value={`${program.repo}/${program.path}`}>
                  {program.displayName ?? program.path}
                </option>
              )}
              {programs.map((item) => (
                <option key={`${item.repo}/${item.path}`} value={`${item.repo}/${item.path}`}>
                  {displayNameForProgram(item)}
                </option>
              ))}
            </select>
          </label>
          <p className="program-summary">{summaryForProgram(programs, program)}</p>
        </section>

        <section className="control-block">
          <div className="section-head">
            <h2>Outputs</h2>
            <span>{selectedOutputs.length} selected</span>
          </div>
          <label className="output-search">
            Search outputs
            <input
              type="search"
              value={outputSearch}
              onChange={(event) => setOutputSearch(event.target.value)}
              placeholder="Eligibility, allotment, income..."
            />
          </label>
          <div className="output-list">
            {filteredOutputRules.map((rule) => (
              <button
                type="button"
                key={rule.legalId}
                className={`output-option ${selectedSet.has(rule.legalId) ? "is-selected" : ""}`}
                onClick={() => toggleOutput(rule.legalId)}
              >
                <span>{humanize(rule.name)}</span>
                <small>{rule.dtype ?? rule.kind ?? "rule"}</small>
              </button>
            ))}
            {filteredOutputRules.length === 0 && (
              <div className="output-empty">No outputs match this search.</div>
            )}
          </div>
        </section>
      </aside>

      <section className="viewer-panel">
        <header className="viewer-header">
          <div>
            <p>{program.repo}</p>
            <h1>{program.displayName ?? "RuleSpec program"}</h1>
          </div>
        </header>

        {selectedOutputs.length > 0 && (
          <div className="selected-output-strip" aria-label="Selected outputs">
            {selectedOutputs.map((legalId) => (
              <button
                key={legalId}
                type="button"
                onClick={() => toggleOutput(legalId)}
                title="Remove output from graph"
              >
                {labelForRule(graph, legalId)}
              </button>
            ))}
          </div>
        )}

        {loading && <div className="status">Loading graph…</div>}
        {error && <div className="status error">{error}</div>}

        {Object.keys(structureTraces).length > 0 ? (
          <InteractiveRuleGraph
            spec={spec}
            traces={structureTraces}
            showValues={false}
            parameterRules={parameterRules}
            selectedOutputIds={selectedSet}
          />
        ) : (
          <div className="empty-state">Select at least one output to render its computation graph.</div>
        )}
      </section>
    </main>
  );
}

function pickDefaultOutputs(graph: ProgramGraph): LegalId[] {
  const byName = new Map(graph.rules.map((rule) => [rule.name, rule.legalId]));
  const curated = ["snap_eligible", "snap_allotment"]
    .map((name) => byName.get(name))
    .filter((id): id is string => !!id);
  if (curated.length > 0) return curated;
  return rankOutputRules(graph).slice(0, 2).map((rule) => rule.legalId);
}

function buildStructureTraces(
  graph: ProgramGraph | null,
  outputIds: LegalId[],
): Record<string, TraceNode> {
  if (!graph) return {};

  const rulesById = new Map(graph.rules.map((rule) => [rule.legalId, rule]));
  const inputsById = new Map(graph.inputs.map((input) => [input.legalId, input]));
  const relationsById = new Map(graph.relations.map((relation) => [relation.legalId, relation]));
  const cache = new Map<LegalId, TraceNode>();

  function nodeFor(legalId: LegalId, stack: Set<LegalId> = new Set()): TraceNode {
    const cached = cache.get(legalId);
    if (cached) return cached;

    const rule = rulesById.get(legalId);
    if (rule) {
      const trace: TraceNode = {
        legalId: rule.legalId,
        label: rule.name,
        ruleKind: rule.kind,
        value: null,
        dtype: traceDtype(rule.dtype),
        source: rule.source ?? undefined,
        formula: rule.formula ?? null,
        children: [],
      };
      cache.set(legalId, trace);
      if (!stack.has(legalId)) {
        const nextStack = new Set(stack).add(legalId);
        trace.children = [
          ...rule.ruleDeps,
          ...rule.inputDeps,
          ...rule.relationDeps,
        ].map((depId) => nodeFor(depId, nextStack));
      }
      return trace;
    }

    const input = inputsById.get(legalId);
    if (input) {
      const trace: TraceNode = {
        legalId: input.legalId,
        label: input.name,
        value: scalarSample(input.sample),
        dtype: "input",
        inputSource: "default",
        source: input.fileLegalId,
        homeFile: input.fileLegalId,
        children: [],
      };
      cache.set(legalId, trace);
      return trace;
    }

    const relation = relationsById.get(legalId);
    if (relation) {
      const trace: TraceNode = {
        legalId: relation.legalId,
        label: relation.name,
        value: null,
        dtype: "input",
        inputSource: "default",
        source: relation.fileLegalId,
        homeFile: relation.fileLegalId,
        children: [],
      };
      cache.set(legalId, trace);
      return trace;
    }

    const trace: TraceNode = {
      legalId,
      label: legalId.split("#").pop()?.replace(/^(input|relation)\./, "") ?? legalId,
      value: null,
      dtype: "input",
      inputSource: "default",
      children: [],
    };
    cache.set(legalId, trace);
    return trace;
  }

  return Object.fromEntries(
    outputIds
      .filter((legalId) => rulesById.has(legalId))
      .map((legalId) => [legalId, nodeFor(legalId)]),
  );
}

function traceDtype(dtype: string | null): TraceNode["dtype"] {
  const normalized = (dtype ?? "").toLowerCase();
  if (normalized === "judgment") return "judgment";
  if (normalized === "boolean" || normalized === "bool") return "boolean";
  if (normalized === "integer") return "integer";
  if (normalized === "date") return "date";
  if (normalized === "string" || normalized === "text") return "string";
  return "decimal";
}

function scalarSample(value: unknown): TraceNode["value"] {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return null;
}

function rankOutputRules(graph: ProgramGraph | null): RuleNode[] {
  if (!graph) return [];
  const terminal = new Set(graph.terminalOutputs);
  return graph.rules
    .filter(isGraphableOutputRule)
    .map((rule) => ({
      rule,
      score:
        (terminal.has(rule.legalId) ? 100 : 0) +
        (/eligible|eligibility/i.test(rule.name) ? 30 : 0) +
        (/allotment|benefit|amount/i.test(rule.name) ? 25 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.rule.name.localeCompare(b.rule.name))
    .slice(0, 40)
    .map(({ rule }) => rule);
}

function isGraphableOutputRule(rule: RuleNode): boolean {
  if (rule.kind !== "derived") return false;
  if (!rule.formula?.trim()) return false;
  return (
    rule.ruleDeps.length > 0 ||
    rule.inputDeps.length > 0 ||
    rule.relationDeps.length > 0
  );
}

async function filterProgramsWithCalculationStructure(
  computeUrl: string,
  candidates: ProgramSummary[],
): Promise<ProgramSummary[]> {
  const policies = candidates.filter(isSupportedSnapProgram);
  const visualizable: ProgramSummary[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < policies.length) {
      const item = policies[cursor++];
      try {
        const graph = await fetchProgramGraph(computeUrl, {
          repo: item.repo,
          path: item.path,
          displayName: displayNameForProgram(item),
        });
        if (rankOutputRules(graph).length > 0) visualizable.push(item);
      } catch {
        // Skip programs whose graph cannot be loaded from the current compute service.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(8, policies.length) }, worker));
  return visualizable.sort((a, b) => displayNameForProgram(a).localeCompare(displayNameForProgram(b)));
}

function isSupportedSnapProgram(program: ProgramSummary): boolean {
  return Boolean(SNAP_PROGRAM_LABELS[`${program.repo}/${program.path}`]);
}

function labelForRule(graph: ProgramGraph | null, legalId: LegalId): string {
  const rule = graph?.rules.find((candidate) => candidate.legalId === legalId);
  return humanize(rule?.name ?? legalId.split("#").pop() ?? legalId);
}

function displayNameForProgram(program: ProgramSummary): string {
  const snapLabel = SNAP_PROGRAM_LABELS[`${program.repo}/${program.path}`];
  if (snapLabel) return snapLabel;
  if (program.repo === DEFAULT_PROGRAM.repo && program.path === DEFAULT_PROGRAM.path) {
    return DEFAULT_PROGRAM.displayName ?? program.name;
  }
  const fallback = program.path.replace(/\.yaml$/, "").split("/").pop() ?? program.path;
  return humanize(program.name || fallback);
}

function summaryForProgram(programs: ProgramSummary[], program: ProgramRef): string {
  const match = programs.find((item) => item.repo === program.repo && item.path === program.path);
  return match?.summary ?? program.path;
}

function humanize(value: string): string {
  return value.replace(/^snap_/, "").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
