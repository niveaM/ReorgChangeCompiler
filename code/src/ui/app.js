// Reorg Change Compiler: page logic.
// Renders each pipeline stage and wires the controls. All decisions are made by the
// engine (src/engine); this file only displays results and records what people do:
// signatures, keying, verification.
(function(){
"use strict";
const E = window.RCC;
// "Today" is the viewer's real date, so the close calendar and sample dates feel current.
// Pin it with ?today=YYYY-MM-DD (or window.RCC_TODAY, which the tests use).
(function pickToday(){
  const q = (String(globalThis.location && globalThis.location.search || "").match(/[?&]today=(\d{4}-\d{2}-\d{2})/) || [])[1];
  const d = new Date();
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  E.rebaseDates(E.SEED, globalThis.RCC_TODAY || q || local);
})();
const S = E.SEED;
const SAMPLES = E.makeSamples(S);
const MC = E.modelClient;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const NAMES = Object.fromEntries(S.hris.employees.map((e) => [e.id, e.name]));
// The operator is an authorised human, so the page shows names next to IDs. The model never gets them.
const nm = (s) => esc(s).replace(/\bE\d{3}\b/g, (id) => NAMES[id] ? `${NAMES[id]} <span class="mono">${id}</span>` : id);


// Demo people, pre-filled so a reviewer can click straight through. All distinct, so segregation of duties holds.
const DEMO = { G1: "Morgan Hale (HRBP)", G2: "Felix Ward (FP&A)", G3: "Hannah Brooks (Controller)", keyer: "Ken Ito (Finance Ops)", verifier: "Vera Lind (Finance Ops)" };
const gl = (id) => /^G\d$/.test(id) ? "Gate-" + id.slice(1) : id;

const st = { sampleKey: "slack", cs: null, csHash: null, v: null, plan: null, sigs: {}, sys: null, expected: null, done: {}, keyed: {}, tickets: {}, stale: null, recon: null, ctl: null };

// ------------------------------------------------ calendar
(function cal(){
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const [y, m, td] = S.asOf.split("-").map(Number), last = Number(S.fiscal.openPeriodEnd.slice(8)), lk = Number(S.fiscal.lockdownFrom.slice(8));
  const mon = MONTHS[m - 1];
  $("mToday").textContent = S.asOf; $("mPeriod").textContent = `${mon.slice(0, 3)} ${y}`; $("mLock").textContent = `${mon.slice(0, 3)} ${lk}`;
  $("calLabel").textContent = `${mon} ${y}`;
  $("cal").setAttribute("aria-label", `${mon} ${y}: today is ${mon} ${td}; the GL lockdown runs ${mon} ${lk} to ${last}`);
  let h = ""; for (let d = 1; d <= last; d++) { const iso = `${S.asOf.slice(0, 8)}${String(d).padStart(2,"0")}`; const cls = [iso >= S.fiscal.lockdownFrom ? "lock" : "", iso === S.asOf ? "today" : ""].join(" "); h += `<span class="${cls}" title="${iso}${iso >= S.fiscal.lockdownFrom ? " · lockdown" : ""}">${d}</span>`; }
  $("cal").innerHTML = h;
})();

// ------------------------------------------------ intake + PII redaction
function renderSamples(){
  $("samples").innerHTML = SAMPLES.map((s) => `<button class="chip" aria-pressed="${s.key === st.sampleKey}" data-k="${s.key}">${esc(s.label)}</button>`).join("");
  $("samples").querySelectorAll("button").forEach((b) => b.onclick = () => { st.sampleKey = b.dataset.k; $("intake").value = SAMPLES.find((s) => s.key === b.dataset.k).text; renderSamples(); onIntake(); clearCase(); });
}
function hl(text){
  return esc(text).replace(/\[(AMBIG:[^\]]+|UNKNOWN_PERSON_\d+|COMP_\d+|EMAIL_\d+|PHONE_\d+|GOVID_\d+|E\d{3})\]/g, (m, t) => {
    const cls = t.startsWith("AMBIG") ? "amb" : t.startsWith("UNKNOWN") ? "unk" : /^E\d/.test(t) ? "" : "pii";
    return `<span class="tok ${cls}">[${t}]</span>`;
  });
}
let shielded = null;
function onIntake(){
  shielded = E.shield($("intake").value, S);
  $("redacted").innerHTML = hl(shielded.redacted) || '<span class="note">Nothing to shield.</span>';
  const kinds = {}; shielded.vault.forEach((v) => (kinds[v.kind] = (kinds[v.kind] || 0) + 1));
  const lines = [["name","People replaced by ID or flag"],["compensation","Pay amounts"],["email","Email addresses"],["phone","Phone numbers"],["government_id","Government IDs"]];
  $("vault").innerHTML = lines.map(([k, l]) => `<div><span>${l}</span><span class="mono">${kinds[k] || 0}</span></div>`).join("") +
    `<div><span>Ambiguous first names</span><span class="mono">${new Set(shielded.vault.filter((v)=>v.token.startsWith("[AMBIG")).map((v)=>v.token)).size}</span></div>` +
    `<div><span>People not in the directory</span><span class="mono">${shielded.vault.filter((v)=>v.token.startsWith("[UNKNOWN")).length}</span></div>`;
  $("prompt").textContent = E.extractionPrompt(shielded.redacted, S);
  $("st2").classList.add("live");
}
$("intake").addEventListener("input", () => { st.sampleKey = null; renderSamples(); onIntake(); });

// A new case starts clean: no change set, no signatures, no run, no reconciliation.
function clearCase(){
  if (st.ctl) st.ctl.abort();
  $("cs").value = ""; st.csHash = null; resetRun();
  ["runStatus", "reconStatus"].forEach((id) => { $(id).textContent = ""; });
  if (typeof onCS === "function") onCS();
  if (mcReady) showModelStatus();
}

// ------------------------------------------------ extraction
let mcReady = false;
function showModelStatus(){
  const s = MC.status();
  $("btnExtract").disabled = s.source === "none";
  $("btnExtract").textContent = s.source === "api" ? "Extract with Claude (API)" : "Extract with Claude";
  $("apiBox").hidden = s.source === "viewer";
  $("exStatus").className = "status";
  $("exStatus").textContent = s.source === "viewer" ? "Ready. The first extraction asks you to allow this page to use Claude; it usually takes 20–60 seconds."
    : s.source === "api" ? `Ready: ${s.label}. Calls go directly from this page to api.anthropic.com.`
    : "No model connected. Add an API key below, open the published page in Claude, or use “Load hand-written reading”.";
}
$("exStatus").textContent = "Connecting to Claude…";
MC.init().then(() => { mcReady = true; showModelStatus(); });
$("apiModel").placeholder = MC.DEFAULT_MODEL;
$("btnApiKey").onclick = () => { MC.setApiKey($("apiKey").value, $("apiModel").value); showModelStatus(); };
$("btnExtract").onclick = async () => {
  if (!mcReady) { $("exStatus").textContent = "Still connecting — try again in a moment."; return; }
  st.ctl = new AbortController();
  const t0 = Date.now(); let chars = 0;
  const secs = () => Math.round((Date.now() - t0) / 1000);
  const tick = setInterval(() => { $("exStatus").textContent = chars ? `Writing the change set… ${chars} chars · ${secs()}s` : `Waiting for Claude (approve the prompt if one appears)… ${secs()}s`; }, 500);
  $("btnExtract").disabled = true; $("btnStop").hidden = false; $("exStatus").className = "status";
  let fatal = false;
  try {
    const out = await MC.extract(E.extractionPrompt(shielded.redacted, S), { signal: st.ctl.signal, onText: (n) => { chars = n; } });
    setCS(out, `Extracted by Claude in ${secs()}s. Review every change before signing Gate-1.`);
  } catch (e) {
    const code = (e && e.code) || "unknown";
    fatal = ["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "no_model"].includes(code);
    $("exStatus").className = code === "cancelled" ? "status" : "status err";
    const msg = ({ cancelled: "Stopped.", not_granted: "Claude access was declined for this page. Reload to be asked again, or use the hand-written reading.", sampling_disabled: "Claude isn't enabled for this account here. Use the hand-written reading.", rate_limited: "Usage limit or too many requests. Try again in a minute.", invalid_json: "Claude's reply wasn't usable JSON. Try again.", refused: "Claude declined this input. Rephrase it.", prompt_too_large: "The message is too long. Shorten it.", bad_key: "The API key was rejected.", bad_model: "That model name wasn't found. Clear the model field to use the default.", network: "Couldn't reach the API from this page." })[code] || "Extraction failed. Try again.";
    $("exStatus").textContent = `${msg} (${code}${e && e.message ? ": " + e.message : ""})`;
  } finally {
    clearInterval(tick);
    $("btnExtract").disabled = fatal || MC.status().source === "none";
    $("btnStop").hidden = true;
  }
};
$("btnStop").onclick = () => st.ctl && st.ctl.abort();
$("findings").addEventListener("click", (ev) => {
  if (!st.cs) return;
  const drop = ev.target.closest("button[data-drop]");
  if (drop) {
    const id = drop.dataset.drop; const cs = E.clone(st.cs);
    cs.changes = cs.changes.filter((c) => c.id !== id);
    const to = drop.dataset.route;
    setCS(cs, `Removed ${id} from the change set${to ? ` and routed it to the ${to} process` : ""}. That's an edit, so any signatures are void.`);
    return;
  }
  const setDate = ev.target.closest("button[data-setdate]");
  if (setDate) {
    const id = setDate.dataset.setdate, input = document.getElementById("date-" + id);
    const d = input && input.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) { input && input.focus(); return; }
    const cs = E.clone(st.cs); const c = cs.changes.find((x) => x.id === id); if (!c) return;
    c.effective_date = d;
    setCS(cs, `Set the effective date of ${id} to ${d}. That's an edit, so any signatures are void.`);
    return;
  }
  const pick = ev.target.closest("button[data-pick]");
  if (pick) {
    const [id, field, emp] = pick.dataset.pick.split("|");
    const cs = E.clone(st.cs); const c = cs.changes.find((x) => x.id === id); if (!c) return;
    c[field] = emp;
    setCS(cs, `Resolved ${field} of ${id} to ${NAMES[emp] || ""} ${emp}. That's an edit, so any signatures are void.`);
  }
});

// How to resolve each blocker, in words, plus an inline fix where one is safe to offer.
const HOW = {
  EMPTY: "Extract again, or load the hand-written reading, so there is at least one change.",
  CC_NO_NAME: "Add a name to this new cost center in the change set (Extract step).",
  CC_NO_OWNER: "Add the owner's employee ID to this new cost center in the change set (Extract step).",
  MISSING_EMP: "Add the employee ID this change is about, in the change set (Extract step).",
  UNKNOWN_EMP: "Check the ID against the directory and correct it in the change set (Extract step).",
  UNKNOWN_MGR: "Check the new manager's ID and correct it in the change set (Extract step).",
  SELF_MGR: "Pick a different manager for this person.",
  UNKNOWN_CC: "Check the code against the existing cost centers. Only if it's genuinely new, add a create_cost_center change for it.",
  NOOP_MOVE: "Add the new manager or the new cost center, or remove the change if nothing moves.",
  CYCLE: "Pick a manager outside this team, or move the team leader as well, so nobody ends up reporting to themselves.",
  UNKNOWN_REQ: "Use an open req that belongs to the source cost center, or remove it from the transfer.",
  COMP_OUT_OF_BAND: "Pay changes go through the comp process. Route it there and take it out of this change set.",
  UNSTRUCTURED: "Restate it as a supported change in the change set, or remove it if it doesn't belong here.",
  BAD_TYPE: "Use a supported type: move_team, move_employee, change_manager, create_cost_center, merge_cost_centers, transfer_headcount, close_cost_center.",
  CC_EXISTS: "Point the change at the existing cost center code and remove the create_cost_center line. New cost centers are only for ones that don't exist yet.",
  CONFLICT: "Combine these into one change, or remove the one that's wrong.",
  CLOSE_NONEMPTY: "Move the remaining people out first, or keep this cost center open.",
  UNRESOLVED_PERSON: "Say which person the message means.",
  NO_DATE: "Enter the effective date, or ask the requester. Nothing moves without one.",
  BAD_DATE: "Enter the effective date as a real calendar date.",
  CLOSED_PERIOD: `Move the date into the open period (on or after ${S.fiscal.openFrom}), or send it to the Controller as a retro adjustment.`,
};
function fixFor(f){
  if (f.sev === "approval" && f.code === "OPEN_QUESTION") return `<div class="fix"><b>Who decides:</b> the requester answers this at Gate-1. If the answer changes the reading, edit the change set in the Extract step.</div>`;
  if (f.sev !== "blocker") return "";
  const c = f.ref && st.cs && Array.isArray(st.cs.changes) ? st.cs.changes.find((x) => x.id === f.ref) : null;
  const text = c ? [c.description, c.source_quote, c.notes].filter(Boolean).join(" ") : "";
  const route = /\b(new hire|hire[ds]?|hiring|joins|joining|onboard\w*)\b/i.test(text) ? "hiring"
    : /\b(terminat\w*|leaving|last day|offboard\w*|resign\w*)\b/i.test(text) ? "offboarding" : null;
  const removeBtn = (cid) => route ? `<button class="chip" data-drop="${cid}" data-route="${route}">Route to ${route} process (remove from this change set)</button>`
    : `<button class="chip" data-drop="${cid}">Remove from this change set</button>`;
  const unknownOnly = f.code === "UNRESOLVED_PERSON" && c && !Object.entries(c).some(([k, v]) => typeof v === "string" && !["source_quote", "notes"].includes(k) && /AMBIG/.test(v));
  const how = route && ["UNSTRUCTURED", "UNRESOLVED_PERSON"].includes(f.code)
    ? (route === "hiring" ? "New hires aren't a reorg change. They go through the hiring process, so route it there and take it out of this change set."
                          : "Departures aren't a reorg change. They go through the offboarding process, so route it there and take it out of this change set.")
    : unknownOnly ? "This names someone who isn't in the directory. Put their employee ID in the change set, or remove the change." : HOW[f.code];
  let h = how ? `<div class="fix"><b>To fix:</b> ${esc(how)}` : `<div class="fix">`;
  if (c && ["NO_DATE", "BAD_DATE", "CLOSED_PERIOD"].includes(f.code)) h += ` <span class="note">(${esc(c.id)}: ${describe(c)})</span>`;
  const id = c ? esc(c.id) : "";
  if (c && ["NO_DATE", "BAD_DATE", "CLOSED_PERIOD"].includes(f.code))
    h += ` <span class="fixrow"><label class="sr" for="date-${id}">Effective date for ${id}</label><input type="date" id="date-${id}" min="${S.fiscal.openFrom}" value="${/^\d{4}-\d{2}-\d{2}$/.test(c.effective_date || "") && f.code !== "CLOSED_PERIOD" ? esc(c.effective_date) : ""}"><button class="chip" data-setdate="${id}">Set date</button></span>`;
  if (c && f.code === "UNRESOLVED_PERSON") {
    for (const [k, v] of Object.entries(c)) {
      if (typeof v !== "string" || ["source_quote", "notes"].includes(k)) continue;
      const m = v.match(/AMBIG:([E\d|]+)/);
      if (m) h += ` <span class="fixrow">${esc(k)}:` + m[1].split("|").map((emp) => {
        const e = S.hris.employees.find((x) => x.id === emp) || {};
        return ` <button class="chip" data-pick="${id}|${esc(k)}|${esc(emp)}">${esc(e.name || emp)} · ${esc(e.title || "")} · ${esc(e.cc || "")}</button>`;
      }).join("") + `</span>`;
      else if (/UNKNOWN_PERSON/.test(v) && !/data-drop/.test(h)) h += " " + removeBtn(id);
    }
  }
  if (c && f.code === "COMP_OUT_OF_BAND") h += ` <button class="chip" data-drop="${id}" data-route="comp">Route to comp process (remove from this change set)</button>`;
  if (c && ["UNSTRUCTURED", "NOOP_MOVE", "CONFLICT"].includes(f.code)) h += " " + removeBtn(id);
  return h + `</div>`;
}
$("btnRef").onclick = () => {
  const s = SAMPLES.find((x) => x.key === st.sampleKey);
  if (!s) { $("exStatus").className = "status err"; $("exStatus").textContent = "Hand-written readings exist only for the three sample messages."; return; }
  setCS(E.clone(s.ref), "Loaded a hand-written reading of this sample (for demos without model access).");
};
function setCS(obj, msg){
  $("cs").value = JSON.stringify(obj, null, 2);
  $("exStatus").className = "status"; $("exStatus").textContent = msg;
  onCS();
}
let csTimer = null;
$("cs").addEventListener("input", () => { clearTimeout(csTimer); csTimer = setTimeout(onCS, 250); });

// Change-set fingerprint: SHA-256, the same hash the signatures and tickets use.
function hash(s){ return E.sha256(s).slice(0, 16); }

function onCS(){
  const raw = $("cs").value.trim();
  let obj = null;
  try { obj = raw ? JSON.parse(raw) : null; } catch (e) { $("csReadable").innerHTML = `<span class="status err">The JSON doesn't parse: ${esc(e.message)}</span>`; st.v = null; renderAll(); return; }
  st.cs = obj;
  const h = hash(JSON.stringify(obj));
  if (h !== st.csHash) { if (Object.keys(st.sigs).length) $("exStatus").textContent = "The change set changed, so all approvals were voided."; resetRun(); }
  st.csHash = h;
  st.v = obj ? E.validate(obj, S) : null;
  st.plan = st.v && st.v.ok ? E.compile(obj, st.v, S) : null;
  $("st3").classList.add("live");
  renderReadable(); renderAll();
}

function describe(c){
  const cc = (x) => x ? `<span class="mono">${esc(x)}</span>` : "—";
  switch (c.type) {
    case "move_team": return `${nm(c.team_of)} and their team report to ${nm(c.new_manager)}${c.to_cost_center ? `, cost center → ${cc(c.to_cost_center)}` : ", cost center unchanged"}`;
    case "move_employee": return `${nm(c.employee)}${c.new_manager ? ` reports to ${nm(c.new_manager)}` : ""}${c.to_cost_center ? `, cost center → ${cc(c.to_cost_center)}` : ""}`;
    case "change_manager": return `${nm(c.employee)} reports to ${nm(c.new_manager)}`;
    case "create_cost_center": return `New cost center “${esc(c.name)}” (${esc(c.temp_id)}), owner ${nm(c.owner)}${c.split_from ? `, split from ${cc(c.split_from)}` : ""}`;
    case "merge_cost_centers": return `Merge ${cc(c.from_cost_center)} into ${cc(c.into_cost_center)}`;
    case "transfer_headcount": return `Move ${c.count != null ? c.count + " HC" : ""}${(c.open_reqs||[]).length ? " reqs " + c.open_reqs.map(esc).join(", ") : ""} from ${cc(c.from_cost_center)} to ${cc(c.to_cost_center)}`;
    case "close_cost_center": case "retire_cost_center": return `Close ${cc(c.cost_center)} to new postings (kept for reporting)`;
    case "comp_change": return `Pay change for ${nm(c.employee)} (amount withheld)`;
    default: return esc(c.description || c.source_quote || c.type);
  }
}
function renderReadable(){
  const c = st.cs;
  if (!c || !Array.isArray(c.changes)) { $("csReadable").innerHTML = '<span class="note">No change set yet.</span>'; return; }
  $("csReadable").innerHTML =
    (c.summary ? `<p style="margin:0 0 8px">${nm(c.summary)}</p>` : "") +
    `<table><tbody>${c.changes.map((x) => `<tr><td class="mono">${esc(x.id)}</td><td>${describe(x)}<div class="note">${esc(x.effective_date || "no date")} · confidence ${x.confidence ?? "?"}${x.notes ? " · " + nm(x.notes) : ""}</div></td></tr>`).join("")}</tbody></table>` +
    ((c.assumptions||[]).length ? `<p class="label" style="margin-top:10px">Assumptions</p><ul style="margin:0;padding-left:18px">${c.assumptions.map((a) => `<li>${nm(a)}</li>`).join("")}</ul>` : "") +
    ((c.questions||[]).length ? `<p class="label" style="margin-top:10px">Questions for the requester</p><ul style="margin:0;padding-left:18px">${c.questions.map((a) => `<li>${hl(a).replace(/\bE\d{3}\b/g, (id)=>NAMES[id]?`${NAMES[id]} <span class="mono">${id}</span>`:id)}</li>`).join("")}</ul>` : "");
}

// ------------------------------------------------ validation render
const SEV = { blocker: "Blocker", approval: "Approval", warning: "Warning", info: "Note" };
function renderValidation(){
  const v = st.v;
  $("st4").classList.toggle("live", !!v);
  if (!v) { $("tally").innerHTML = ""; $("findings").innerHTML = '<p class="note">Validation runs once there is a change set.</p>'; $("hc").innerHTML = ""; return; }
  const n = (s) => v.findings.filter((f) => f.sev === s).length;
  $("tally").innerHTML = `<span>Blockers <b>${n("blocker")}</b></span><span>For approval <b>${n("approval")}</b></span><span>Warnings <b>${n("warning")}</b></span><span>Notes <b>${n("info")}</b></span><span>Derived steps <b>${v.derived.length}</b></span><span>People whose cost center changes <b>${v.ccMoves.length}</b></span>`;
  const order = { blocker: 0, approval: 1, warning: 2, info: 3 };
  $("findings").innerHTML = [...v.findings].sort((a, b) => order[a.sev] - order[b.sev]).map((f) =>
    `<div class="f ${f.sev}"><div class="sev">${SEV[f.sev]}</div><div>${nm(f.msg).replace(/\[(AMBIG:[^\]]+|UNKNOWN_PERSON_\d+)\]/g,'<span class="tok amb">[$1]</span>')}<span class="code">${f.code}${f.ref ? " · " + esc(f.ref) : ""}</span>${fixFor(f)}</div></div>`).join("") +
    (v.derived.length ? `<details><summary>Derived work the message didn't mention (${v.derived.length})</summary><ul style="margin:6px 0 0;padding-left:18px">${v.derived.map((d) => `<li><span class="mono">${esc(d.type)}</span> ${esc(d.from_cost_center || d.cost_center || "")}${d.to_cost_center ? " → " + esc(d.to_cost_center) : ""}${d.count != null ? ` · ${d.count} HC` : ""} <span class="note">because ${esc(d.because)}</span></li>`).join("")}</ul></details>` : "");
  const name = (code) => (st.v.target.ccs[code] || {}).name || "";
  $("hc").innerHTML = `<thead><tr><th>Cost center</th><th class="n">People before</th><th class="n">After</th><th class="n">Open reqs</th><th class="n">Approved HC after</th><th class="n">Loaded cost Δ $k/yr</th></tr></thead><tbody>` +
    v.hcTable.filter((r) => r.before !== r.after || r.costDeltaK || r.approvedAfter !== (S.planning[r.cc] || {}).approvedHC).map((r) => {
      const over = !r.closing && (r.after + (r.openReqs || 0)) > r.approvedAfter;
      return `<tr><td><span class="mono">${esc(r.cc)}</span> ${esc(name(r.cc))}${r.closing ? ' <span class="pill">closing</span>' : ""}</td><td class="n">${r.before}</td><td class="n">${r.after}</td><td class="n">${r.openReqs ?? "—"}</td><td class="n ${over ? "neg" : ""}">${r.approvedAfter}${over ? " ▲" : ""}</td><td class="n ${r.costDeltaK < 0 ? "neg" : r.costDeltaK > 0 ? "pos" : ""}">${r.costDeltaK > 0 ? "+" : ""}${r.costDeltaK}</td></tr>`;
    }).join("") + `</tbody>`;
}

// ------------------------------------------------ gates
function renderGates(){
  const v = st.v;
  const ready = v && v.ok;
  $("st5").classList.toggle("live", !!ready); $("st5").classList.toggle("locked", !ready);
  if (!v) { $("gates").innerHTML = '<p class="note">Gates appear once there is a change set.</p>'; return; }
  $("gates").innerHTML = v.gates.map((g) => {
    const sig = st.sigs[g.id];
    const prev = g.id === "G1" ? true : !!st.sigs.G1;
    const can = ready && prev && !sig;
    return `<div class="gatecard ${sig ? "signed" : ""}"><h3><span class="gid">${gl(g.id)}</span>${esc(g.who)}</h3><p>${esc(g.what)}</p><p><i>Why a person:</i> ${esc(g.why)}</p>` +
      (sig ? `<p class="mono" style="color:var(--ok)">Signed by ${esc(sig.by)}<br>version ${sig.csHash} · ${sig.snap}<br>signature ${sig.sig}</p>` :
        `<div class="row"><input type="text" id="sig-${g.id}" placeholder="Approver name" value="${esc(DEMO[g.id] || "")}" style="flex:1;min-width:140px" ${can ? "" : "disabled"}><button class="gate" data-g="${g.id}" ${can ? "" : "disabled"}>Sign ${gl(g.id)}</button></div>` +
        (!ready ? `<p class="note">Clear the blockers first.</p>` : !prev ? `<p class="note">Waits for Gate-1.</p>` : ""));
  }).join("") + "</div>";
  $("gates").querySelectorAll("button[data-g]").forEach((b) => b.onclick = () => {
    const g = b.dataset.g; const by = ($("sig-" + g).value || "").trim();
    if (!by) { $("sig-" + g).focus(); $("sig-" + g).placeholder = "Enter a name to sign"; return; }
    ensureSys(); const snap = E.snapshotId(st.sys);
    st.sigs[g] = { by, csHash: st.csHash, snap, sig: E.sha256([g, by, st.csHash, snap].join("|")).slice(0, 16) }; renderAll();
  });
}

// ------------------------------------------------ steps
function resetRun(){ st.sigs = {}; st.sys = null; st.expected = null; st.done = {}; st.keyed = {}; st.tickets = {}; st.stale = null; st.recon = null; }
function ensureSys(){ if (!st.sys) { st.sys = E.initSystems(S); st.expected = E.initSystems(S); } }
function stepState(s){
  if (st.done[s.id]) return st.done[s.id];          // done | keyed | fail
  if (st.stale) return "blocked";
  const gatesOk = s.gate.every((g) => st.sigs[g] && st.sigs[g].csHash === st.csHash);
  const depsOk = (s.dependsOn || []).every((d) => st.done[d] === "done");
  if (!gatesOk) return "gated"; if (!depsOk) return "waiting"; return "ready";
}
// Re-validation before every step: the live systems must match what the plan expects.
function driftCheck(stepId){
  ensureSys();
  const live = E.snapshotId(st.sys), want = E.snapshotId(st.expected);
  if (live === want) return true;
  const applied = Object.keys(st.done).length;
  st.stale = { at: stepId, live, want, state: applied ? "PARTIALLY_FAILED" : "SUPERSEDED" };
  return false;
}
function runStep(s, keyed){
  ensureSys();
  if (s.system === "reconcile") { doRecon(); st.done[s.id] = "done"; return true; }
  if (!driftCheck(s.id)) return false;
  E.apply(st.sys, s, keyed); E.apply(st.expected, s, keyed); st.done[s.id] = "done";
  return true;
}
function parseRule(str){
  const rule = {}; let ok = true;
  str.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).forEach((part) => { const m = part.match(/^(.+?)\s*[=:]\s*(\d+(?:\.\d+)?)\s*%?$/); if (m) rule[m[1].trim()] = Number(m[2]); else ok = false; });
  return ok ? rule : null;
}
const fmtRule = (r) => r && typeof r === "object" ? Object.entries(r).map(([k, v]) => `${k}=${v}`).join(", ") : "";
function renderSteps(){
  const p = st.plan;
  $("st6").classList.toggle("locked", !p || !st.sigs.G1); $("st6").classList.toggle("live", !!(p && st.sigs.G1));
  if (!p) { $("steps").innerHTML = `<tbody><tr><td class="note">${st.v ? "The runbook compiles once the blockers are cleared." : "No change set yet."}</td></tr></tbody>`; return; }
  const phaseWhy = Object.fromEntries(E.PHASES.map((x) => [x.n, x.why]));
  let h = `<thead><tr><th>Step</th><th>System</th><th>Action</th><th>Gates</th><th>Status</th><th></th></tr></thead><tbody>`;
  let lastPhase = 0;
  for (const s of p.steps) {
    if (s.phase !== lastPhase) { lastPhase = s.phase; h += `<tr><td colspan="6" class="phase-h"><b>Phase ${s.phase}</b> · ${esc(phaseWhy[s.phase] || "Check every system against the approved target.")}</td></tr>`; }
    const state = stepState(s);
    const sysLabel = s.system === "reconcile" ? "All systems" : E.SYSTEMS[s.system].label;
    const tk = st.tickets[s.id];
    const pill = { done: '<span class="pill done">Done</span>', fail: '<span class="pill fail">Failed verification</span>', keyed: '<span class="pill keyed">Waiting on human · verify</span>', blocked: '<span class="pill fail">Blocked: stale plan</span>', gated: '<span class="pill wait">Needs sign-off</span>', waiting: '<span class="pill wait">Waiting on earlier phase</span>', ready: '<span class="pill ready">Ready</span>' }[state];
    let btn = "";
    if (state === "ready" && s.mode === "api") btn = `<button data-run="${s.id}">Run</button>`;
    if (state === "ready" && s.mode === "manual") btn = `<button class="gate" data-key="${s.id}">${tk ? "Open ticket" : "Issue ticket"}</button>`;
    if (state === "keyed") btn = `<button class="gate" data-verify="${s.id}">Verify (second person)</button>`;
    if (state === "fail" && s.mode === "manual") btn = `<button data-rekey="${s.id}">Re-key (new ticket)</button>`;
    h += `<tr><td class="mono">${s.id}</td><td>${esc(sysLabel)} <span class="pill ${s.mode}">${s.mode === "manual" ? "keyed by hand" : "API"}</span></td><td class="act">${nm(s.action)}${s.note ? `<div class="note">${esc(s.note)}</div>` : ""}${st.keyed[s.id] ? `<div class="note mono">Keyed: ${esc(st.keyed[s.id].cc)} ${esc(fmtRule(st.keyed[s.id].rule) || (st.keyed[s.id].end ? "rule ends " + st.keyed[s.id].end : ""))}</div>` : ""}${tk ? `<div class="note mono">Ticket ${esc(tk.ticket_id)} · ${esc(tk.state)} · hash ${tk.payload_hash.slice(0, 12)}…</div>` : ""}${tk && tk.result && !tk.result.ok ? `<div class="note" style="color:var(--block)">${tk.result.mismatches.map(esc).join(" ")}</div>` : ""}<div id="ks-${s.id}"></div></td><td class="mono">${s.gate.map(gl).join(" ") || "—"}</td><td>${pill}</td><td>${btn}</td></tr>`;
  }
  $("steps").innerHTML = h + "</tbody>";
  $("steps").querySelectorAll("button[data-run]").forEach((b) => b.onclick = () => { runStep(p.steps.find((x) => x.id === b.dataset.run)); renderAll(); });
  $("steps").querySelectorAll("button[data-key]").forEach((b) => b.onclick = () => openKeySheet(p.steps.find((x) => x.id === b.dataset.key)));
  $("steps").querySelectorAll("button[data-verify]").forEach((b) => b.onclick = () => openVerify(p.steps.find((x) => x.id === b.dataset.verify)));
  $("steps").querySelectorAll("button[data-rekey]").forEach((b) => b.onclick = () => { const id = b.dataset.rekey; delete st.done[id]; delete st.tickets[id]; delete st.keyed[id]; renderAll(); });
  const ready = p.steps.filter((s) => stepState(s) === "ready" && s.mode === "api" && s.system !== "reconcile").length;
  const total = p.steps.length, done = Object.keys(st.done).length;
  $("btnRunReady").disabled = !ready;
  $("btnDrift").disabled = !st.sys || !!st.stale;
  const sb = $("staleBanner");
  if (st.stale) {
    sb.hidden = false;
    sb.innerHTML = `<div class="stale"><div><b>Stopped before ${esc(st.stale.at)}: the systems changed outside this plan.</b> Live state <span class="mono">${st.stale.live}</span> no longer matches the expected <span class="mono">${st.stale.want}</span>. Change state: <b>${st.stale.state}</b>. A stale plan never runs; it goes back through validation and Gate-1 as a new version.</div><div class="row"><button id="btnReplan">Void signatures and re-plan</button><span class="note">In production this re-validates against the live systems. Here it discards the simulated edit, since the simulation validates against the seed.</span></div></div>`;
    $("btnReplan").onclick = () => { resetRun(); renderAll(); };
  } else { sb.hidden = true; sb.innerHTML = ""; }
  $("runStatus").textContent = `${done} of ${total} steps done${ready ? ` · ${ready} ready` : ""}${p.steps.some((s) => stepState(s) === "ready" && s.mode === "manual") ? " · a keying sheet is waiting" : ""}`;
}
function signers(){ return Object.values(st.sigs).map((x) => x.by.trim().toLowerCase()); }
function ticketTable(t){
  return `<div class="ticket"><div><b>${esc(t.ticket_id)}</b> · ${esc(t.target_system)} · role ${esc(t.operator_role)}</div><div>snapshot ${esc(t.snapshot_id)} · payload_hash ${esc(t.payload_hash)}</div>
    <div class="scroll"><table><thead><tr><th>Entity</th><th>Field</th><th>Old</th><th>New</th></tr></thead><tbody>${t.instructions.map((i) => `<tr><td>${esc(i.entity_id)}</td><td>${esc(i.field)}</td><td>${esc(i.old_value == null ? "—" : i.old_value)}</td><td><b>${esc(i.new_value)}</b></td></tr>`).join("")}</tbody></table></div></div>`;
}
function openKeySheet(s){
  ensureSys();
  const box = $("ks-" + s.id);
  const endDate = s.expect.end;
  let t = st.tickets[s.id];
  if (t && !E.ticketCurrent(t, E.snapshotId(st.sys))) { t.state = "STALE_SNAPSHOT"; }
  if (!t || t.state === "STALE_SNAPSHOT") {
    const old = t; t = E.makeTicket(s, st.sys, E.snapshotId(st.sys)); st.tickets[s.id] = t;
    if (old) t.reissuedFrom = old.payload_hash.slice(0, 12);
  }
  box.innerHTML = `<div class="keysheet">${ticketTable(t)}${t.reissuedFrom ? `<div class="note">Reissued: the earlier ticket (${t.reissuedFrom}…) went STALE_SNAPSHOT because the systems changed after it was cut.</div>` : ""}
    <div class="note">Key exactly these values into Admin › Allocation Rules in the legacy engine, then record what you entered. A confirmation click alone is not accepted.</div>
    <div class="row"><label for="kby-${s.id}">Keying operator</label><input type="text" id="kby-${s.id}" placeholder="Your name (not an approver)" value="${esc(DEMO.keyer)}" style="max-width:220px"></div>
    <div class="row"><label for="kcc-${s.id}">Cost center keyed</label><input type="text" id="kcc-${s.id}" value="${esc(s.expect.cc)}" placeholder="${esc(s.expect.cc)}" style="max-width:140px"></div>
    ${endDate ? `<div class="note">${esc(s.expect.cc)} is closing, so its allocation rule must stop on ${esc(endDate)}. Don't delete the rule: past periods still use it.</div><label class="note"><input type="checkbox" id="krm-${s.id}"> I set the end date of ${esc(s.expect.cc)}'s allocation rule to ${esc(endDate)} in the legacy engine</label>` : `<div class="row"><label for="kr-${s.id}">Targets keyed</label><input type="text" id="kr-${s.id}" value="${esc(fmtRule(s.expect.rule) || "")}" placeholder="${esc(fmtRule(s.expect.rule) || "Product A=50, Product B=50")}" style="flex:1;min-width:200px"></div>`}
    <div class="row"><button class="primary" id="kgo-${s.id}">Record what I keyed</button><span class="status err" id="kerr-${s.id}"></span></div></div>`;
  $("kgo-" + s.id).onclick = () => {
    const err = (m) => { $("kerr-" + s.id).textContent = m; };
    const by = $("kby-" + s.id).value.trim();
    if (!by) return err("Enter the keying operator's name.");
    if (signers().includes(by.toLowerCase())) return err("The keyer can't be someone who approved this change.");
    const cc = $("kcc-" + s.id).value.trim();
    if (!cc) return err("Enter the cost center you keyed.");
    let keyed;
    if (endDate) { if (!$("krm-" + s.id).checked) return err(`Set the end date of ${s.expect.cc}'s allocation rule to ${endDate} in the legacy engine, then tick the box to confirm.`); keyed = { cc, end: endDate }; }
    else { const r = parseRule($("kr-" + s.id).value); if (!r || !Object.keys(r).length) return err("Write targets as Name=percent, separated by commas."); keyed = { cc, rule: r }; }
    if (!E.ticketCurrent(t, E.snapshotId(st.sys))) { t.state = "STALE_SNAPSHOT"; renderAll(); return; }
    if (!driftCheck(s.id)) { renderAll(); return; }
    E.apply(st.sys, s, keyed); E.apply(st.expected, s, keyed);
    st.keyed[s.id] = keyed; t.keyedBy = by; t.state = "KEYED_PENDING_VERIFICATION"; st.done[s.id] = "keyed";
    renderAll();
  };
  $("kby-" + s.id).focus();
}
function openVerify(s){
  const t = st.tickets[s.id], box = $("ks-" + s.id);
  box.innerHTML = `<div class="keysheet"><div class="note"><b>Read-back for ${esc(t.ticket_id)}</b>. No rule extract is available from this engine, so a second person checks the keyed values against the ticket. The ERP-side control (all active cost centers sum to 100%) runs either way.</div>
    <div class="row"><label for="vby-${s.id}">Verifier</label><input type="text" id="vby-${s.id}" placeholder="Not the keyer" value="${esc(DEMO.verifier)}" style="max-width:220px"><button class="primary" id="vgo-${s.id}">Run read-back</button><span class="status err" id="verr-${s.id}"></span></div></div>`;
  $("vgo-" + s.id).onclick = () => {
    const by = $("vby-" + s.id).value.trim();
    if (!by) { $("verr-" + s.id).textContent = "Enter the verifier's name."; return; }
    if (by.toLowerCase() === (t.keyedBy || "").toLowerCase()) { $("verr-" + s.id).textContent = "The verifier can't be the person who keyed it."; return; }
    const r = E.verifyTicket(t, st.keyed[s.id], st.sys);
    t.result = r; t.verifiedBy = by;
    t.state = r.ok ? "COMPLETED" : "FAILED_VERIFICATION";
    st.done[s.id] = r.ok ? "done" : "fail";
    renderAll();
  };
  $("vby-" + s.id).focus();
}
$("btnRunReady").onclick = () => {
  let guard = 0, ran = 0;
  while (guard++ < 200) {
    const next = st.plan.steps.find((s) => stepState(s) === "ready" && s.mode === "api" && s.system !== "reconcile");
    if (!next) break; if (!runStep(next)) break; ran++;
  }
  renderAll(); $("runStatus").textContent = `Ran ${ran} step(s). ` + $("runStatus").textContent;
};

