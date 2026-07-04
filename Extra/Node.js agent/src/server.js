/**
 * server.js
 * ---------
 * Express webhook server that receives Retell post-call events, extracts the
 * caller's name and age, and computes the authoritative PASS/FAIL decision.
 *
 * Retell fires webhooks for `call_started`, `call_ended`, and `call_analyzed`.
 * We act on `call_analyzed`, which includes the post-call analysis data
 * (custom-extracted fields) plus the full transcript.
 *
 * Decision priority:
 *   1) Retell post-call analysis custom fields (caller_name / caller_age)
 *   2) Fallback: parse the transcript ourselves (regex + word-number parsing)
 *
 * Either way, the PASS/FAIL comparison is done here in our own code.
 */

import "dotenv/config";
import express from "express";
import { Retell } from "retell-sdk";
import { evaluate } from "./ageGate.js";
import { extractFromTranscript } from "./extract.js";

const PORT = process.env.PORT || 3000;
const RETELL_API_KEY = process.env.RETELL_API_KEY;

const app = express();

// Capture the raw body so we can verify Retell's webhook signature.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/webhook", (req, res) => {
  // 1) Verify the request really came from Retell (if a key is configured).
  const signature = req.headers["x-retell-signature"];
  if (RETELL_API_KEY && signature) {
    const valid = Retell.verify(
      req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body),
      RETELL_API_KEY,
      String(signature)
    );
    if (!valid) {
      console.warn("[webhook] invalid signature — rejecting");
      return res.status(401).json({ error: "invalid signature" });
    }
  }

  const { event, call } = req.body ?? {};

  // Acknowledge everything quickly; only the analyzed event carries the data.
  if (event !== "call_analyzed") {
    return res.status(204).end();
  }

  // 2) Prefer Retell's post-call analysis custom fields.
  const analysis = call?.call_analysis?.custom_analysis_data ?? {};
  let name = analysis.caller_name ?? null;
  let age = analysis.caller_age ?? null;

  // 3) Fall back to parsing the transcript if the analysis is incomplete.
  if (name == null || age == null) {
    const fromTranscript = extractFromTranscript(call?.transcript ?? "");
    name = name ?? fromTranscript.name;
    age = age ?? fromTranscript.age;
  }

  // 4) Compute the decision in our own code.
  const result = evaluate({ name, age });

  console.log(
    `[age-gate] call=${call?.call_id ?? "?"} name=${result.name ?? "?"} ` +
      `age=${result.age ?? "?"} -> ${result.decision} (${result.reason})`
  );

  // The assignment asks us to PRINT the result — this is that print.
  console.log(result.decision);

  return res.status(200).json(result);
});

app.listen(PORT, () => {
  console.log(`Age-gate webhook listening on http://localhost:${PORT}`);
  console.log(`  POST /webhook   (configure this URL in the Retell agent)`);
  console.log(`  GET  /health`);
});
