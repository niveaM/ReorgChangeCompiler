# Reorg Change Compiler

The document presents a design and a working prototype for propagating reorgs. A freeform message arrives (Slack, email, a doc) and is turned into a validated, ordered and human-approved set of changes across the ERP and GL, planning, the HRIS, cost allocation and BI reporting.

**Author:** Nivea Mandavia

**Demo video:** [2-minute narrated walkthrough](https://niveam.github.io/ReorgChangeCompiler/demo/Reorg-Change-Compiler-demo.mp4) · **Live prototype:** [niveam.github.io/ReorgChangeCompiler](https://niveam.github.io/ReorgChangeCompiler/)

**The core idea: an agentic pipeline** that carries a reorg message through to five systems. One model call reads the message, deterministic code checks it and orders the work, and people approve it at each gate. The hard part is doing it in the right order, with checks and balances that validate each change and confirm it reached every system. Today one person does this from a checklist in their head. The pipeline runs on a written-down [order of operations](./Reorg-Change-Compiler-strategy.md#order-of-operations), with a reason for each phase, the same way every time:

1. **ERP cost centers & GL:** create a cost center only if it's new (most already exist), and remap the GL.
2. **Budget & headcount planning:** move approved headcount and budget.
3. **HRIS:** move people and managers, on the effective date.
4. **Cost allocation (no API):** a person keys the rule changes, including end dates for closing cost centers; a second person checks them.
5. **ERP:** close emptied cost centers to new postings. They're never deleted, so past periods still report.
6. **BI reporting:** rebuild the reporting rollups.
7. **Reconcile:** check that all five systems agree.
8. **Notify:** tell the people affected.

The rules behind the order:
1. A new cost center, if one is needed, exists before people move into it.
2. Budget moves before people.
3. A cost center is closed only once it's empty, and never deleted.
4. Every write is read back before the next phase starts.

*See [Order of Operations](./Reorg-Change-Compiler-strategy.md#order-of-operations) for the reason behind every phase.*

## What's here (order of review)

| Read | File | What it is |
|---|---|---|
| 1 | [`BRIEF.md`](./BRIEF.md) | The assignment this prototype answers, for reference. |
| 2 | [`Reorg-Change-Compiler-strategy.md`](./Reorg-Change-Compiler-strategy.md) | The design doc, in the brief's format: summary; goals and non-goals; approach and design, including the [order of operations](./Reorg-Change-Compiler-strategy.md#order-of-operations); alternatives considered; risks and failure modes; assumptions and open questions. Start here. |
| 3 | [Live prototype](https://niveam.github.io/ReorgChangeCompiler/) | The working prototype, hosted. Open it in a browser; nothing to install. |
| 4 | [Demo video (2 min)](https://niveam.github.io/ReorgChangeCompiler/demo/Reorg-Change-Compiler-demo.mp4) | A narrated walkthrough of the prototype, from a Slack message to all five systems reconciled. Plays in the browser. |
| 5 | [Prototype source](https://github.com/niveaM/ReorgChangeCompiler/tree/main/code/) | The prototype source and demo walkthrough. |

## Run the prototype

- **Watch first:** the [2-minute demo video](https://niveam.github.io/ReorgChangeCompiler/demo/Reorg-Change-Compiler-demo.mp4) walks through one reorg end to end.
- **Live page:** open https://niveam.github.io/ReorgChangeCompiler/ and click **Load hand-written reading** to run it without an API key.
- **With Node 18 or newer:** clone the [repository](https://github.com/niveaM/ReorgChangeCompiler). In the repository's `code/` directory, run `npm start` and open http://localhost:8080. Run `npm install && npm test` there to run the 17 tests.
- **Live extraction:** in the Extract step, paste an Anthropic API key. Without one, the hand-written readings run the same pipeline end to end.

## How I used AI

Three AI agents (Claude, Gemini and Muse.ai) each drafted a design independently, then critiqued each other's drafts against the [brief](./BRIEF.md). I logged every critique point and decided each one: 28 points, 23 adopted or adapted, 5 rejected. I combined the drafts into the final design, and the agents reviewed it before I accepted it.

**Where the review changed the design:**
- **[Order of operations](./Reorg-Change-Compiler-strategy.md#order-of-operations).** Two of the three drafts updated the HRIS first. That breaks any reorg that creates or merges a cost center, because people get assigned to a cost center the ERP doesn't have yet.
- **The manual-keying ticket.** I adopted one draft's field-by-field ticket, tied to a hash, but changed how it's verified. A system with no API may have no data export either, so the fallback is a second-person check plus an ERP-side control.
- **Lifecycle, concurrency checks and evals** came from a critique of the first draft.

**Where I overrode the AI:**
- **Auto-approval.** One draft let "low-risk" changes skip approval from day one. I kept a person on every approval in version 1 and made automation something each change type earns through evals.
- **Rollback.** One draft claimed two-phase commit across these systems. That isn't possible here, so a person decides instead: resume, or roll back with an approved correcting change.
- **Names and pay.** Names, pay and contact details are redacted in code before the model sees anything: names become employee IDs and pay becomes a token. The model can't approve, order or write.

**Where I had to step in.** Working with several agents took active oversight. Agents sometimes critiqued points the design never made, misfiled work outside the agreed structure, posted findings that didn't match the code, or ran out of context and needed a fresh session. I treated every agent claim as a proposal: nothing was accepted until I'd checked it against the files.

**Cost and economics.**
- **Running it costs about a cent per reorg.** There's one model call per message: roughly 1,600 tokens in and 400 out. Even at 1,000 reorgs a year that's about $10 of model spend. The costs that matter in production are people's review time at the gates and maintaining five system connectors.
- **Building it cost about $40–50 at API list prices.**
  - That's the Claude session only, about 104M tokens, mostly cheap re-reads of cached context. It ran on a personal subscription.
  - Gemini and Muse.ai aren't metered; Muse.ai used roughly 12% of a weekly quota.
  - About a third of the Claude spend was tooling overhead, not design work: moving files through Google Drive by retyping them.

**What I'd change in a team setup.** The agents ran on personal accounts with no shared workspace, so most of that overhead was avoidable. With work accounts I'd:
- **Give the agents one shared Git repo as their workspace.** Files are copied, not retyped. Reviews run on diffs, and the history doubles as an audit trail. That alone cuts about a third of the build cost.
- **Run every agent on org accounts with usage reporting and per-project budgets,** so multi-agent work is measurable and capped.
- **Keep company data under enterprise data terms and retention controls,** not personal accounts.
- **Use one coordination channel the agents can write to directly,** instead of a hand-pasted file.

## Assumptions and limits

These are listed in one place: [Assumptions and Open Questions](./Reorg-Change-Compiler-strategy.md#assumptions-and-open-questions) in the strategy doc, including what the prototype simulates and what isn't built.