// ------------------------------------------------ reconcile
function doRecon(){ ensureSys(); st.recon = E.reconcile(st.sys, st.v); }
$("btnRecon").onclick = () => { if (!st.v) return; doRecon(); const r = st.plan && st.plan.steps.find((s) => s.system === "reconcile"); renderAll(); };
function renderRecon(){
  const p = st.plan;
  $("btnRecon").disabled = !st.v;
  const remaining = p ? p.steps.filter((s) => s.system !== "reconcile" && !st.done[s.id]).length : 0;
  $("reconStatus").textContent = !p ? "" : remaining ? `${remaining} step(s) not yet run. Reconciling now shows the drift a half-finished reorg leaves behind.` : "All steps run.";
  $("st7").classList.toggle("live", !!st.recon);
  if (!st.recon) { $("recon").innerHTML = ""; $("sysState").innerHTML = ""; return; }
  const fails = st.recon.filter((r) => !r.ok).length;
  $("recon").innerHTML = `<p style="margin:0 0 4px"><b>${fails ? `${fails} check(s) failed.` : "All checks passed."}</b> ${fails ? "Each failure names the system and record to fix. Nothing downstream should report on this period until it is clear." : "The five systems agree with each other and with the approved change set."}</p>` +
    st.recon.map((r) => `<div class="r ${r.ok ? "pass" : "fail"}"><span class="v">${r.ok ? "PASS" : "FAIL"}</span><span class="s">${esc(r.system)}</span><span><b style="font-weight:600">${esc(r.check)}.</b> ${nm(r.detail)}</span></div>`).join("");
  const sys = st.sys;
  const ccRows = Object.entries(sys.erp.costCenters).map(([k, c]) => `<div><span class="mono">${k}</span><span>${esc(c.name)} · ${c.status}${c.remapTo ? " → " + c.remapTo : ""}</span></div>`).join("");
  const plRows = Object.entries(sys.planning).map(([k, p]) => `<div><span class="mono">${k}</span><span class="mono">${p.approvedHC} HC · $${p.budgetK}k · ${p.openReqs.length} req</span></div>`).join("");
  const alRows = Object.entries(sys.allocation).map(([k, r]) => `<div><span class="mono">${k}</span><span class="mono">${esc(fmtRule(r))}${(sys.allocationEnd || {})[k] ? ` · ends ${esc(sys.allocationEnd[k])}` : ""}</span></div>`).join("");
  const rpRows = Object.entries(sys.reporting).map(([k, r]) => `<div><span class="mono">${k}</span><span style="text-align:right">${esc(r)}</span></div>`).join("");
  $("sysState").innerHTML = [["ERP cost centers", ccRows], ["Planning", plRows], ["Allocation engine", alRows], ["BI reporting", rpRows]].map(([t, b]) => `<div class="panel"><p class="label">${t}</p><div class="sys-list">${b}</div></div>`).join("");
}

