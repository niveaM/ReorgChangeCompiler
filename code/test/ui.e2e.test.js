// End-to-end UI test in a headless DOM. Needs the dev dependency jsdom:
//   npm install && npm test
// Skips cleanly if jsdom isn't installed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let JSDOM; try { ({ JSDOM } = require("jsdom")); } catch (_) {}
const ROOT = path.join(__dirname, "../..");

function boot({ viewer } = {}) {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<link[^>]*>/g, ""), { runScripts: "outside-only" });
  const w = dom.window; const errors = [];
  w.addEventListener("error", (e) => errors.push(e.message));
  w.RCC_TODAY = "2026-10-20"; // pin "today" so the tests don't depend on the calendar
  if (viewer) w.claude = { use: () => Promise.resolve(viewer) };
  for (const s of scripts) w.eval(fs.readFileSync(path.join(ROOT, s), "utf8"));
  const d = w.document, $ = (id) => d.getElementById(id);
  const click = (el) => el.dispatchEvent(new w.Event("click", { bubbles: true }));
  return { w, d, $, click, errors };
}
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const life = (d) => [...d.querySelectorAll("#life span")].filter((s) => /now|bad/.test(s.className)).map((s) => s.textContent).join(" ");

test("full run: extract, approve, propagate, key, verify, reconcile", { skip: !JSDOM && "jsdom not installed" }, async () => {
  const fake = async () => ({ text: "" });
  fake.json = async () => ({ changes: [
    { id: "c1", type: "create_cost_center", temp_id: "NEW1", name: "Sales West – Enterprise", owner: "E510", split_from: "CC-5200", effective_date: "2026-11-02", confidence: 0.9 },
    { id: "c3", type: "move_team", team_of: "E510", new_manager: "E500", to_cost_center: "NEW1", effective_date: "2026-11-02", confidence: 0.9 } ] });
  const { d, $, click, errors } = boot({ viewer: fake });
  await tick();
  click($("btnExtract")); await tick();
  assert.match($("exStatus").textContent, /Extracted by Claude/);
  const sign = (g, who) => { const b = d.querySelector(`button[data-g="${g}"]`); if (!b) return; $("sig-" + g).value = who; click(b); };
  sign("G1", "Hana HRBP"); sign("G2", "Felix FPA"); sign("G3", "Cora Controller");
  click($("btnRunReady"));
  const sid = d.querySelector("button[data-key]").dataset.key;
  click(d.querySelector(`button[data-key="${sid}"]`));
  $("kby-" + sid).value = "Cora Controller"; $("kcc-" + sid).value = "CC-5210"; $("kr-" + sid).value = "Sales & Marketing=100";
  click($("kgo-" + sid));
  assert.match($("kerr-" + sid).textContent, /can't be someone who approved/);
  $("kby-" + sid).value = "Ken Keyer"; click($("kgo-" + sid));
  assert.match(life(d), /WAITING_ON_HUMAN/);
  click(d.querySelector(`button[data-verify="${sid}"]`)); $("vby-" + sid).value = "Vera Verifier"; click($("vgo-" + sid));
  click($("btnRunReady")); click($("btnRecon"));
  assert.match(life(d), /COMPLETED/);
  assert.deepEqual(errors, []);
});

test("outside Claude with no key, extraction is off but the pipeline still runs", { skip: !JSDOM && "jsdom not installed" }, async () => {
  const { d, $, click, errors } = boot();
  await tick();
  assert.equal($("btnExtract").disabled, true);
  assert.equal($("apiBox").hidden, false, "the API-key option is offered");
  click(d.querySelector('button[data-k="slack"]')); click($("btnRef"));
  click(d.querySelector("button[data-drop]"));
  assert.match($("tally").textContent, /Blockers 0/);
  assert.deepEqual(errors, []);
});

test("an outside edit stops the run", { skip: !JSDOM && "jsdom not installed" }, async () => {
  const { d, $, click } = boot();
  await tick();
  click(d.querySelector('button[data-k="slack"]')); click($("btnRef")); click(d.querySelector("button[data-drop]"));
  for (const [g, who] of [["G1", "A"], ["G2", "B"], ["G3", "C"]]) { const b = d.querySelector(`button[data-g="${g}"]`); if (b) { $("sig-" + g).value = who; click(b); } }
  click(d.querySelector("button[data-run]"));
  click($("btnDrift")); click($("btnRunReady"));
  assert.match(life(d), /PARTIALLY_FAILED/);
  assert.match($("staleBanner").textContent, /changed outside this plan/);
});

test("every blocker says how to fix it, and a missing date can be entered in place", { skip: !JSDOM && "jsdom not installed" }, async () => {
  const { d, $, click, errors } = boot();
  await tick();
  click(d.querySelector('button[data-k="doc"]')); click($("btnRef"));
  const blockers = [...d.querySelectorAll("#findings .f.blocker")];
  assert.ok(blockers.length > 0);
  for (const b of blockers) assert.match(b.querySelector(".fix").textContent, /To fix:/, "each blocker carries a fix");
  assert.match($("flow").textContent, /Validate.*to fix/);
  $("date-c2").value = "2026-12-01"; click(d.querySelector('button[data-setdate="c2"]'));
  assert.equal(JSON.parse($("cs").value).changes.find((c) => c.id === "c2").effective_date, "2026-12-01");
  click(d.querySelector('button[data-drop="c3"]'));
  assert.match($("tally").textContent, /Blockers 0/);
  assert.match($("flow").textContent, /No blockers/);
  assert.deepEqual(errors, []);
});

test("picking another sample starts a clean case", { skip: !JSDOM && "jsdom not installed" }, async () => {
  const { d, $, click, errors } = boot();
  await tick();
  click(d.querySelector('button[data-k="email"]')); click($("btnRef"));
  click(d.querySelector('button[data-g="G1"]'));
  assert.match($("gates").textContent, /Signed by/);
  click(d.querySelector('button[data-k="doc"]'));
  assert.equal($("cs").value, "");
  assert.doesNotMatch($("gates").textContent, /Signed by/);
  assert.match($("flow").textContent, /Extract or load a reading/);
  assert.deepEqual(errors, []);
});
