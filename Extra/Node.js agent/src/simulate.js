/**
 * simulate.js
 * Test the full decision pipeline WITHOUT making a phone call.
 *   node src/simulate.js            # built-in sample transcript
 *   node src/simulate.js 25 Alex    # quick check: age then name
 */

import { evaluate } from "./ageGate.js";
import { extractFromTranscript } from "./extract.js";

const [, , ageArg, ...nameParts] = process.argv;

if (ageArg) {
  const result = evaluate({ name: nameParts.join(" ") || "Test", age: ageArg });
  console.log(JSON.stringify(result, null, 2));
  console.log(result.decision);
  process.exit(0);
}

const samplePayload = {
  event: "call_analyzed",
  call: {
    call_id: "sample_123",
    transcript: [
      "Agent: Hi! Thanks for calling. What is your name?",
      "User: Hi, my name is Maria Garcia.",
      "Agent: Thanks, Maria. And what is your age?",
      "User: I'm twenty-five years old.",
      "Agent: Perfect, that's everything. Goodbye!",
    ].join("\n"),
    call_analysis: {
      custom_analysis_data: { caller_name: "Maria Garcia", caller_age: 25 },
    },
  },
};

function decide(payload) {
  const { call } = payload;
  const analysis = call?.call_analysis?.custom_analysis_data ?? {};
  let name = analysis.caller_name ?? null;
  let age = analysis.caller_age ?? null;
  if (name == null || age == null) {
    const fromTranscript = extractFromTranscript(call?.transcript ?? "");
    name = name ?? fromTranscript.name;
    age = age ?? fromTranscript.age;
  }
  return evaluate({ name, age });
}

const result = decide(samplePayload);
console.log(JSON.stringify(result, null, 2));
console.log(result.decision);
