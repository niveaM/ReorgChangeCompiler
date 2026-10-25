// Runbook compiler.
// Turns a validated change set into ordered, gated steps. The phase order is data, not inference.
// Part of the deterministic core: no model calls, no network, no DOM.
// Loads in the browser as a classic script and in Node via src/engine/index.js.
(function (RCC) {
  "use strict";
  const { clone } = RCC;

  // ------------------------------------------------------------ plan compiler
  // The runbook is data. Order is codified by phase; each step records why.
  const PHASES = [
    { n: 1, sys: "erp", why: "Any new cost center must exist in the ERP before another system references it, or payroll posts to a suspense account." },
    { n: 2, sys: "planning", why: "Move approved headcount and budget before people, so the people move does not show as a false variance." },
    { n: 3, sys: "hris", why: "People and manager changes go in once their target cost centers and budget exist. Scheduled for the effective date." },
    { n: 4, sys: "allocation", why: "Allocation rules must cover every cost center that will carry cost before the period's allocation run." },
    { n: 5, sys: "erp_close", why: "Close a cost center to new postings only after nobody is assigned to it. It is never deleted: its history stays in the ERP and in reporting." },
    { n: 6, sys: "reporting", why: "Reporting rollups are rebuilt last, from the final state of the other systems." },
  ];

  function compile(changeSet, v, seed) {
    const ops = changeSet.changes || [];
    const steps = [];
    const add = (s) => { s.id = "S" + String(steps.length + 1).padStart(2, "0"); steps.push(s); return s.id; };
    const R = (c) => v.tempCC[c] || c;
    const eff = ops.map((o) => o.effective_date).filter(Boolean).sort()[0] || null;
    const gateIds = v.gates.map((g) => g.id);
    const needs = (g) => (gateIds.includes(g) ? [g] : []);

    // Phase 1: ERP master data
    for (const c of ops.filter((o) => o.type === "create_cost_center")) {
      const code = R(c.temp_id || c.id);
      add({ phase: 1, system: "erp", mode: "api", gate: needs("G3").concat("G1"), action: `Create cost center ${code} "${c.name}" with GL dept ${code.slice(3)}`, write: { kind: "erp.create", code, name: c.name }, from: c.id });
      add({ phase: 1, system: "planning", mode: "api", gate: ["G1"].concat(needs("G2")), action: `Create planning line for ${code} (0 HC until transfers land)`, write: { kind: "planning.create", code }, from: c.id });
    }
    const remaps = v.derived.filter((d) => d.type === "remap_gl");
    for (const d of remaps)
      add({ phase: 1, system: "erp", mode: "api", gate: ["G1"].concat(needs("G3")), action: `Map GL activity for ${d.from_cost_center} to ${d.to_cost_center} from ${d.effective_date}`, write: { kind: "erp.remap", from: d.from_cost_center, to: d.to_cost_center }, from: d.id });

    // Phase 2: planning
    const transfers = [...ops.filter((o) => o.type === "transfer_headcount"), ...v.derived.filter((d) => d.type === "transfer_headcount")];
    for (const t of transfers)
      add({ phase: 2, system: "planning", mode: "api", gate: ["G1"].concat(needs("G2")), action: `Transfer ${t.count != null ? t.count + " approved HC" : (t.open_reqs || []).length + " HC"}${t.budgetK ? `, $${t.budgetK}k budget` : ""}${(t.open_reqs || []).length ? `, reqs ${t.open_reqs.join(", ")}` : ""} from ${R(t.from_cost_center)} to ${R(t.to_cost_center)}${t.proposed ? " (proposed by validator)" : ""}`, write: { kind: "planning.transfer", from: R(t.from_cost_center), to: R(t.to_cost_center), count: t.count != null ? t.count : (t.open_reqs || []).length, budgetK: t.budgetK || 0, reqs: t.open_reqs || [] }, from: t.id });

    // Phase 3: HRIS — one step per person whose record changes
    for (const e of Object.values(v.target.emps)) {
      const b = v.before[e.id];
      if (b.manager === e.manager && b.cc === e.cc) continue;
      const parts = [];
      if (b.manager !== e.manager) parts.push(`manager ${b.manager} → ${e.manager}`);
      if (b.cc !== e.cc) parts.push(`cost center ${b.cc} → ${e.cc}`);
      add({ phase: 3, system: "hris", mode: "api", gate: ["G1"].concat(needs("G2")), action: `${e.id}: ${parts.join("; ")}`, write: { kind: "hris.update", emp: e.id, manager: e.manager, cc: e.cc }, effective: eff });
    }

    // Phase 4: allocation engine (manual key-in). Every new CC needs a rule; a closing CC's rule is end-dated, not deleted.
    for (const c of ops.filter((o) => o.type === "create_cost_center")) {
      const code = R(c.temp_id || c.id);
      const parentRule = c.split_from && seed.allocation[c.split_from];
      add({ phase: 4, system: "allocation", mode: "manual", gate: ["G1"].concat(needs("G3")), action: `Key allocation rule for ${code} "${c.name}"`, expect: { cc: code, rule: parentRule ? clone(parentRule) : null }, note: parentRule ? `Inherits ${c.split_from}'s rule unless FP&A says otherwise.` : "No parent rule; FP&A must specify targets.", write: { kind: "alloc.set", cc: code } });
    }
    const closing = v.derived.filter((x) => x.type === "close_cost_center").concat(ops.filter((o) => o.type === "close_cost_center"));
    for (const d of closing) {
      const end = d.effective_date || eff;
      add({ phase: 4, system: "allocation", mode: "manual", gate: ["G1"].concat(needs("G3")), action: `End-date the allocation rule for ${d.cost_center} at ${end}`, note: "The rule is kept, so past periods still allocate correctly.", expect: { cc: d.cost_center, end }, write: { kind: "alloc.end", cc: d.cost_center, end } });
    }

    // Phase 5: close (never delete)
    for (const d of closing)
      add({ phase: 5, system: "erp", mode: "api", gate: ["G1"].concat(needs("G3")), action: `Close ${d.cost_center} to new postings once the HRIS moves land. It stays in the ERP with its history.`, write: { kind: "erp.close", code: d.cost_center } });

    // Phase 6: reporting
    const rollups = {};
    const affected = new Set();
    for (const e of Object.values(v.target.emps)) {
      const b = v.before[e.id];
      if (b.cc !== e.cc || b.manager !== e.manager) { affected.add(b.cc); affected.add(e.cc); }
    }
    for (const [code, cc] of Object.entries(v.target.ccs)) {
      if (cc.status === "closing") continue; // stays in the hierarchy so past periods still report
      if (!affected.has(code)) continue;
      const path = rollupFor(code, v.target.emps, v.target.ccs, seed);
      if (seed.reporting[code] !== path) rollups[code] = path;
    }
    for (const [code, path] of Object.entries(rollups))
      add({ phase: 6, system: "reporting", mode: "api", gate: ["G1"], action: `Set rollup for ${code}: ${path}`, write: { kind: "reporting.set", cc: code, path } });

    for (const s of steps) s.gate = ["G1", "G2", "G3"].filter((g) => s.gate.includes(g));
    // Dependencies: each step depends on all steps in earlier phases (simple, safe)
    for (const s of steps) s.dependsOn = steps.filter((o) => o.phase < s.phase).map((o) => o.id);
    add({ phase: 7, system: "reconcile", mode: "api", gate: [], action: "Reconcile all five systems against the approved target state", dependsOn: steps.map((s) => s.id) });
    return { steps, phases: PHASES, effective: eff };
  }

  // Rollup path derived from the CC owner's management chain.
  function rollupFor(code, emps, ccs, seed) {
    const members = Object.values(emps).filter((e) => e.cc === code && e.status === "active");
    if (!members.length) return seed.reporting[code] || null;
    const owner = members.find((e) => !members.some((o) => o.id === e.manager)) || members[0];
    // Walk up to find the nearest CC above this one
    let mgr = emps[owner.manager];
    while (mgr && mgr.cc === code) mgr = emps[mgr.manager];
    const name = seed.reporting[code] ? seed.reporting[code].split(" > ").pop() : ccs[code].name;
    if (!mgr) return "Halcyon > " + name;
    const parentPath = seed.reporting[mgr.cc];
    // Executive CC is the root bucket; its direct children hang off the function
    if (mgr.cc === "CC-1000") {
      const fn = (seed.reporting[code] || "").split(" > ")[1] || functionFor(owner, seed);
      return `Halcyon > ${fn} > ${name}`;
    }
    return parentPath ? `${parentPath} > ${name}` : `Halcyon > ${name}`;
  }
  function functionFor(owner, seed) { return /Sales/.test(owner.title) ? "Revenue" : /Account|Finance|Controller/.test(owner.title) ? "G&A" : "Engineering"; }

  RCC.PHASES = PHASES;
  RCC.compile = compile;
})(globalThis.RCC = globalThis.RCC || {});
