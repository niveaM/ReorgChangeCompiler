# Brief: Reorg automation work trial

**Source:** the work-trial assignment text, unchanged except for formatting.

## Problem statement

A company reorganizes often and runs on deep knowledge held by specific people rather than on systems.

When reorgs occur (teams move under new leaders, cost centers split or merge, managers change, headcount shifts), the change does not flow automatically between:
- the people system;
- the budget and headcount-planning tools;
- the downstream finance systems (cost allocation, GL mappings, reporting).

Each is updated by hand.

Doing so in the right order is critical, but the order is not codified; it is done by someone who holds the checklist in their head. Further, the runbooks and templates that do exist are in varying states of accuracy. There is no source of truth for all of the steps that must occur for a reorg to be successful.

The process is slow, errors surface weeks later in financial reports, and it is fully dependent on manual work.

## Your task

Spend roughly 3 to 4 hours creating the two items detailed below. Submit them 24 hours before your scheduled interview.

We will review them in a live one-hour session with one of your interviewers. You will walk us through your work for the first 30 minutes, providing an overview of the design doc and demoing the prototype. We will use the rest of the session to answer your questions and discuss the problem and solution space.

It is expected that you use AI for both portions of the work.

### 1. Design doc

Create a brief document that covers:
- **Summary:** what you are building and the outcome it produces.
- **Goals and non-goals:** the slice of the problem you are solving, and what you are deliberately leaving out.
- **Approach and design:** how a reorg change moves from capture to validation to propagation. Name the main components and interfaces, which agentic building blocks you rely on, and where a human stays in the loop and why.
- **Alternatives considered:** other approaches you weighed, and why you did not choose them.
- **Risks and failure modes:** the two or three ways this breaks, the blast radius of each, and how you would detect and handle it.
- **Assumptions and open questions:** what you assumed to move forward, and what you would need to resolve before the business could rely on it.

### 2. Functional prototype

Create a functional prototype that demonstrates one or two of the key components of the design.

Because the role is less about production code, this can be:
- a low/no-code agentic workflow (n8n or similar);
- an agent or set of agents;
- a script;
- a spec plus a partial build.

Scope to the one or two slices where the judgment lives. It must be functional, not a mock.

## Constraints

- Reorg changes arrive as freeform text: a document, a Slack message, an email from an HR partner, and so on. There is no structured event to subscribe to.
- Some target systems have no API access. Assume at least one requires a human to key in the change.
- The data includes compensation and other PII.
- Certain steps require human approval before anything downstream moves. Decide which ones and where the approval sits.

## Notes

- If something is ambiguous, state your assumption and keep going. Do not email for clarification.
- Make your scoping decisions explicit. "I chose not to build X because Y" is a deliverable.
- There is no single right answer. We are evaluating your reasoning more than your choice.
- Be ready to point to the exact places where AI shaped a decision and where you overrode it.
