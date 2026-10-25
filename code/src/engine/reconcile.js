// Reconciliation.
// Independent of the plan: checks rules that span systems, plus conformance to the approved target.
// Part of the deterministic core: no model calls, no network, no DOM.
// Loads in the browser as a classic script and in Node via src/engine/index.js.
(function (RCC) {
  "use strict";

  // ----------------------------------------------------------- reconciliation
  // Independent of the plan: checks cross-system invariants on the live state,
  // plus that each system matches the approved target. This is the check that
  // today happens weeks later, in the financial reports.
  function reconcile(sys, v) {
    const out = [];
    const add = (ok, system, check, detail) => out.push({ ok, system, check, detail });
    const active = sys.hris.employees.filter((e) => e.status === "active");
    const liveCCs = Object.entries(sys.erp.costCenters).filter(([, c]) => c.status === "active").map(([k]) => k);

    for (const e of active) {
      const c = sys.erp.costCenters[e.cc];
      if (!c || c.status !== "active") add(false, "hris↔erp", "Every person sits in an active cost center", `${e.id} is in ${e.cc}, which is ${c ? c.status : "missing"} in the ERP.`);
    }
    if (!out.some((r) => r.check.startsWith("Every person"))) add(true, "hris↔erp", "Every person sits in an active cost center", `${active.length} people checked.`);

    let hcOk = true;
    for (const code of liveCCs) {
      const p = sys.planning[code];
      const filled = active.filter((e) => e.cc === code).length;
      if (!p) { hcOk = false; add(false, "hris↔planning", "Every cost center has a plan line", `${code} has people but no planning line.`); continue; }
      if (filled + p.openReqs.length > p.approvedHC) { hcOk = false; add(false, "hris↔planning", "Filled + open reqs within approved HC", `${code}: ${filled} filled + ${p.openReqs.length} open > ${p.approvedHC} approved.`); }
    }
    if (hcOk) add(true, "hris↔planning", "Filled + open reqs within approved HC", `${liveCCs.length} cost centers checked.`);

    let alOk = true;
    for (const code of liveCCs) {
      const rule = sys.allocation[code];
      const sum = rule ? Object.values(rule).reduce((a, b) => a + Number(b || 0), 0) : 0;
      if (!rule) { alOk = false; add(false, "erp↔allocation", "Every active cost center has an allocation rule", `${code} has no allocation rule. Its costs will sit unallocated at month end.`); }
      else if (sum !== 100) { alOk = false; add(false, "erp↔allocation", "Allocation rules sum to 100%", `${code} rule sums to ${sum}%.`); }
    }
    const ended = sys.allocationEnd || {};
    for (const code of Object.keys(sys.allocation)) if (!liveCCs.includes(code) && !ended[code]) { alOk = false; add(false, "erp↔allocation", "Closed cost centers have an end-dated rule", `${code} is closed but its allocation rule has no end date, so it would keep allocating.`); }
    if (alOk) add(true, "erp↔allocation", "Allocation rules complete and sum to 100%", `${liveCCs.length} rules checked.`);

    let rpOk = true;
    for (const code of liveCCs) if (!sys.reporting[code]) { rpOk = false; add(false, "erp↔reporting", "Every active cost center is in the reporting hierarchy", `${code} is missing; its spend drops out of reports.`); }
    const closedCCs = Object.entries(sys.erp.costCenters).filter(([, c]) => c.status === "closed").map(([k]) => k);
    for (const code of closedCCs) if (!sys.reporting[code]) { rpOk = false; add(false, "erp↔reporting", "Closed cost centers stay in reporting", `${code} is closed and missing from the hierarchy; its past spend drops out of historical reports.`); }
    if (rpOk) add(true, "erp↔reporting", "Reporting hierarchy covers every open and closed cost center", `${liveCCs.length + closedCCs.length} nodes checked.`);

    // Target-state conformance
    let tOk = true;
    for (const t of Object.values(v.target.emps)) {
      const e = sys.hris.employees.find((x) => x.id === t.id);
      if (e.cc !== t.cc || e.manager !== t.manager) { tOk = false; add(false, "hris", "HRIS matches approved target", `${t.id}: expected ${t.manager}/${t.cc}, found ${e.manager}/${e.cc}.`); }
    }
    if (tOk) add(true, "hris", "HRIS matches approved target", "All people match.");
    return out;
  }

  RCC.reconcile = reconcile;
})(globalThis.RCC = globalThis.RCC || {});