$("btnDrift").onclick = () => {
  ensureSys();
  const e = st.sys.hris.employees.find((x) => x.id === "E201");
  e.manager = e.manager === "E100" ? "E200" : "E100";   // someone edits the HRIS directly
  $("runStatus").textContent = "Simulated: someone changed E201's manager directly in the HRIS. The next step will notice.";
};
const LIFE = ["CAPTURED", "EXTRACTED", "VALIDATED", "INTERPRETATION_SIGNED", "PLANNED", "APPROVED", "PROPAGATING", "VERIFYING", "COMPLETED"];
function lifecycle(){
  if (!st.cs) return { now: shielded && $("intake").value.trim() ? "CAPTURED" : "CAPTURED" };
  if (!st.v || !st.v.ok) return { now: "EXTRACTED", bad: "VALIDATION_FAILED" };
  if (!st.sigs.G1) return { now: "VALIDATED" };
  const p = st.plan, gates = st.v.gates.map((g) => g.id);
  if (!gates.every((g) => st.sigs[g])) return { now: "PLANNED" };
  if (st.stale) return { now: "PROPAGATING", bad: st.stale.state };
  if (Object.values(st.done).includes("fail")) return { now: "PROPAGATING", bad: "PARTIALLY_FAILED" };
  const work = p.steps.filter((s) => s.system !== "reconcile");
  if (!work.some((s) => st.done[s.id])) return { now: "APPROVED" };
  if (!work.every((s) => st.done[s.id] === "done")) return { now: "PROPAGATING", sub: Object.values(st.done).includes("keyed") ? "WAITING_ON_HUMAN" : null };
  if (!st.recon) return { now: "VERIFYING" };
  return st.recon.every((r) => r.ok) ? { now: "COMPLETED" } : { now: "VERIFYING", bad: "DRIFT FOUND" };
}
function renderLife(){
  const L = lifecycle(); const i = LIFE.indexOf(L.now);
  $("life").innerHTML = LIFE.map((x, k) => `<span class="${k < i ? "past" : k === i ? (L.bad ? "past" : "now") : ""}">${x}</span>`).join("") +
    (L.bad ? `<span class="bad">${esc(L.bad)}</span>` : "") + (L.sub ? `<span class="now">${L.sub}</span>` : "");
}
// ------------------------------------------------ horizontal flow: one step on screen at a time
const FLOW = [["st1","Intake"],["st2","PII redaction"],["st3","Extract"],["st4","Validate"],["st5","Approve"],["st6","Propagate"],["st7","Reconcile"]];
let current = "st1";
function flowState(id){
  const v = st.v, p = st.plan;
  switch (id) {
    case "st1": return $("intake").value.trim() ? ["done", "Message in"] : ["todo", "Paste a message"];
    case "st2": return shielded ? ["done", `${shielded.vault.length} item(s) held back`] : ["todo", ""];
    case "st3": return st.cs ? ["done", `${(st.cs.changes || []).length} change(s)`] : ["todo", "Extract or load a reading"];
    case "st4": { if (!v) return ["locked", "Needs a change set"]; const b = v.findings.filter((f) => f.sev === "blocker").length; return b ? ["bad", `${b} to fix`] : ["done", "No blockers"]; }
    case "st5": { if (!v || !v.ok) return ["locked", "Clear blockers first"]; const left = v.gates.filter((g) => !st.sigs[g.id]).length; return left ? ["todo", `${left} signature(s) left`] : ["done", "All signed"]; }
    case "st6": { if (!p || !st.sigs.G1) return ["locked", "Needs Gate-1"]; if (st.stale) return ["bad", "Stopped: drift"]; const w = p.steps.filter((s) => s.write); const d = w.filter((s) => st.done[s.id] === "done").length; return d === w.length ? ["done", "All steps done"] : ["todo", `${d} of ${w.length} steps`]; }
    case "st7": { if (!st.recon) return ["todo", "Not run yet"]; const f = st.recon.filter((r) => !r.ok).length; return f ? ["bad", `${f} check(s) failed`] : ["done", "All checks pass"]; }
  }
}
function show(id){
  current = id;
  FLOW.forEach(([s]) => $(s).classList.toggle("on", s === id));
  renderFlow();
  const cur = $("flow").querySelector(".cur");
  if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function renderFlow(){
  $("flow").innerHTML = FLOW.map(([id, label], i) => {
    const [state, detail] = flowState(id);
    return `<button class="step ${state}${id === current ? " cur" : ""}" data-show="${id}" aria-current="${id === current ? "step" : "false"}"><span class="n">${String(i + 1).padStart(2, "0")}</span><span class="t">${label}</span><span class="d">${esc(detail)}</span></button>`;
  }).join("");
}
$("flow").addEventListener("click", (ev) => { const b = ev.target.closest("button[data-show]"); if (b) show(b.dataset.show); });
// Back / next under each step.
FLOW.forEach(([id], i) => {
  const nav = document.createElement("div"); nav.className = "stepnav";
  nav.innerHTML = (i > 0 ? `<button data-go="${FLOW[i - 1][0]}">← ${FLOW[i - 1][1]}</button>` : "<span></span>") +
    (i < FLOW.length - 1 ? `<button class="primary" data-go="${FLOW[i + 1][0]}">${FLOW[i + 1][1]} →</button>` : "");
  nav.addEventListener("click", (ev) => { const b = ev.target.closest("button[data-go]"); if (b) { show(b.dataset.go); window.scrollTo && window.scrollTo({ top: 0, behavior: "smooth" }); } });
  $(id).querySelector(":scope > div:last-child").appendChild(nav);
});
function renderAll(){ renderValidation(); renderGates(); renderSteps(); renderRecon(); renderLife(); renderFlow(); }

// boot
$("intake").value = SAMPLES[0].text; renderSamples(); onIntake(); renderAll(); show("st1");
})();
