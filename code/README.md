# Reorg Change Compiler

A working prototype that takes a reorg announcement as it arrives (a Slack message, an email, a doc) and turns it into a validated, ordered, human-gated runbook across five systems of record:

| # | System | API? |
|---|---|---|
| 1 | ERP cost centers & GL mapping | yes |
| 2 | Budget & headcount planning | yes |
| 3 | HRIS | yes |
| 4 | Cost allocation engine | **no** (a person keys it) |
| 5 | BI reporting hierarchy | yes |

The single rule behind the design: **the model proposes; deterministic code and named people dispose.** One model call reads the freeform text. Everything after it (validation, ordering, approvals, propagation, verification) is plain code, and a person signs every change.

The design is in the [strategy doc](../Reorg-Change-Compiler-strategy.md).

---

## Run it

No build step, and no dependencies to run the page.

```bash
# Option 1: open the file directly
open ../index.html         # macOS; or double-click it (it's at the repository root)

# Option 2: serve it locally (Node 18+)
npm start                  # http://localhost:8080
```

### Live extraction (the model step)

Extraction is the only step that calls a model. The page picks a source automatically:

| Where the page runs | What extraction uses |
|---|---|
| Published as a Claude artifact | The viewer's own Claude account. Approve the one-time prompt. |
| Anywhere else (local file, static host) | **Your Anthropic API key.** Open "Run extraction with your own Anthropic API key" under the Extract step, paste a key, and click **Use this key**. The default model is `claude-sonnet-5-5`; you can type another. The key stays in page memory, is sent only to `api.anthropic.com`, and is forgotten on reload. |
| No model available | Extraction is off. **Load hand-written reading** gives the correct change set for each sample, and the JSON box is editable, so the rest of the pipeline still runs. |

## Demo walkthrough (about 10 minutes)

The step bar across the top shows all seven steps and where each one stands. Click a step to open it, or use the button at the bottom of each step to move to the next.

1. **01 Intake.** Pick **Slack · VP Engineering**.
2. **02 PII redaction.** See what the model sees: names are employee IDs, the pay figure is a token, and "Priya" is flagged as ambiguous because two people share the name.
3. **03 Extract.** Click **Extract with Claude** (20–60 seconds) or **Load hand-written reading**. Review the readable panel: each change, its source quote and confidence, and questions for the requester. Fix anything in the JSON.
4. **04 Validate.** The pay change is a blocker. Every blocker says how to fix it. Click **Route to comp process**. Open *Derived work* to see the steps nobody wrote down: the GL remap, the headcount transfer, and closing the merged cost center (never deleting it).
5. **05 Approve.** Approver names are pre-filled with different people; click **Sign Gate-1**, then Gate-2 and Gate-3. Edit the JSON once and watch every signature void.
6. **06 Propagate.**
   1. Click **Run all ready API steps**.
   2. At the allocation step, click **Issue ticket**.
   3. The keyer's name, the cost center and the targets are pre-filled from the ticket. Click **Record what I keyed**.
   4. Click **Verify (second person)**. The verifier's name is pre-filled with a different person.
   5. Click **Run all ready API steps** again.
7. **07 Reconcile.** Click **Reconcile now**. The lifecycle strip reaches **COMPLETED**.

Three moments worth showing:
- **Fixing a blocker in place.** With the *Doc · org update draft* sample, Chris Dunn's move has no effective date. Enter one next to the blocker and click **Set date**, then click **Route to hiring process** on the new-hire line, which isn't a reorg change.
- **A keying error.** With the *Email · HR business partner* sample, change the pre-filled targets to `Sales & Marketing=90`. Verification fails (`FAILED_VERIFICATION`), and **Re-key** issues a new ticket.
- **An outside change.** Partway through a run, click **Simulate an outside edit**. The next step notices that the systems no longer match the plan and stops (`PARTIALLY_FAILED`).

Reconciling before every step has run is allowed on purpose. It shows the drift a half-finished reorg leaves behind.

## Project layout

