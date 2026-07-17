import { useEffect, useMemo, useRef, useState } from "react";
import { InteractiveRuleGraph } from "./InteractiveRuleGraph";
import {
  countriesFromPrograms,
  PREFERRED_DEFAULT_PROGRAM_KEY,
  countryLabel,
  countryOf,
  countryShortLabel,
  defaultOutputsForProgram,
  displayNameForProgram,
  fetchAllPrograms,
  fetchProgramGraph,
  programKey,
  programRefFromSummary,
  summaryForProgram,
} from "./api";
import type { Country, DashboardSpec, LegalId, ParameterRule, ProgramGraph, ProgramRef, ProgramSummary, RuleNode, TraceNode } from "./types";

export function App() {
  const [allPrograms, setAllPrograms] = useState<ProgramSummary[]>([]);
  const [country, setCountry] = useState<Country>(() => initialCountry());
  const [program, setProgram] = useState<ProgramRef | null>(null);
  const [graph, setGraph] = useState<ProgramGraph | null>(null);
  const [selectedOutputs, setSelectedOutputs] = useState<LegalId[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [programsLoading, setProgramsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [outputSearch, setOutputSearch] = useState("");
  // Deep-link params, consumed once: ?program=us-co/co-snap selects a
  // program as soon as the registry loads; ?focus=us:statutes/7/2017
  // pre-selects the rules whose fileLegalId sits at or under that
  // prefix, so an external link (e.g. an Axiom app section page) lands
  // on the subgraph for the provision the reader came from.
  const [requestedProgramKey, setRequestedProgramKey] = useState<
    string | null
  >(() => initialParam("program"));
  const pendingFocusRef = useRef<string | null>(initialParam("focus"));

  // Load the full program registry once; countries and the per-country program
  // list are derived from it, so a newly compiled program appears here with no
  // code change.
  useEffect(() => {
    let cancelled = false;
    setProgramsLoading(true);
    fetchAllPrograms()
      .then((programs) => {
        if (!cancelled) setAllPrograms(programs);
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
  }, []);

  const countries = useMemo(() => countriesFromPrograms(allPrograms), [allPrograms]);
  const programs = useMemo(
    () => allPrograms.filter((item) => countryOf(item.jurisdiction) === country),
    [allPrograms, country],
  );

  useEffect(() => {
    syncCountryToUrl(country);
  }, [country]);

  // Keep the country/program selection valid as the registry loads or the
  // country changes: snap to an existing country, then default to its first
  // program when none is selected.
  useEffect(() => {
    if (allPrograms.length === 0) return;
    // A ?program= deep link wins once, as soon as the registry can
    // resolve it; the country snaps to the program's.
    if (requestedProgramKey) {
      const requested = allPrograms.find(
        (item) => programKey(item) === requestedProgramKey,
      );
      setRequestedProgramKey(null);
      if (requested) {
        const requestedCountry = countryOf(requested.jurisdiction);
        if (requestedCountry !== country) setCountry(requestedCountry);
        setProgram(programRefFromSummary(requested));
        return;
      }
    }
    if (!countries.includes(country)) {
      // Unknown country (bad ?country= param, or a country that lost its last
      // program): prefer US, else the first available.
      setCountry(countries.includes("us") ? "us" : countries[0]);
      return;
    }
    const selectionValid =
      program != null &&
      countryOf(program.jurisdiction) === country &&
      programs.some((item) => programKey(item) === programKey(program));
    if (!selectionValid) {
      const preferred = programs.find(
        (item) => programKey(item) === PREFERRED_DEFAULT_PROGRAM_KEY,
      );
      const next = preferred ?? programs[0];
      setProgram(next ? programRefFromSummary(next) : null);
    }
  }, [allPrograms, countries, country, programs, program, requestedProgramKey]);

  useEffect(() => {
    if (!program) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchProgramGraph(program)
      .then((nextGraph) => {
        if (cancelled) return;
        setGraph(nextGraph);
        setSelectedOutputs((current) => {
          const focus = pendingFocusRef.current;
          if (focus) {
            // "us:statutes/7/2017/a#rule_name" targets one rule;
            // without the fragment it's a file/section prefix.
            const matched = focus.includes("#")
              ? nextGraph.rules
                  .filter((rule) => rule.legalId === focus)
                  .map((rule) => rule.legalId)
              : nextGraph.rules
                  .filter(
                    (rule) =>
                      rule.fileLegalId === focus ||
                      rule.fileLegalId.startsWith(`${focus}/`),
                  )
                  .map((rule) => rule.legalId);
            if (matched.length > 0) {
              pendingFocusRef.current = null;
              return matched.slice(0, 24);
            }
          }
          const legalIds = new Set(nextGraph.rules.map((rule) => rule.legalId));
          const retained = current.filter((id) => legalIds.has(id));
          if (retained.length > 0) return retained;
          return defaultOutputsForProgram(nextGraph);
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
  }, [program]);

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
          sourceUrl: rule.sourceUrl,
          unit: rule.unit,
          dtype: rule.dtype,
          formula: rule.formula,
        })),
    [graph],
  );
  const spec = useMemo<DashboardSpec | null>(
    () =>
      program
        ? {
            specVersion: "0.1",
            meta: {
              title: program.displayName ?? program.programId,
            },
            program,
            period: { kind: "month", start: "2026-01-01" },
            inputs: [],
            outputs: selectedOutputs.map((legalId) => ({
              id: legalId.split("#").pop() ?? legalId,
              legalId,
              label: labelForRule(graph, legalId),
            })),
          }
        : null,
    [graph, program, selectedOutputs],
  );

  const selectedSet = useMemo(() => new Set(selectedOutputs), [selectedOutputs]);
  const selectedOutputRules = useMemo(
    () =>
      selectedOutputs.map((legalId) => ({
        legalId,
        label: labelForRule(graph, legalId),
      })),
    [graph, selectedOutputs],
  );
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
    const next = programs.find((item) => programKey(item) === value);
    if (!next) return;
    setProgram(programRefFromSummary(next));
    setGraph(null);
    setSelectedOutputs([]);
  }

  function selectCountry(nextCountry: Country) {
    if (nextCountry === country) return;
    setCountry(nextCountry);
    // The selection effect picks the first program of the new country.
    setProgram(null);
    setGraph(null);
    setSelectedOutputs([]);
    setOutputSearch("");
    setError(null);
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
              value={program ? programKey(program) : ""}
              onChange={(event) => selectProgram(event.target.value)}
              disabled={programs.length === 0}
            >
              {programs.length === 0 && <option value="">No programs available</option>}
              {programs.map((item) => (
                <option key={programKey(item)} value={programKey(item)}>
                  {displayNameForProgram(item)}
                </option>
              ))}
            </select>
          </label>
          {program && <p className="program-summary">{summaryForProgram(programs, program)}</p>}
        </section>

        <section className="control-block outputs-control">
          <div className="section-head outputs-head">
            <div>
              <h2>Outputs</h2>
              <span>Pick the graph results to show</span>
            </div>
            <strong>{selectedOutputs.length} selected</strong>
          </div>
          {selectedOutputRules.length > 0 && (
            <div className="selected-output-list" aria-label="Selected outputs">
              {selectedOutputRules.map((output) => (
                <button
                  type="button"
                  key={output.legalId}
                  onClick={() => toggleOutput(output.legalId)}
                  title="Remove output from graph"
                >
                  {output.label}
                </button>
              ))}
            </div>
          )}
          <label className="output-search">
            <span>Search outputs</span>
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
            <p>{program?.jurisdiction ?? ""}</p>
            <h1>{program?.displayName ?? "RuleSpec program"}</h1>
          </div>
          <div className="country-toggle" role="tablist" aria-label="Country">
            {countries.map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={country === option}
                className={`country-toggle-btn ${country === option ? "is-active" : ""}`}
                onClick={() => selectCountry(option)}
                title={countryLabel(option)}
              >
                {countryShortLabel(option)}
              </button>
            ))}
          </div>
        </header>

        <div className="graph-stage">
          {error && <div className="status error">{error}</div>}

          {loading ? (
            <div className="loading-state" role="status" aria-live="polite">
              <span className="loading-spinner" aria-hidden="true" />
              <span>Loading graph...</span>
            </div>
          ) : spec && Object.keys(structureTraces).length > 0 ? (
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
        </div>
      </section>
    </main>
  );
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
        sourceUrl: rule.sourceUrl ?? null,
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
        (/allotment|benefit|amount|award|allowance|deduction/i.test(rule.name) ? 25 : 0) +
        (/universal_credit_award_amount/i.test(rule.name) ? 40 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.rule.name.localeCompare(b.rule.name))
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

function labelForRule(graph: ProgramGraph | null, legalId: LegalId): string {
  const rule = graph?.rules.find((candidate) => candidate.legalId === legalId);
  return humanize(rule?.name ?? legalId.split("#").pop() ?? legalId);
}

function humanize(value: string): string {
  return value
    .replace(/^snap_/, "")
    .replace(/^universal_credit_/, "UC ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function initialCountry(): Country {
  if (typeof window === "undefined") return "us";
  return new URL(window.location.href).searchParams.get("country") ?? "us";
}

function initialParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  const value = new URL(window.location.href).searchParams.get(name);
  return value && value.trim().length > 0 ? value.trim() : null;
}

function syncCountryToUrl(country: Country) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (country === "us") url.searchParams.delete("country");
  else url.searchParams.set("country", country);
  window.history.replaceState({}, "", url.toString());
}
