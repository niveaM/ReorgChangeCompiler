// Human Queue Adapter, snapshots and hashing.
// SHA-256, canonical JSON, snapshot IDs, keying tickets and second-person read-back for the system with no API.
// Part of the deterministic core: no model calls, no network, no DOM.
// Loads in the browser as a classic script and in Node via src/engine/index.js.
(function (RCC) {
  "use strict";

  // ------------------------------------------------------------ v2 additions
  // SHA-256 (sync, dependency-free) for snapshot IDs and ticket payload hashes.
  function sha256(ascii) {
    const utf8 = unescape(encodeURIComponent(ascii));
    const K = [], H = [];
    let p = 2, n = 0;
    const frac = (x) => ((x - Math.floor(x)) * 4294967296) | 0;
    while (n < 64) { let prime = true; for (let f = 2; f * f <= p; f++) if (p % f === 0) { prime = false; break; } if (prime) { if (n < 8) H[n] = frac(Math.pow(p, 1 / 2)); K[n++] = frac(Math.pow(p, 1 / 3)); } p++; }
    const words = []; const bitLen = utf8.length * 8;
    for (let i = 0; i < utf8.length; i++) words[i >> 2] |= utf8.charCodeAt(i) << (24 - (i % 4) * 8);
    words[utf8.length >> 2] |= 0x80 << (24 - (utf8.length % 4) * 8);
    words[(((utf8.length + 8) >> 6) << 4) + 15] = bitLen;
    const rot = (v, s) => (v >>> s) | (v << (32 - s));
    for (let j = 0; j < words.length; j += 16) {
      const w = []; for (let k = 0; k < 16; k++) w[k] = words[j + k] | 0; const h = H.slice(0);
      for (let i = 0; i < 64; i++) {
        if (i >= 16) { const w15 = w[i - 15], w2 = w[i - 2]; w[i] = (w[i - 16] + (rot(w15, 7) ^ rot(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rot(w2, 17) ^ rot(w2, 19) ^ (w2 >>> 10))) | 0; }
        const t1 = (h[7] + (rot(h[4], 6) ^ rot(h[4], 11) ^ rot(h[4], 25)) + ((h[4] & h[5]) ^ (~h[4] & h[6])) + K[i] + (w[i] | 0)) | 0;
        const t2 = ((rot(h[0], 2) ^ rot(h[0], 13) ^ rot(h[0], 22)) + ((h[0] & h[1]) ^ (h[0] & h[2]) ^ (h[1] & h[2]))) | 0;
        h.unshift((t1 + t2) | 0); h[4] = (h[4] + t1) | 0; h.pop();
      }
      for (let i = 0; i < 8; i++) H[i] = (H[i] + h[i]) | 0;
    }
    return H.map((x) => ("00000000" + (x >>> 0).toString(16)).slice(-8)).join("");
  }
  // Canonical JSON (sorted keys) so the same state always hashes the same.
  function canon(x) {
    if (Array.isArray(x)) return "[" + x.map(canon).join(",") + "]";
    if (x && typeof x === "object") return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + canon(x[k])).join(",") + "}";
    return JSON.stringify(x);
  }
  function snapshotId(sys) { return "snap-" + sha256(canon(sys)).slice(0, 12); }

  // Human Queue Adapter (Gemini spec v2.0, as reconciled in design v2-r2 §3.6)
  function makeTicket(step, sys, snap) {
    const w = step.write; const instructions = [];
    if (w.kind === "alloc.set") {
      const cur = sys.allocation[w.cc] || {};
      const exp = step.expect.rule || {};
      const fields = new Set([...Object.keys(cur), ...Object.keys(exp)]);
      for (const f of fields) instructions.push({ entity_id: w.cc, field: "target." + f, old_value: cur[f] == null ? null : cur[f], new_value: exp[f] == null ? 0 : exp[f] });
      if (!instructions.length) instructions.push({ entity_id: w.cc, field: "rule", old_value: null, new_value: "FP&A to specify" });
    } else if (w.kind === "alloc.end") {
      instructions.push({ entity_id: w.cc, field: "end_date", old_value: null, new_value: w.end });
    }
    const diff = canon(instructions);
    return {
      ticket_id: "HQA-" + String((RCC.SEED && RCC.SEED.asOf) || "").replace(/-/g, "") + "-" + step.id, step_id: step.id, target_system: "cost_allocation_engine", operator_role: "Finance_Operations_Keyer",
      snapshot_id: snap, payload_hash: sha256(snap + "|" + step.id + "|" + diff), instructions, state: "PENDING_KEYING",
      // This engine has no rule extract, so the read-back is a second-person check; with an extract it would come first.
      verification_mode: "READBACK: second-person check (extract, if the engine supports one) + ERP 100% control",
    };
  }
  function fmtRule(r) { return r ? Object.entries(r).map(([k, v]) => `${k}=${v}`).join(", ") : "(none)"; }
  // Ticket still valid only if the snapshot it was cut from is still current.
  function ticketCurrent(ticket, currentSnap) { return ticket.snapshot_id === currentSnap; }
  // Second-person read-back: compare keyed values with the ticket's new values,
  // then run the ERP-side 100% control across all active cost centers.
  function verifyTicket(ticket, keyed, sys) {
    const mismatches = [];
    if (ticket.instructions.length === 1 && ticket.instructions[0].field === "end_date") {
      const ins = ticket.instructions[0];
      if (keyed.cc !== ins.entity_id) mismatches.push(`Keyed cost center ${keyed.cc}, ticket says ${ins.entity_id}.`);
      if (keyed.end !== ins.new_value) mismatches.push(`Rule for ${ins.entity_id} should end on ${ins.new_value}; keyed ${keyed.end || "no end date"}.`);
    } else {
      const cc = ticket.instructions[0].entity_id;
      if (keyed.cc !== cc) mismatches.push(`Keyed cost center ${keyed.cc}, ticket says ${cc}.`);
      for (const ins of ticket.instructions) {
        const f = ins.field.replace(/^target\./, "");
        const got = keyed.rule ? Number(keyed.rule[f] || 0) : null;
        if (got !== Number(ins.new_value)) mismatches.push(`${cc} ${f}: expected ${ins.new_value}, keyed ${got == null ? "nothing" : got}.`);
      }
    }
    const active = Object.entries(sys.erp.costCenters).filter(([, c]) => c.status === "active").map(([k]) => k);
    for (const code of active) {
      const r = sys.allocation[code]; const sum = r ? Object.values(r).reduce((a, b) => a + Number(b || 0), 0) : 0;
      if (r && sum !== 100) mismatches.push(`ERP control: ${code} allocation sums to ${sum}%.`);
    }
    return { ok: mismatches.length === 0, mismatches };
  }

  RCC.sha256 = sha256;
  RCC.canon = canon;
  RCC.snapshotId = snapshotId;
  RCC.makeTicket = makeTicket;
  RCC.ticketCurrent = ticketCurrent;
  RCC.verifyTicket = verifyTicket;
})(globalThis.RCC = globalThis.RCC || {});
