import { useEffect, useMemo, useState } from "react";
import { InteractiveRuleGraph } from "./InteractiveRuleGraph";
import {
  DEFAULT_COMPUTE_URL,
  DEFAULT_OUTPUTS,
  DEFAULT_PROGRAM,
  computeTrace,
  fetchPrograms,
  fetchProgramGraph,
  fetchRepos,
} from "./api";
import type { ComputeResponse, DashboardSpec, LegalId, ParameterRule, ProgramGraph, ProgramRef, ProgramSummary, RuleNode } from "./types";

export function App() {
  const computeUrl = DEFAULT_COMPUTE_URL;
  const [program, setProgram] = useState<ProgramRef>(DEFAULT_PROGRAM);
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [graph, setGraph] = useState<ProgramGraph | null>(null);
  const [selectedOutputs, setSelectedOutputs] = useState<LegalId[]>(DEFAULT_OUTPUTS);
  const [result, setResult] = useState<ComputeResponse | null>(null);
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

  useEffect(() => {
    if (selectedOutputs.length === 0) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setError(null);
    computeTrace(computeUrl, program, selectedOutputs)
      .then((nextResult) => {
        if (!cancelled) setResult(nextResult);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [computeUrl, program, selectedOutputs]);

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
    setResult(null);
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
            <div className="program-path">{program.path}</div>
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
        {result?.warnings?.map((warning) => (
          <div className="status warning" key={warning}>
            {warning}
          </div>
        ))}

        {result && selectedOutputs.length > 0 ? (
          <InteractiveRuleGraph
            spec={spec}
            traces={result.traces}
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
  const policies = candidates.filter((item) => item.kind === "policies");
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

function labelForRule(graph: ProgramGraph | null, legalId: LegalId): string {
  const rule = graph?.rules.find((candidate) => candidate.legalId === legalId);
  return humanize(rule?.name ?? legalId.split("#").pop() ?? legalId);
}

function displayNameForProgram(program: ProgramSummary): string {
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
