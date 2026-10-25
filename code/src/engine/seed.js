// Seed data for the simulated systems of record.
// Fictional company "Halcyon": 24 people, 7 cost centers, five systems that drift apart.
// Part of the deterministic core: no model calls, no network, no DOM.
// Loads in the browser as a classic script and in Node via src/engine/index.js.
(function (RCC) {
  "use strict";

  // ---------------------------------------------------------------- seed data
  // Fictional company "Halcyon". Four systems of record that drift apart.
  const SEED = {
    asOf: "2026-10-20",
    fiscal: {
      // Month-end close: periods before openFrom are closed; lockdown is the
      // last 3 business days of the open period, when GL master data is frozen
      // without Controller sign-off.
      openFrom: "2026-10-01",
      openPeriodEnd: "2026-10-31",
      lockdownFrom: "2026-10-28",
    },
    hris: {
      employees: [
        { id: "E000", name: "Noah Kim", title: "CEO", manager: null, cc: "CC-1000", status: "active", comp: 410000 },
        { id: "E001", name: "Alicia Moreno", title: "VP Engineering", manager: "E000", cc: "CC-1000", status: "active", comp: 298000 },
        { id: "E050", name: "Dana Whitfield", title: "Chief Revenue Officer", manager: "E000", cc: "CC-1000", status: "active", comp: 305000 },
        { id: "E060", name: "Grace Adeyemi", title: "Chief Financial Officer", manager: "E000", cc: "CC-1000", status: "active", comp: 312000 },
        { id: "E100", name: "Lena Fischer", title: "Director, Platform Engineering", manager: "E001", cc: "CC-4100", status: "active", comp: 231000 },
        { id: "E101", name: "Chris Dunn", title: "Senior Software Engineer", manager: "E100", cc: "CC-4100", status: "active", comp: 188000 },
        { id: "E110", name: "Dev Okafor", title: "Software Engineer", manager: "E100", cc: "CC-4100", status: "active", comp: 162000 },
        { id: "E200", name: "Marcus Chen", title: "Director, Data Engineering", manager: "E001", cc: "CC-4200", status: "active", comp: 236000 },
        { id: "E201", name: "Ben Cole", title: "Data Engineer", manager: "E200", cc: "CC-4200", status: "active", comp: 171000 },
        { id: "E210", name: "Wei Zhang", title: "Manager, Data Platform", manager: "E200", cc: "CC-4250", status: "active", comp: 204000 },
        { id: "E211", name: "Nina Volkova", title: "Data Platform Engineer", manager: "E210", cc: "CC-4250", status: "active", comp: 176000 },
        { id: "E300", name: "Priya Raman", title: "Manager, ML Infrastructure", manager: "E001", cc: "CC-4300", status: "active", comp: 219000 },
        { id: "E310", name: "Omar Haddad", title: "ML Engineer", manager: "E300", cc: "CC-4300", status: "active", comp: 193000 },
        { id: "E311", name: "Lucy Grant", title: "ML Engineer", manager: "E300", cc: "CC-4300", status: "active", comp: 181000 },
        { id: "E500", name: "Rob Hayes", title: "Director, Sales West", manager: "E050", cc: "CC-5200", status: "active", comp: 214000 },
        { id: "E510", name: "Jordan Lee", title: "Sales Manager", manager: "E500", cc: "CC-5200", status: "active", comp: 178000 },
        { id: "E511", name: "Ana Silva", title: "Account Executive", manager: "E510", cc: "CC-5200", status: "active", comp: 132000 },
        { id: "E512", name: "Tom Becker", title: "Account Executive", manager: "E510", cc: "CC-5200", status: "active", comp: 128000 },
        { id: "E520", name: "Keiko Tanaka", title: "Sales Manager", manager: "E500", cc: "CC-5200", status: "active", comp: 175000 },
        { id: "E521", name: "Ravi Patel", title: "Account Executive", manager: "E520", cc: "CC-5200", status: "active", comp: 126000 },
        { id: "E522", name: "Mia Wong", title: "Account Executive", manager: "E520", cc: "CC-5200", status: "active", comp: 124000 },
        { id: "E530", name: "Priya Shah", title: "Sales Engineer", manager: "E500", cc: "CC-5200", status: "active", comp: 151000 },
        { id: "E610", name: "Hannah Brooks", title: "Controller", manager: "E060", cc: "CC-6100", status: "active", comp: 221000 },
        { id: "E611", name: "Sam Ortiz", title: "Senior Accountant", manager: "E610", cc: "CC-6100", status: "active", comp: 118000 },
      ],
    },
    // ERP / GL master data (API, Controller-owned)
    erp: {
      costCenters: {
        "CC-1000": { name: "Executive", status: "active", glDept: "1000", entity: "HAL-US" },
        "CC-4100": { name: "Platform Engineering", status: "active", glDept: "4100", entity: "HAL-US" },
        "CC-4200": { name: "Data Engineering", status: "active", glDept: "4200", entity: "HAL-US" },
        "CC-4250": { name: "Data Platform", status: "active", glDept: "4250", entity: "HAL-US" },
        "CC-4300": { name: "ML Infrastructure", status: "active", glDept: "4300", entity: "HAL-US" },
        "CC-5200": { name: "Sales West", status: "active", glDept: "5200", entity: "HAL-US" },
        "CC-6100": { name: "Finance G&A", status: "active", glDept: "6100", entity: "HAL-US" },
      },
    },
    // Budget & headcount planning (API, FP&A-owned). Budget in $k / year, loaded.
    planning: {
      "CC-1000": { approvedHC: 4, budgetK: 1700, openReqs: [] },
      "CC-4100": { approvedHC: 4, budgetK: 820, openReqs: ["REQ-4101"] },
      "CC-4200": { approvedHC: 3, budgetK: 640, openReqs: ["REQ-4201"] },
      "CC-4250": { approvedHC: 2, budgetK: 470, openReqs: [] },
      "CC-4300": { approvedHC: 3, budgetK: 700, openReqs: [] },
      "CC-5200": { approvedHC: 10, budgetK: 1760, openReqs: ["REQ-5201", "REQ-5202"] },
      "CC-6100": { approvedHC: 3, budgetK: 480, openReqs: ["REQ-6101"] },
    },
    // Legacy cost-allocation engine: NO API. Changes are keyed by hand.
    allocation: {
      "CC-1000": { "Corporate": 100 },
      "CC-4100": { "Product A": 50, "Product B": 50 },
      "CC-4200": { "Product A": 70, "Product B": 30 },
      "CC-4250": { "Product A": 70, "Product B": 30 },
      "CC-4300": { "Product A": 40, "Product B": 60 },
      "CC-5200": { "Sales & Marketing": 100 },
      "CC-6100": { "Corporate": 100 },
    },
    // BI reporting hierarchy (API, derived)
    reporting: {
      "CC-1000": "Halcyon > Executive",
      "CC-4100": "Halcyon > Engineering > Platform Engineering",
      "CC-4200": "Halcyon > Engineering > Data Engineering",
      "CC-4250": "Halcyon > Engineering > Data Engineering > Data Platform",
      "CC-4300": "Halcyon > Engineering > ML Infrastructure",
      "CC-5200": "Halcyon > Revenue > Sales West",
      "CC-6100": "Halcyon > G&A > Finance",
    },
  };

  const SYSTEMS = {
    hris: { label: "HRIS (people system)", mode: "api", owner: "People Ops" },
    planning: { label: "Budget & headcount planning", mode: "api", owner: "FP&A" },
    erp: { label: "ERP cost centers & GL mapping", mode: "api", owner: "Controller" },
    allocation: { label: "Cost allocation engine (legacy)", mode: "manual", owner: "Finance Ops" },
    reporting: { label: "BI reporting hierarchy", mode: "api", owner: "Finance Systems" },
  };

  const clone = (x) => JSON.parse(JSON.stringify(x));

  // Move "today" and the close calendar to a given date, so the demo feels current.
  // The open period is today's month; lockdown is its last 3 business days.
  // The browser calls this with the viewer's date; tests keep the fixed seed above.
  const isoDate = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  function rebaseDates(seed, today) {
    const [y, m] = today.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const biz = [];
    for (let d = last; d >= 1 && biz.length < 3; d--) { const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); if (wd !== 0 && wd !== 6) biz.unshift(isoDate(y, m, d)); }
    seed.asOf = today;
    seed.fiscal.openFrom = isoDate(y, m, 1);
    seed.fiscal.openPeriodEnd = isoDate(y, m, last);
    seed.fiscal.lockdownFrom = biz[0];
    seed.fiscal.lockdownDays = biz;
    return seed;
  }
  rebaseDates(SEED, SEED.asOf);

  RCC.SEED = SEED;
  RCC.SYSTEMS = SYSTEMS;
  RCC.clone = clone;
  RCC.rebaseDates = rebaseDates;
  RCC.isoDate = isoDate;
})(globalThis.RCC = globalThis.RCC || {});
