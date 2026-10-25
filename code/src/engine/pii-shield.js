// PII redaction and extraction prompt.
// Runs before any model call: names become employee IDs, pay and contact details become tokens.
// Part of the deterministic core: no model calls, no network, no DOM.
// Loads in the browser as a classic script and in Node via src/engine/index.js.
(function (RCC) {
  "use strict";

  // ------------------------------------------------------------- PII redaction
  // Runs BEFORE the model. The model never sees names, comp, emails, phones.
  // Known people are replaced by their employee ID; first names that match
  // more than one person become an explicit AMBIG token the model must not
  // resolve silently.
  function shield(text, seed) {
    const emps = seed.hris.employees;
    const vault = []; // {token, kind, original}
    let out = text;
    const put = (kind, original, token) => { vault.push({ token, kind, original }); return token; };

    // 1. Compensation-like money amounts and comp words with numbers
    let n = 0;
    out = out.replace(/\$\s?\d[\d,]*(?:\.\d+)?\s?(?:k|K|m|M)?\b|\b\d{2,3}(?:,\d{3})+\b|\b\d{2,3}\s?[kK]\b/g,
      (m) => put("compensation", m, `[COMP_${++n}]`));
    // 2. Emails, phones, SSN-like
    let e = 0;
    out = out.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, (m) => put("email", m, `[EMAIL_${++e}]`));
    let p = 0;
    out = out.replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, (m) => put("phone", m, `[PHONE_${++p}]`));
    let s = 0;
    out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, (m) => put("government_id", m, `[GOVID_${++s}]`));

    // 3. Full names (longest first), possessive-aware
    const byFull = [...emps].sort((a, b) => b.name.length - a.name.length);
    for (const emp of byFull) {
      const re = new RegExp("\\b" + escapeRe(emp.name) + "\\b", "g");
      out = out.replace(re, () => put("name", emp.name, `[${emp.id}]`));
    }
    // 4. Bare first names (only where not already inside a token)
    const firsts = {};
    for (const emp of emps) {
      const f = emp.name.split(" ")[0];
      (firsts[f] = firsts[f] || []).push(emp.id);
    }
    for (const [first, ids] of Object.entries(firsts)) {
      const re = new RegExp("(?<![\\[\\w])" + escapeRe(first) + "\\b(?!\\s+[A-Z][a-z])", "g");
      out = out.replace(re, () => {
        if (ids.length === 1) return put("name", first, `[${ids[0]}]`);
        return put("name", first, `[AMBIG:${ids.join("|")}]`);
      });
    }
    // 5. Remaining capitalized two-word names not in the directory: flag, keep
    //    as UNKNOWN_PERSON so the model can't hallucinate an ID for them.
    let u = 0;
    out = out.replace(/\b([A-Z][a-z]+)\s([A-Z][a-z]{2,})\b/g, (m) => {
      if (/^(Sales|Data|Platform|Finance|Engineering|Product|Infrastructure|West|East|Enterprise|Cost|Center|Machine|Learning|Heads|Effective|Halcyon|The|This|Starting|Please|Team|Also|Budget|Open|Thanks|Best|Hi|Hey|Monday|Tuesday|Wednesday|Thursday|Friday|January|February|March|April|May|June|July|August|September|October|November|December)$/.test(m.split(" ")[0])) return m;
      return put("name", m, `[UNKNOWN_PERSON_${++u}]`);
    });
    return { redacted: out, vault };
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // Roster the model may reference: IDs, titles, CCs, managers. No names, no comp.
  function modelRoster(seed) {
    return {
      employees: seed.hris.employees.filter((e) => e.status === "active")
        .map((e) => ({ id: e.id, title: e.title, manager: e.manager, cost_center: e.cc })),
      cost_centers: Object.entries(seed.erp.costCenters)
        .map(([code, c]) => ({ code, name: c.name, status: c.status, owner: ownerOf(seed, code) })),
    };
  }
  function ownerOf(seed, cc) {
    // The owner is the most senior person in the CC (whose manager is outside it).
    const inCC = seed.hris.employees.filter((e) => e.cc === cc && e.status === "active");
    const top = inCC.find((e) => !inCC.some((o) => o.id === e.manager));
    return top ? top.id : null;
  }

  function extractionPrompt(redacted, seed) {
    return `You turn a freeform reorg announcement into a structured change set for a finance/people-systems pipeline.

RULES
- Reference people ONLY by employee ID from the roster (e.g. "E110"). Names were replaced by IDs before you saw the text.
- A token like [AMBIG:E300|E530] means a first name matched several people. Pick one ONLY if the text gives explicit evidence (team, title, cost center); then set confidence <= 0.7 and explain the evidence in "notes". Otherwise leave the field null and add a question.
- [UNKNOWN_PERSON_n] is someone not in the directory (new hire, contractor, typo). Never assign them an ID. Add a question.
- Roles like "the CFO" may be resolved by title from the roster; say so in notes.
- [COMP_n] tokens are redacted compensation. If the text changes someone's pay, emit a "comp_change" with no amount. Never guess amounts.
- Do not invent changes. Do not fill gaps with assumptions without listing them in "assumptions".
- A change in reporting line does NOT by itself imply a cost-center change. Only set to_cost_center if the text says the person/team moves budget, cost center, or org. If unclear, leave null and ask.
- Dates: ISO YYYY-MM-DD. Today is ${seed.asOf}. If no date is given, use null and ask.
- source_quote: the exact phrase (with tokens) that supports the change.
- confidence: 0..1, how sure you are this change is what the author meant.

CHANGE TYPES (fields not listed must be omitted or null)
- move_employee: employee, new_manager?, to_cost_center?, effective_date
- move_team: team_of (leader ID; leader AND everyone under them move), new_manager (who the leader now reports to), to_cost_center?, effective_date
- change_manager: employee, new_manager, effective_date
- create_cost_center: only for a cost center that does not exist yet (most already do; use the existing code from the roster). temp_id ("NEW1", "NEW2"...), name, owner, split_from?, effective_date. Later changes may use the temp_id as a cost center.
- merge_cost_centers: from_cost_center, into_cost_center, effective_date
- transfer_headcount: from_cost_center, to_cost_center, count?, open_reqs? (array of REQ ids), effective_date
- close_cost_center: cost_center, effective_date. Closes it to new postings; cost centers are never deleted, so history keeps reporting.
- comp_change: employee, effective_date
- other: description (anything that does not fit; it will go to a human)

ROSTER
${JSON.stringify(modelRoster(seed))}

OPEN REQUISITIONS BY COST CENTER
${JSON.stringify(Object.fromEntries(Object.entries(seed.planning).map(([k, v]) => [k, v.openReqs])))}

TEXT
"""
${redacted}
"""

Reply with only JSON of this shape:
{"summary": string, "changes": [{"id": "c1", "type": ..., ...fields, "source_quote": string, "confidence": number, "notes": string}], "assumptions": [string], "questions": [string]}`;
  }

  RCC.shield = shield;
  RCC.modelRoster = modelRoster;
  RCC.extractionPrompt = extractionPrompt;
})(globalThis.RCC = globalThis.RCC || {});
