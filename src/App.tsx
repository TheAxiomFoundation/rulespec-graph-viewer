import { useEffect, useMemo, useState } from "react";
import { InteractiveRuleGraph } from "./InteractiveRuleGraph";
import {
  DEFAULT_COMPUTE_URL,
  DEFAULT_OUTPUTS,
  DEFAULT_PROGRAM,
  computeTrace,
  fetchProgramGraph,
} from "./api";
import type { ComputeResponse, DashboardSpec, LegalId, ParameterRule, ProgramGraph, ProgramRef, RuleNode } from "./types";

export function App() {
  const [computeUrl, setComputeUrl] = useState(DEFAULT_COMPUTE_URL);
  const [program, setProgram] = useState<ProgramRef>(DEFAULT_PROGRAM);
  const [graph, setGraph] = useState<ProgramGraph | null>(null);
  const [selectedOutputs, setSelectedOutputs] = useState<LegalId[]>(DEFAULT_OUTPUTS);
  const [result, setResult] = useState<ComputeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  function loadProgram() {
    setProgram({
      repo: program.repo.trim(),
      path: program.path.trim(),
      displayName: program.displayName?.trim() || program.path.trim(),
    });
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
            <span>{graph ? `${graph.rules.length} rules loaded` : "Not loaded"}</span>
          </div>
          <label>
            Compute URL
            <input value={computeUrl} onChange={(event) => setComputeUrl(event.target.value)} />
          </label>
          <label>
            Repo
            <input
              value={program.repo}
              onChange={(event) => setProgram({ ...program, repo: event.target.value })}
            />
          </label>
          <label>
            Program path
            <textarea
              rows={3}
              value={program.path}
              onChange={(event) => setProgram({ ...program, path: event.target.value })}
            />
          </label>
          <button type="button" className="primary-button" onClick={loadProgram}>
            Load program
          </button>
        </section>

        <section className="control-block">
          <div className="section-head">
            <h2>Outputs</h2>
            <span>{selectedOutputs.length} selected</span>
          </div>
          <div className="output-list">
            {outputRules.map((rule) => (
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
          <div className="structure-badge">Structure only</div>
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
            onAddOutput={toggleOutput}
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
    .filter((rule) => rule.kind === "derived")
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

function labelForRule(graph: ProgramGraph | null, legalId: LegalId): string {
  const rule = graph?.rules.find((candidate) => candidate.legalId === legalId);
  return humanize(rule?.name ?? legalId.split("#").pop() ?? legalId);
}

function humanize(value: string): string {
  return value.replace(/^snap_/, "").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
