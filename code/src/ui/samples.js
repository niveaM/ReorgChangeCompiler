// Three sample reorg messages, each with a hand-written reading.
// The hand-written reading is what a correct extraction should produce. It lets the
// whole pipeline run without a model (offline demos, reviewers without an API key).
(function (RCC) {
  "use strict";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Dates in the samples move with "today", so each sample keeps its point:
// Slack lands on the 1st of next month, the email split falls inside this month's
// lockdown, and the doc starts the month after next with a hire after that.
function sampleDates(seed) {
  const [y, m] = seed.asOf.split("-").map(Number);
  const plus = (k) => { const t = m - 1 + k; return { y: y + Math.floor(t / 12), m: (t % 12) + 1 }; };
  const n1 = plus(1), n2 = plus(2), n3 = plus(3);
  const lock = (seed.fiscal.lockdownDays || [seed.fiscal.lockdownFrom])[1] || seed.fiscal.lockdownFrom;
  const email = seed.asOf > lock ? seed.asOf : lock;
  const [, em, ed] = email.split("-").map(Number);
  return {
    slack: RCC.isoDate(n1.y, n1.m, 1), slackText: `${MON[n1.m - 1]} 1`,
    email, emailText: `${em}/${ed}`,
    doc: RCC.isoDate(n2.y, n2.m, 1), docText: `${MON[n2.m - 1]} 1`,
    hireMonth: MONTH[n3.m - 1],
  };
}
function makeSamples(seed) {
  const D = sampleDates(seed);
  return [
  { key: "slack", label: "Slack · VP Engineering",
    text: `Heads up team — effective ${D.slackText}, Priya's ML Infra team is moving under Marcus in Data Eng. Priya stays on as manager but now reports to Marcus. We're also folding the Data Platform cost center into Data Engineering. Dev Okafor moves from Platform over to ML Infra (reporting to Priya) and gets bumped to $185k as part of this. Ping dana.w@halcyon.io or 415-555-0142 with questions.`,
    ref: { summary: "ML Infra team moves under Data Engineering; Data Platform merges into Data Engineering; Dev Okafor moves to ML Infra.", changes: [
      { id: "c1", type: "move_team", team_of: "E300", new_manager: "E200", to_cost_center: null, effective_date: D.slack, source_quote: "[AMBIG:E300|E530]'s ML Infra team is moving under [E200] in Data Eng", confidence: 0.75, notes: "AMBIG resolved to E300: only Priya who manages ML Infrastructure. Reporting line only; no cost center stated." },
      { id: "c2", type: "merge_cost_centers", from_cost_center: "CC-4250", into_cost_center: "CC-4200", effective_date: D.slack, source_quote: "folding the Data Platform cost center into Data Engineering", confidence: 0.9, notes: "" },
      { id: "c3", type: "move_employee", employee: "E110", new_manager: "E300", to_cost_center: "CC-4300", effective_date: D.slack, source_quote: "[E110] moves from Platform over to ML Infra (reporting to [AMBIG:E300|E530])", confidence: 0.85, notes: "Moving teams implies moving cost center here." },
      { id: "c4", type: "comp_change", employee: "E110", effective_date: D.slack, source_quote: "gets bumped to [COMP_1]", confidence: 0.9, notes: "Amount redacted." } ],
      assumptions: [`${D.slackText} means ${D.slack}.`], questions: ["Does ML Infrastructure keep CC-4300, or do its people and budget move into Data Engineering (CC-4200)?"] } },
  { key: "email", label: "Email · HR business partner",
    text: `Hi all, per our discussion we're splitting Sales West into Sales West – Enterprise (Jordan Lee) and Sales West – SMB (Keiko), effective ${D.emailText}. Jordan keeps Ana and Tom; Keiko keeps Ravi and Mia. Both open reqs go to SMB. Priya stays with Rob for now. Thanks, Morgan Hale (HRBP), morgan.hale@halcyon.io`,
    ref: { summary: "Split Sales West into Enterprise and SMB cost centers.", changes: [
      { id: "c1", type: "create_cost_center", temp_id: "NEW1", name: "Sales West – Enterprise", owner: "E510", split_from: "CC-5200", effective_date: D.email, source_quote: "Sales West – Enterprise ([E510])", confidence: 0.9, notes: "" },
      { id: "c2", type: "create_cost_center", temp_id: "NEW2", name: "Sales West – SMB", owner: "E520", split_from: "CC-5200", effective_date: D.email, source_quote: "Sales West – SMB ([E520])", confidence: 0.9, notes: "" },
      { id: "c3", type: "move_team", team_of: "E510", new_manager: "E500", to_cost_center: "NEW1", effective_date: D.email, source_quote: "[E510] keeps [E511] and [E512]", confidence: 0.85, notes: "Manager unchanged; cost center changes." },
      { id: "c4", type: "move_team", team_of: "E520", new_manager: "E500", to_cost_center: "NEW2", effective_date: D.email, source_quote: "[E520] keeps [E521] and [E522]", confidence: 0.85, notes: "" },
      { id: "c5", type: "transfer_headcount", from_cost_center: "CC-5200", to_cost_center: "NEW2", open_reqs: ["REQ-5201", "REQ-5202"], effective_date: D.email, source_quote: "Both open reqs go to SMB", confidence: 0.8, notes: "" } ],
      assumptions: [`${D.emailText} means ${D.email}.`, "CC-5200 Sales West stays open for E500 and the AMBIG person who 'stays with' E500."], questions: ["Who is [AMBIG:E300|E530] in 'stays with [E500]'? Likely E530 (Sales). No change emitted."] } },
  { key: "doc", label: "Doc · org update draft",
    text: `Org update (draft v3). Starting ${D.docText}, Sam reports directly to the CFO. Chris Dunn moves to Data Engineering under Marcus. Jose Ruiz joins Platform as a new hire in ${D.hireMonth} against the open Platform req.`,
    ref: { summary: "Sam to CFO; Chris Dunn to Data Engineering; a new hire for Platform.", changes: [
      { id: "c1", type: "change_manager", employee: "E611", new_manager: "E060", effective_date: D.doc, source_quote: "[E611] reports directly to the CFO", confidence: 0.8, notes: "CFO resolved by title to E060." },
      { id: "c2", type: "move_employee", employee: "E101", new_manager: "E200", to_cost_center: "CC-4200", effective_date: null, source_quote: "[E101] moves to Data Engineering under [E200]", confidence: 0.8, notes: `No date for this line; 'Starting ${D.docText}' may apply to it.` },
      { id: "c3", type: "other", description: "New hire [UNKNOWN_PERSON_1] joining Platform in ${D.hireMonth} against REQ-4101. Hiring is not a reorg change.", effective_date: null, source_quote: "[UNKNOWN_PERSON_1] joins Platform as a new hire", confidence: 0.6, notes: "" } ],
      assumptions: [], questions: [`Does ${D.docText} also apply to [E101]'s move?`, "Should the new hire be handled here or by recruiting?"] } },
];
}
RCC.makeSamples = makeSamples;
RCC.SAMPLES = makeSamples(RCC.SEED);
})(globalThis.RCC = globalThis.RCC || {});
