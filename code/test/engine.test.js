// Engine tests: the deterministic core, run with Node's built-in test runner.
//   npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const E = require("../src/engine/index.js");
const S = E.SEED;

// The Slack sample, as a correct extraction would read it.
const slack = () => ({ changes: [
  { id: "c1", type: "move_team", team_of: "E300", new_manager: "E200", to_cost_center: null, effective_date: "2026-11-01", confidence: 0.75 },
  { id: "c2", type: "merge_cost_centers", from_cost_center: "CC-4250", into_cost_center: "CC-4200", effective_date: "2026-11-01", confidence: 0.9 },
  { id: "c3", type: "move_employee", employee: "E110", new_manager: "E300", to_cost_center: "CC-4300", effective_date: "2026-11-01", confidence: 0.85 },
  { id: "c4", type: "comp_change", employee: "E110", effective_date: "2026-11-01", confidence: 0.9 },
] });
// The email sample: a cost-center split inside the month-end lockdown window.
const split = () => ({ changes: [
  { id: "c1", type: "create_cost_center", temp_id: "NEW1", name: "Sales West – Enterprise", owner: "E510", split_from: "CC-5200", effective_date: "2026-10-29", confidence: 0.9 },
  { id: "c2", type: "create_cost_center", temp_id: "NEW2", name: "Sales West – SMB", owner: "E520", split_from: "CC-5200", effective_date: "2026-10-29", confidence: 0.9 },
  { id: "c3", type: "move_team", team_of: "E510", new_manager: "E500", to_cost_center: "NEW1", effective_date: "2026-10-29", confidence: 0.85 },
  { id: "c4", type: "move_team", team_of: "E520", new_manager: "E500", to_cost_center: "NEW2", effective_date: "2026-10-29", confidence: 0.85 },
  { id: "c5", type: "transfer_headcount", from_cost_center: "CC-5200", to_cost_center: "NEW2", open_reqs: ["REQ-5201", "REQ-5202"], effective_date: "2026-10-29", confidence: 0.8 },
] });
const codes = (v, sev) => v.findings.filter((f) => !sev || f.sev === sev).map((f) => f.code);
function runAll(plan, keyFor) {
  const sys = E.initSystems(S);
  for (const s of plan.steps) if (s.write) E.apply(sys, s, s.mode === "manual" ? keyFor(s) : null);
  return sys;
}
const exactKey = (s) => (s.expect.end ? { cc: s.expect.cc, end: s.expect.end } : { cc: s.expect.cc, rule: s.expect.rule });

test("PII redaction replaces names, pay and contacts before the model sees them", () => {
  const { redacted, vault } = E.shield("Dev Okafor moves to Priya's team and gets $185k. Ping dana.w@halcyon.io or 415-555-0142. Thanks, Morgan Hale", S);
  assert.match(redacted, /\[E110\]/);
  assert.match(redacted, /\[AMBIG:E300\|E530\]/, "two people are called Priya");
  assert.match(redacted, /\[COMP_1\]/);
  assert.match(redacted, /\[EMAIL_1\]/);
  assert.match(redacted, /\[PHONE_1\]/);
  assert.match(redacted, /\[UNKNOWN_PERSON_1\]/);
  for (const secret of ["Okafor", "185", "halcyon.io", "555"]) assert.ok(!redacted.includes(secret), `${secret} leaked`);
  assert.ok(vault.length >= 6);
});

test("a pay change blocks the pipeline until it is routed out", () => {
  assert.ok(codes(E.validate(slack(), S), "blocker").includes("COMP_OUT_OF_BAND"));
  const cs = slack(); cs.changes = cs.changes.filter((c) => c.type !== "comp_change");
  const v = E.validate(cs, S);
  assert.equal(v.ok, true);
  assert.deepEqual(v.gates.map((g) => g.id), ["G1", "G2", "G3"]);
});

test("a merge derives the work nobody wrote down", () => {
  const cs = slack(); cs.changes = cs.changes.filter((c) => c.type !== "comp_change");
  const types = E.validate(cs, S).derived.map((d) => d.type);
  for (const t of ["transfer_headcount", "remap_gl", "close_cost_center"]) assert.ok(types.includes(t), t);
});

test("the runbook follows the accounting-first phase order", () => {
  const cs = slack(); cs.changes = cs.changes.filter((c) => c.type !== "comp_change");
  const v = E.validate(cs, S); const p = E.compile(cs, v, S);
  const phases = p.steps.map((s) => s.phase);
  assert.deepEqual(phases, [...phases].sort((a, b) => a - b), "phases never go backwards");
  const firstHris = p.steps.findIndex((s) => s.system === "hris");
  const lastErpOrPlanning = p.steps.map((s) => s.phase <= 2).lastIndexOf(true);
  assert.ok(lastErpOrPlanning < firstHris, "ERP and planning finish before the HRIS starts");
  assert.ok(p.steps.every((s) => s.system === "reconcile" || s.gate.includes("G1")), "every write needs G1");
});

test("validation catches dates, loops and unknown people", () => {
  const bad = { changes: [
    { id: "a", type: "change_manager", employee: "E200", new_manager: "E211", effective_date: "2026-11-01", confidence: 0.9 },
    { id: "b", type: "move_employee", employee: "E999", new_manager: "E200", effective_date: "2026-11-01", confidence: 0.9 },
    { id: "c", type: "change_manager", employee: "E101", new_manager: "E200", effective_date: "2026-09-15", confidence: 0.9 },
    { id: "d", type: "change_manager", employee: "E201", new_manager: "E100", effective_date: null, confidence: 0.9 },
  ] };
  const c = codes(E.validate(bad, S), "blocker");
  for (const k of ["CYCLE", "UNKNOWN_EMP", "CLOSED_PERIOD", "NO_DATE"]) assert.ok(c.includes(k), k);
});

