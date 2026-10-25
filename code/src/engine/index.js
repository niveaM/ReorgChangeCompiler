// Node entry point for the engine. The browser loads the same files with <script> tags.
const files = ["seed", "pii-shield", "validator", "planner", "systems", "reconcile", "human-queue-adapter"];
for (const f of files) require(`./${f}.js`);
module.exports = globalThis.RCC;
