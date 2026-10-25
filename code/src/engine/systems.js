// Simulated systems of record.
// Initial state and the write each runbook step performs.
// Part of the deterministic core: no model calls, no network, no DOM.
// Loads in the browser as a classic script and in Node via src/engine/index.js.
(function (RCC) {
  "use strict";
  const { clone } = RCC;

  // ------------------------------------------------------- simulated execution
  function initSystems(seed) {
    // `applied` is the connector-side idempotency ledger (design §3.4: apply(ops, key)).
    return { hris: clone(seed.hris), erp: clone(seed.erp), planning: clone(seed.planning), allocation: clone(seed.allocation), allocationEnd: {}, reporting: clone(seed.reporting), applied: {} };
  }
  // Idempotency key for a step. Design §3.4: key = changeId + phase + step.
  // For a keyed (manual) step the keyed values are part of the key, so a
  // correction after a failed verification is a new write, but replaying the
  // same keying is not.
  function stepKey(step, keyed, changeId) {
    return [changeId || "cs", step.phase, step.id].join(":") + (keyed ? ":" + JSON.stringify(keyed) : "");
  }
  // Applies one step to the simulated systems. For manual steps, `keyed` is
  // what the human says they typed, which may differ from what was expected.
  // Returns "applied", or "skipped" when this exact write was already applied,
  // so a retry can never apply twice (e.g. a planning transfer double-counting).
  function apply(sys, step, keyed, changeId) {
    const w = step.write; if (!w) return "skipped";
    const key = stepKey(step, keyed, changeId);
    sys.applied = sys.applied || {};
    if (sys.applied[key]) return "skipped";
    sys.applied[key] = true;
    switch (w.kind) {
      case "erp.create": sys.erp.costCenters[w.code] = { name: w.name, status: "active", glDept: w.code.slice(3), entity: "HAL-US" }; break;
      case "erp.remap": sys.erp.costCenters[w.from].remapTo = w.to; break;
      case "erp.close": sys.erp.costCenters[w.code].status = "closed"; break; // closed to new postings, never deleted
      case "planning.create": sys.planning[w.code] = sys.planning[w.code] || { approvedHC: 0, budgetK: 0, openReqs: [] }; break;
      case "planning.transfer": {
        const f = sys.planning[w.from], t = sys.planning[w.to];
        f.approvedHC -= w.count; t.approvedHC += w.count; f.budgetK -= w.budgetK; t.budgetK += w.budgetK;
        f.openReqs = f.openReqs.filter((r) => !w.reqs.includes(r)); t.openReqs.push(...w.reqs);
        break;
      }
      case "hris.update": { const e = sys.hris.employees.find((x) => x.id === w.emp); e.manager = w.manager; e.cc = w.cc; break; }
      case "alloc.set": sys.allocation[keyed && keyed.cc || w.cc] = keyed ? keyed.rule : {}; break;
      case "alloc.end": sys.allocationEnd = sys.allocationEnd || {}; sys.allocationEnd[keyed && keyed.cc || w.cc] = keyed && keyed.end || w.end; break; // rule kept for history
      case "reporting.set": sys.reporting[w.cc] = w.path; break;
    }
    return "applied";
  }

  RCC.initSystems = initSystems;
  RCC.stepKey = stepKey;
  RCC.apply = apply;
})(globalThis.RCC = globalThis.RCC || {});
