// Model client: the one place the prototype talks to a model.
//
// Extraction is the only model call in the design. This file hides where the
// model comes from so the rest of the UI doesn't care:
//
//   1. Claude artifact viewer  - when the page is opened as a published Claude
//                                artifact, window.claude.use("sample") is available
//                                and runs on the viewer's own Claude account.
//   2. Anthropic API key       - when opened anywhere else (a local file, a static
//                                host), the user can paste an API key. The call goes
//                                straight from the browser to api.anthropic.com.
//                                The key is held in memory only and never stored.
//   3. None                    - extraction is off; the hand-written readings and the
//                                editable JSON still drive the whole pipeline.
//
// Whatever the source, the reply is parsed as JSON and handed to the validator.
// The model's output is data: nothing it says can approve, order or write.
(function (RCC) {
  "use strict";

  const DEFAULT_MODEL = "claude-sonnet-5-5";
  const API_URL = "https://api.anthropic.com/v1/messages";

  let viewerSample = null;      // window.claude sample function, if available
  let apiKey = "";              // in memory only
  let apiModel = DEFAULT_MODEL;

  // Resolves once we know whether the Claude viewer is available.
  function init() {
    if (!(globalThis.claude && typeof globalThis.claude.use === "function")) return Promise.resolve(status());
    return globalThis.claude.use("sample")
      .then((s) => { viewerSample = s || null; return status(); })
      .catch(() => status());
  }

  function setApiKey(key, model) {
    apiKey = (key || "").trim();
    apiModel = (model || "").trim() || DEFAULT_MODEL;
    return status();
  }

  // { source: "viewer" | "api" | "none", label }
  function status() {
    if (viewerSample) return { source: "viewer", label: "Claude (this viewer's account)" };
    if (apiKey) return { source: "api", label: `Anthropic API · ${apiModel}` };
    return { source: "none", label: "No model connected" };
  }

  // Tolerant JSON parse: whole reply, then a fenced block, then first { to last }.
  function parseLoose(text) {
    try { return JSON.parse(text); } catch (_) {}
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) { try { return JSON.parse(m[1]); } catch (_) {} }
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch (_) {} }
    return null;
  }

  // Returns the parsed change set. Rejects with { code, message }.
  async function extract(prompt, { signal, onText } = {}) {
    const src = status().source;
    if (src === "viewer") return extractViaViewer(prompt, signal, onText);
    if (src === "api") return extractViaApi(prompt, signal, onText);
    throw { code: "no_model", message: "No model connected. Open the page in Claude, add an API key, or use a hand-written reading." };
  }

  async function extractViaViewer(prompt, signal, onText) {
    const opts = { signal, modelTier: "default", cache: false, onText: ({ text }) => onText && onText(text.length) };
    let out;
    if (typeof viewerSample.json === "function") {
      try { out = await viewerSample.json(prompt, opts); }
      catch (e) {
        if (e && e.code === "capability_removed") out = parseLoose((await viewerSample(prompt, opts)).text);
        else throw e;
      }
    } else {
      out = parseLoose((await viewerSample(prompt, opts)).text);
    }
    return check(out);
  }

  async function extractViaApi(prompt, signal, onText) {
    let res;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          // Required for calls made directly from a browser page.
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({ model: apiModel, max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
      });
    } catch (e) {
      if (e && e.name === "AbortError") throw { code: "cancelled", message: "Stopped." };
      throw { code: "network", message: "Couldn't reach api.anthropic.com from this page." };
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (body.error && body.error.message) || res.statusText;
      const code = res.status === 401 ? "bad_key" : res.status === 429 ? "rate_limited" : res.status === 404 ? "bad_model" : "api_error";
      throw { code, message: `${res.status}: ${msg}` };
    }
    const text = (body.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    if (onText) onText(text.length);
    return check(parseLoose(text));
  }

  // Shape check before the validator sees the reply. The validator handles bad
  // values (unknown IDs, unknown types); this catches replies it can't read at all.
  function check(out) {
    if (!out || !Array.isArray(out.changes)) throw { code: "invalid_json", message: "The reply had no \"changes\" array." };
    const bad = out.changes.findIndex((c) => !c || typeof c !== "object" || typeof c.type !== "string");
    if (bad >= 0) throw { code: "invalid_json", message: `Change #${bad + 1} in the reply has no "type".` };
    return out;
  }

  RCC.modelClient = { init, setApiKey, status, extract, parseLoose, DEFAULT_MODEL };
})(globalThis.RCC = globalThis.RCC || {});
