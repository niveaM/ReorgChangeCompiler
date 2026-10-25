// Validator.
// Applies a change set to a copy of the org, runs the rules, derives implied work and picks the approval gates.
// Part of the deterministic core: no model calls, no network, no DOM.
// Loads in the browser as a classic script and in Node via src/engine/index.js.
(function (RCC) {
  "use strict";
  const { clone } = RCC;

  // -------------------------------------------------------------- validator
  // Applies the change set to a copy of the people model, then runs checks
  // against every system of record. Also DERIVES the implied work the text
  // never mentions (budget follows people, GL remaps follow merges).
  function validate(changeSet, seed) {
    const findings = [];
    const add = (sev, code, msg, ref) => findings.push({ sev, code, msg, ref: ref || null });
    const derived = []; // implied changes the author did not state
    const emps = Object.fromEntries(seed.hris.employees.map((e) => [e.id, clone(e)]));
    const ccs = clone(seed.erp.costCenters);
    const tempCC = {}; // temp_id -> proposed code
    const ops = (changeSet && Array.isArray(changeSet.changes)) ? changeSet.changes : [];
    const isEmp = (id) => !!emps[id] && emps[id].status === "active";
    const resolveCC = (code) => (code && tempCC[code]) ? tempCC[code] : code;
    const ccExists = (code) => !!code && (!!ccs[resolveCC(code)]);
    const before = clone(emps);
    // Older readings may say retire_cost_center; cost centers are closed, never deleted.
    for (const c of ops) if (c.type === "retire_cost_center") c.type = "close_cost_center";

    if (!ops.length) add("blocker", "EMPTY", "No changes were extracted. Nothing can move.");

    // pass 1: create cost centers first so later ops can reference temp ids
    let nextCode = 10;
    for (const c of ops.filter((o) => o.type === "create_cost_center")) {
      const base = c.split_from && ccs[c.split_from] ? Number(c.split_from.slice(3)) : 9000;
      let code; do { code = "CC-" + (base + nextCode++); } while (ccs[code]);
      tempCC[c.temp_id || c.id] = code;
      ccs[code] = { name: c.name || "(unnamed)", status: "proposed", glDept: code.slice(3), entity: "HAL-US" };
      const same = c.name && Object.entries(seed.erp.costCenters).find(([, x]) => x.name.toLowerCase() === String(c.name).toLowerCase());
      if (same) add("blocker", "CC_EXISTS", `"${c.name}" already exists as ${same[0]}. Use the existing cost center instead of creating a new one.`, c.id);
      if (!c.name) add("blocker", "CC_NO_NAME", `New cost center ${c.temp_id} has no name.`, c.id);
      if (!c.owner) add("blocker", "CC_NO_OWNER", `New cost center "${c.name}" has no owner.`, c.id);
      else if (!isEmp(c.owner)) add("blocker", "UNKNOWN_EMP", `Owner ${c.owner} of "${c.name}" is not an active employee.`, c.id);
      add("approval", "NEW_CC_CODE", `"${c.name}" needs a cost center code. Proposed ${code}; Controller confirms in ERP.`, c.id);
    }

    const touched = {}; // employee -> [change ids]
    const touch = (id, cid) => (touched[id] = touched[id] || []).push(cid);

    for (const c of ops) {
      const where = c.id;
      if (typeof c.confidence === "number" && c.confidence < 0.8)
        add("approval", "LOW_CONFIDENCE", `Change ${c.id} (${c.type}) has confidence ${c.confidence}. A human must confirm the reading.`, where);
      if (c.type !== "other") checkDate(c, add, seed);

      switch (c.type) {
        case "move_employee":
        case "change_manager": {
          if (!c.employee) { add("blocker", "MISSING_EMP", `Change ${c.id} names no employee.`, where); break; }
          if (!isEmp(c.employee)) { add("blocker", "UNKNOWN_EMP", `${c.employee} is not an active employee.`, where); break; }
          touch(c.employee, c.id);
          if (c.new_manager) {
            if (!isEmp(c.new_manager)) add("blocker", "UNKNOWN_MGR", `New manager ${c.new_manager} is not an active employee.`, where);
            else if (c.new_manager === c.employee) add("blocker", "SELF_MGR", `${c.employee} cannot report to themselves.`, where);
            else emps[c.employee].manager = c.new_manager;
          }
          if (c.to_cost_center) {
            if (!ccExists(c.to_cost_center)) add("blocker", "UNKNOWN_CC", `Cost center ${c.to_cost_center} does not exist and is not created in this change set.`, where);
            else emps[c.employee].cc = resolveCC(c.to_cost_center);
          }
          if (c.type === "move_employee" && !c.new_manager && !c.to_cost_center)
            add("blocker", "NOOP_MOVE", `Move ${c.id} has neither a new manager nor a new cost center.`, where);
          break;
        }
        case "move_team": {
          if (!isEmp(c.team_of)) { add("blocker", "UNKNOWN_EMP", `Team leader ${c.team_of} is not an active employee.`, where); break; }
          const members = descendants(emps, c.team_of);
          if (c.new_manager) {
            if (!isEmp(c.new_manager)) add("blocker", "UNKNOWN_MGR", `New manager ${c.new_manager} is not an active employee.`, where);
            else if (members.includes(c.new_manager)) add("blocker", "CYCLE", `${c.new_manager} is inside ${c.team_of}'s team; this creates a reporting loop.`, where);
            else emps[c.team_of].manager = c.new_manager;
          }
          [c.team_of, ...members].forEach((id) => touch(id, c.id));
          if (c.to_cost_center) {
            if (!ccExists(c.to_cost_center)) add("blocker", "UNKNOWN_CC", `Cost center ${c.to_cost_center} does not exist.`, where);
            else [c.team_of, ...members].forEach((id) => (emps[id].cc = resolveCC(c.to_cost_center)));
          } else {
            add("warning", "RL_ONLY", `${c.team_of}'s team (${members.length + 1} people) changes reporting line but keeps cost center ${emps[c.team_of].cc}. Reporting rollups will be updated; budget stays put. Confirm this is intended.`, where);
          }
          break;
        }
        case "merge_cost_centers": {
          const from = c.from_cost_center, into = resolveCC(c.into_cost_center);
          if (!ccs[from]) { add("blocker", "UNKNOWN_CC", `Source cost center ${from} does not exist.`, where); break; }
          if (!ccExists(into)) { add("blocker", "UNKNOWN_CC", `Target cost center ${c.into_cost_center} does not exist.`, where); break; }
          const movers = Object.values(emps).filter((e) => e.cc === from && e.status === "active");
          movers.forEach((e) => { e.cc = into; touch(e.id, c.id); });
          ccs[from].status = "closing";
          const p = seed.planning[from] || { approvedHC: 0, budgetK: 0, openReqs: [] };
          derived.push({ id: `d-${c.id}-hc`, type: "transfer_headcount", from_cost_center: from, to_cost_center: into, count: p.approvedHC, budgetK: p.budgetK, open_reqs: p.openReqs, effective_date: c.effective_date, because: `merge ${from} into ${into}` });
          derived.push({ id: `d-${c.id}-gl`, type: "remap_gl", from_cost_center: from, to_cost_center: into, effective_date: c.effective_date, because: `merge ${from} into ${into}` });
          derived.push({ id: `d-${c.id}-close`, type: "close_cost_center", cost_center: from, effective_date: c.effective_date, because: `merge ${from} into ${into}` });
          add("approval", "MERGE", `Merging ${from} (${ccs[from].name}) into ${into}: ${movers.length} people, ${p.approvedHC} approved HC, $${p.budgetK}k budget and ${p.openReqs.length} open req(s) move; ${from} is then closed to new postings and kept for reporting.`, where);
          break;
        }
        case "transfer_headcount": {
          const from = resolveCC(c.from_cost_center), to = resolveCC(c.to_cost_center);
          if (!ccExists(from) || !ccExists(to)) add("blocker", "UNKNOWN_CC", `Headcount transfer ${c.id} names an unknown cost center.`, where);
          for (const r of c.open_reqs || []) {
            const owns = seed.planning[from] && seed.planning[from].openReqs.includes(r);
            if (!owns) add("blocker", "UNKNOWN_REQ", `${r} is not an open req in ${from}.`, where);
          }
          add("approval", "HC_TRANSFER", `Headcount transfer ${from} → ${to}${c.count ? ` (${c.count} HC)` : ""}${(c.open_reqs || []).length ? `, reqs ${c.open_reqs.join(", ")}` : ""}.`, where);
          break;
        }
        case "close_cost_center": {
          if (!ccs[c.cost_center]) add("blocker", "UNKNOWN_CC", `${c.cost_center} does not exist.`, where);
          else ccs[c.cost_center].status = "closing";
          break;
        }
        case "comp_change": {
          add("blocker", "COMP_OUT_OF_BAND", `Compensation change for ${c.employee || "someone"} detected. Comp is not processed here: route to the comp workflow with HRBP + comp partner approval, then remove it from this change set.`, where);
          break;
        }
        case "create_cost_center": break;
        case "other":
          add("blocker", "UNSTRUCTURED", `Change ${c.id} did not fit a known type: "${c.description || c.source_quote || ""}". A person must restate it or route it out.`, where);
          break;
        default:
          add("blocker", "BAD_TYPE", `Unknown change type "${c.type}".`, where);
      }
    }

    // Conflicts: same person changed by two ops with different outcomes is fine
    // only if they agree. Flag any person touched by >1 explicit person-level op.
    for (const [id, cids] of Object.entries(touched)) {
      const explicit = cids.filter((cid) => { const o = ops.find((x) => x.id === cid); return o && (o.type === "move_employee" || o.type === "change_manager"); });
      if (explicit.length > 1) add("blocker", "CONFLICT", `${id} is changed by ${explicit.join(" and ")}. Merge them into one change.`, explicit[0]);
    }

    // Cycles in the final reporting graph
    for (const id of Object.keys(emps)) {
      const seen = new Set(); let cur = id;
      while (cur && emps[cur]) { if (seen.has(cur)) { add("blocker", "CYCLE", `Reporting loop involving ${id}.`); break; } seen.add(cur); cur = emps[cur].manager; }
    }

    // Headcount conservation per cost center: filled after vs approved after
    const plan = clone(seed.planning);
    for (const code of Object.values(tempCC)) plan[code] = { approvedHC: 0, budgetK: 0, openReqs: [] };
    const allTransfers = [...ops.filter((o) => o.type === "transfer_headcount"), ...derived.filter((d) => d.type === "transfer_headcount")];
    for (const t of allTransfers) {
      const from = resolveCC(t.from_cost_center), to = resolveCC(t.to_cost_center);
      if (!plan[from] || !plan[to]) continue;
      const reqs = t.open_reqs || [];
      const count = t.count != null ? t.count : reqs.length;
      plan[from].approvedHC -= count; plan[to].approvedHC += count;
      plan[from].openReqs = plan[from].openReqs.filter((r) => !reqs.includes(r));
      plan[to].openReqs.push(...reqs.filter((r) => !plan[to].openReqs.includes(r)));
      if (t.budgetK) { plan[from].budgetK -= t.budgetK; plan[to].budgetK += t.budgetK; }
    }
    const filled = (state, code) => Object.values(state).filter((e) => e.cc === code && e.status === "active").length;
    const ccMoves = Object.values(emps).filter((e) => before[e.id].cc !== e.cc).map((e) => ({ id: e.id, from: before[e.id].cc, to: e.cc }));
    // Budget impact per CC from people moving (aggregate only: individual comp stays in the vault)
    const costDelta = {};
    for (const m of ccMoves) {
      const loaded = Math.round(before[m.id].comp * 1.3 / 1000); // 30% load
      costDelta[m.from] = (costDelta[m.from] || 0) - loaded;
      costDelta[m.to] = (costDelta[m.to] || 0) + loaded;
    }
    const allCodes = new Set([...Object.keys(plan)]);
    const hcTable = [];
    for (const code of allCodes) {
      if (ccs[code] && ccs[code].status === "closing") { hcTable.push({ cc: code, before: filled(before, code), after: filled(emps, code), approvedAfter: plan[code].approvedHC, costDeltaK: costDelta[code] || 0, closing: true }); continue; }
      const f = filled(emps, code) + 0; const reqs = plan[code].openReqs.length;
      const row = { cc: code, before: filled(before, code), after: f, openReqs: reqs, approvedAfter: plan[code].approvedHC, costDeltaK: costDelta[code] || 0, budgetAfterK: plan[code].budgetK };
      hcTable.push(row);
      if (f + reqs > plan[code].approvedHC && (row.after !== row.before || costDelta[code])) {
        const gap = f + reqs - plan[code].approvedHC;
        add("approval", "HC_OVER_PLAN", `${code} would have ${f} filled + ${reqs} open req(s) against ${plan[code].approvedHC} approved HC (${gap} over). FP&A must transfer headcount or approve the overage.`);
        // propose a transfer from the CC that lost people, if any
        const donor = ccMoves.find((m) => m.to === code);
        if (donor) derived.push({ id: `d-hc-${code}`, type: "transfer_headcount", from_cost_center: donor.from, to_cost_center: code, count: gap, effective_date: (ops[0] || {}).effective_date, because: `people moved ${donor.from} → ${code}; proposed so budget follows people`, proposed: true });
      }
    }
    // A CC left with no people but still open after the change
    for (const code of Object.keys(ccs)) {
      if (ccs[code].status === "active" && filled(before, code) > 0 && filled(emps, code) === 0)
        add("warning", "EMPTY_CC", `${code} (${ccs[code].name}) has no people after this change. It stays open unless you close it to new postings; either way it is kept for reporting.`);
      if (ccs[code].status === "closing" && filled(emps, code) > 0)
        add("blocker", "CLOSE_NONEMPTY", `${code} is being closed but still has ${filled(emps, code)} people.`);
    }
    // Owner left behind: a person whose new manager sits in a different CC
    for (const e of Object.values(emps)) {
      if (!touched[e.id]) continue;
      const mgr = emps[e.manager];
      if (mgr && mgr.cc !== e.cc && before[e.id].cc === e.cc && before[e.id].manager !== e.manager)
        add("info", "CROSS_CC_MANAGER", `${e.id} will report to ${mgr.id} (${mgr.cc}) but stays in ${e.cc}. Common for reporting-line moves; flagged in case the cost center should move too.`);
    }
    // Remaining AMBIG / UNKNOWN tokens leaking into fields
    for (const c of ops) for (const [k, v] of Object.entries(c)) {
      if (typeof v === "string" && /AMBIG|UNKNOWN_PERSON/.test(v) && !["source_quote", "notes"].includes(k))
        add("blocker", "UNRESOLVED_PERSON", `Field ${k} of ${c.id} is still an unresolved person (${v}).`, c.id);
    }
    for (const q of (changeSet && changeSet.questions) || []) add("approval", "OPEN_QUESTION", q);

    // Collapse repeated date findings into one line each
    for (const code of ["LOCKDOWN", "RETRO", "NO_DATE"]) {
      const hits = findings.filter((f) => f.code === code);
      if (hits.length > 1) {
        const ids = hits.map((h) => h.ref).join(", ");
        const first = hits[0];
        first.msg = first.msg.replace(/^Change \S+ is/, `Changes ${ids} are`).replace(/^Change \S+ has/, `Changes ${ids} have`);
        for (const h of hits.slice(1)) findings.splice(findings.indexOf(h), 1);
      }
    }
    const gates = gatesFor(ops, derived, findings, seed);
    const blockers = findings.filter((f) => f.sev === "blocker").length;
    return { findings, derived, tempCC, target: { emps, ccs, plan }, before, ccMoves, hcTable, gates, ok: blockers === 0 };
  }

  function checkDate(c, add, seed) {
    const d = c.effective_date;
    if (!d) { add("blocker", "NO_DATE", `Change ${c.id} has no effective date.`, c.id); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { add("blocker", "BAD_DATE", `Change ${c.id} has an unreadable date "${d}".`, c.id); return; }
    if (d < seed.fiscal.openFrom) add("blocker", "CLOSED_PERIOD", `Change ${c.id} is effective ${d}, inside a closed period. Retro changes need a Controller-led adjustment, not this pipeline.`, c.id);
    else if (d < seed.asOf) add("approval", "RETRO", `Change ${c.id} is effective ${d}, before today. Payroll and allocations already ran on the old org.`, c.id);
    else if (d >= seed.fiscal.lockdownFrom && d <= seed.fiscal.openPeriodEnd) add("approval", "LOCKDOWN", `Change ${c.id} is effective ${d}, inside month-end lockdown (from ${seed.fiscal.lockdownFrom}). GL changes need Controller sign-off, or move the date to ${nextDay(seed.fiscal.openPeriodEnd)}.`, c.id);
  }
  function nextDay(iso) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
  function descendants(emps, id) {
    const out = []; const q = [id];
    while (q.length) { const cur = q.shift(); for (const e of Object.values(emps)) if (e.manager === cur && e.status === "active") { out.push(e.id); q.push(e.id); } }
    return out;
  }

  // Which humans must approve, and why. Codified, not remembered.
  function gatesFor(ops, derived, findings, seed) {
    const has = (code) => findings.some((f) => f.code === code);
    const types = new Set([...ops.map((o) => o.type), ...derived.map((d) => d.type)]);
    const gates = [
      { id: "G1", who: "HR business partner (requester)", what: "Confirms the extracted change set is what was meant. Nothing is planned or written before this.", required: true, why: "The input is freeform. Misreading intent is the highest-blast-radius error, and only the author can rule it out." },
    ];
    if (types.has("transfer_headcount") || has("HC_OVER_PLAN") || types.has("merge_cost_centers") || types.has("create_cost_center"))
      gates.push({ id: "G2", who: "FP&A partner", what: "Approves headcount and budget moves (aggregate cost deltas per cost center, no individual pay).", required: true, why: "Budget does not follow people automatically; deciding whether it should is a business call." });
    if (types.has("create_cost_center") || types.has("merge_cost_centers") || types.has("close_cost_center") || types.has("remap_gl") || has("LOCKDOWN") || has("RETRO"))
      gates.push({ id: "G3", who: "Controller", what: "Approves cost center / GL master data and allocation changes, and anything touching a close window.", required: true, why: "These changes alter the books; errors surface weeks later in reported numbers." });
    return gates;
  }

  RCC.validate = validate;
})(globalThis.RCC = globalThis.RCC || {});