```
../index.html                    Markup only (at the repository root); loads the scripts below in order
css/styles.css                   Styles (light and dark)
src/engine/                      Deterministic core: no model, no network, no DOM
  seed.js                        Fictional company "Halcyon": 24 people, 7 cost centers, 5 systems
  pii-shield.js                  Names → IDs, pay/contacts → tokens; builds the extraction prompt
  validator.js                   ~20 rules, derived work, headcount/cost impact, gate selection
  planner.js                     Phase order (as data) and the runbook compiler
  systems.js                     Simulated systems of record and each step's write
  reconcile.js                   Cross-system checks, independent of the plan
  human-queue-adapter.js         SHA-256, snapshots, keying tickets, second-person read-back
  index.js                       Node entry point (tests)
src/ui/
  samples.js                     Three sample messages, each with a hand-written reading
  model-client.js                The only model call: Claude viewer, Anthropic API key, or none
  app.js                         Renders the steps and the step bar, offers fixes for blockers, and records signatures, keying and verification
test/
  engine.test.js                 Engine tests (no dependencies)
  ui.e2e.test.js                 Full UI run in a headless DOM (needs jsdom)
scripts/serve.js                 Tiny static server for `npm start`
```

The engine files are classic scripts that share a single `RCC` namespace. The same files load in the browser through `<script>` tags and in Node through `src/engine/index.js`, so there's no bundler.

## How the code maps to the design

| Design element | Where it lives |
|---|---|
| PII redaction | `src/engine/pii-shield.js` → `shield()` |
| Extraction, the only model call | `src/engine/pii-shield.js` → `extractionPrompt()`, `src/ui/model-client.js` |
| Validation rules and derived work | `src/engine/validator.js` → `validate()` |
| Gates Gate-1 to Gate-3 | `validator.js` → `gatesFor()`; signatures in `app.js` (bound to change-set hash + snapshot) |
| Order of operations | `src/engine/planner.js` → `PHASES`, `compile()` |
| Lifecycle and re-validation before each step | `app.js` → `driftCheck()`, `lifecycle()` |
| Human Queue Adapter | `src/engine/human-queue-adapter.js` → `makeTicket()`, `verifyTicket()`, `ticketCurrent()` |
| Reconciliation | `src/engine/reconcile.js` → `reconcile()` |

## Tests

```bash
npm install     # only needed for the UI test (jsdom)
npm test
```

- **`engine.test.js` (12 tests, no dependencies).** Covers:
  - PII redaction, including that nothing secret leaks;
  - the pay-change blocker;
  - derived work for a merge;
  - the accounting-first phase order, and that every write requires Gate-1;
  - date, loop and unknown-person rules;
  - the lockdown split needing the Controller;
  - reconciliation passing, and failing on a 90% keying error;
  - a retried step never applying twice (the idempotency key);
  - SHA-256 against Node's `crypto`;
  - tickets going stale on drift;
  - cost centers being closed, never deleted (rule end-dated, kept in reporting), and a duplicate new cost center being blocked.
- **`ui.e2e.test.js` (5 tests).** Covers:
  - a full run from extraction to `COMPLETED`, including the rule that an approver can't key;
  - the pipeline working with no model;
  - an outside edit stopping the run;
  - every blocker saying how to fix it, and a missing date entered in place;
  - picking another sample starting a clean case.

  These are skipped if jsdom isn't installed.

## What's real and what's simulated

**Real:**
- PII redaction;
- the model call;
- every validation rule;
- the runbook compiler;
- the gates and their hash binding;
- drift detection;
- the keying ticket and verification;
- reconciliation.

**Simulated:** the five systems of record. They're in-memory objects seeded with a fictional company, so a run never touches a real system.

**Not built, and why:**
- **Real connectors.** They need credentials and test tenants. The connector interface (`preview`, `apply`, `readBack`) is defined in the design.
- **The comp workflow.** It's a different process with different approvers. Pay changes are detected and routed out.
- **A persistent audit log.** The design assumes it lives with the company's other financial records.
- **An evals harness.** It needs a labeled set of real messages, which shadow mode would produce.

## Privacy notes

- The model never sees names, pay, emails or phone numbers. They're replaced before the prompt is built, and the originals stay in the page.
- FP&A sees cost impact per cost center, never individual pay.
- An API key, if you use one, is held in memory only and never written to storage.
- All data in this repository is fictional.