test("a split in the lockdown window needs the Controller and creates two cost centers", () => {
  const v = E.validate(split(), S);
  assert.equal(v.ok, true);
  assert.ok(codes(v).includes("LOCKDOWN"));
  assert.ok(v.gates.some((g) => g.id === "G3"));
  const p = E.compile(split(), v, S);
  assert.equal(p.steps.filter((s) => s.mode === "manual").length, 2, "one keyed allocation rule per new cost center");
});

test("reconciliation passes when every step lands, and fails on a keying error", () => {
  const v = E.validate(split(), S); const p = E.compile(split(), v, S);
  assert.ok(E.reconcile(runAll(p, exactKey), v).every((r) => r.ok));
  let first = true;
  const sloppy = (s) => { const k = exactKey(s); if (first) { k.rule = { "Sales & Marketing": 90 }; first = false; } return k; };
  const fails = E.reconcile(runAll(p, sloppy), v).filter((r) => !r.ok);
  assert.ok(fails.some((r) => /sums to 90%/.test(r.detail)));
});

test("reconciling a half-finished reorg reports drift", () => {
  const cs = slack(); cs.changes = cs.changes.filter((c) => c.type !== "comp_change");
  const v = E.validate(cs, S);
  assert.ok(E.reconcile(E.initSystems(S), v).some((r) => !r.ok));
});

test("a retried step never applies twice", () => {
  const v = E.validate(split(), S); const p = E.compile(split(), v, S);
  const t = p.steps.find((s) => s.write && s.write.kind === "planning.transfer");
  const sys = E.initSystems(S);
  for (const s of p.steps) { if (s === t) break; if (s.write && s.mode !== "manual") E.apply(sys, s); }
  assert.equal(E.apply(sys, t), "applied");
  const once = E.clone(sys.planning);
  assert.equal(E.apply(sys, t), "skipped", "same idempotency key");
  assert.deepEqual(sys.planning, once, "no double-counted headcount or budget");
  // A corrected keying is a different write, so it does apply.
  const man = p.steps.find((s) => s.mode === "manual");
  assert.equal(E.apply(sys, man, { cc: man.expect.cc, rule: { "Sales & Marketing": 90 } }), "applied");
  assert.equal(E.apply(sys, man, { cc: man.expect.cc, rule: { "Sales & Marketing": 100 } }), "applied");
  assert.deepEqual(sys.allocation[man.expect.cc], { "Sales & Marketing": 100 });
});

test("SHA-256 matches Node's crypto", () => {
  for (const s of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "Reorg – Enterprise ✓"]) {
    assert.equal(E.sha256(s), crypto.createHash("sha256").update(s).digest("hex"));
  }
});

test("Human Queue Adapter tickets go stale on drift and verify independently", () => {
  const v = E.validate(split(), S); const p = E.compile(split(), v, S);
  const sys = E.initSystems(S);
  const man = p.steps.find((s) => s.mode === "manual");
  for (const s of p.steps) { if (s === man) break; if (s.write) E.apply(sys, s); }
  const t = E.makeTicket(man, sys, E.snapshotId(sys));
  assert.equal(t.state, "PENDING_KEYING");
  assert.match(t.payload_hash, /^[0-9a-f]{64}$/);
  assert.ok(t.instructions.every((i) => "old_value" in i && "new_value" in i));

  const good = exactKey(man); const sysGood = E.clone(sys); E.apply(sysGood, man, good);
  assert.equal(E.verifyTicket(t, good, sysGood).ok, true);

  const bad = { cc: man.expect.cc, rule: { "Sales & Marketing": 90 } }; const sysBad = E.clone(sys); E.apply(sysBad, man, bad);
  const r = E.verifyTicket(t, bad, sysBad);
  assert.equal(r.ok, false);
  assert.ok(r.mismatches.some((m) => /ERP control/.test(m)), "the ERP-side 100% control fires");

  const drifted = E.clone(sys); drifted.hris.employees[0].manager = "E001";
  assert.equal(E.ticketCurrent(t, E.snapshotId(drifted)), false);
});

test("cost centers are closed, never deleted, and new ones must really be new", () => {
  const cs = slack(); cs.changes = cs.changes.filter((c) => c.type !== "comp_change");
  const v = E.validate(cs, S); const p = E.compile(cs, v, S);
  const sys = runAll(p, exactKey);
  assert.equal(sys.erp.costCenters["CC-4250"].status, "closed", "merged cost center is closed");
  assert.ok(sys.allocation["CC-4250"], "its allocation rule is kept");
  assert.ok(sys.allocationEnd["CC-4250"], "and end-dated");
  assert.ok(sys.reporting["CC-4250"], "and it stays in reporting for history");
  assert.ok(E.reconcile(sys, v).every((r) => r.ok));
  const dup = { changes: [{ id: "c1", type: "create_cost_center", temp_id: "NEW1", name: "Data Engineering", owner: "E200", effective_date: "2026-11-01", confidence: 0.9 }] };
  assert.ok(codes(E.validate(dup, S), "blocker").includes("CC_EXISTS"));
});
