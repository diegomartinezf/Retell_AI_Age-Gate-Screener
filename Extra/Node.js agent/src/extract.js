/**
 * extract.js
 * ----------
 * Fallback extraction of name and age directly from the call transcript,
 * used when Retell's post-call analysis fields are unavailable.
 *
 * Retell transcripts are typically formatted as:
 *   Agent: What is your name?
 *   User: My name is Alex.
 *   Agent: What is your age?
 *   User: I'm twenty-five.
 *
 * We look at the user's turns that follow each question.
 */

import { parseAge, parseName } from "./ageGate.js";

/**
 * @param {string} transcript
 * @returns {{ name: string|null, age: number|null }}
 */
export function extractFromTranscript(transcript) {
  const text = String(transcript || "");
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Build an ordered list of {speaker, content} turns.
  const turns = [];
  for (const line of lines) {
    const m = line.match(/^(agent|assistant|user|caller)\s*[:\-]\s*(.*)$/i);
    if (m) {
      const speaker = /user|caller/i.test(m[1]) ? "user" : "agent";
      turns.push({ speaker, content: m[2] });
    } else if (turns.length) {
      // Continuation of the previous turn.
      turns[turns.length - 1].content += " " + line;
    }
  }

  let name = null;
  let age = null;

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.speaker !== "agent") continue;
    const q = t.content.toLowerCase();
    const reply = findNextUserTurn(turns, i);
    if (!reply) continue;

    if (name == null && /\bname\b/.test(q)) {
      name = parseName(reply);
    }
    if (age == null && /\bage\b|how old\b/.test(q)) {
      age = parseAge(reply);
    }
  }

  // Last-resort scan: if a question wasn't matched, try any user turn.
  if (age == null || name == null) {
    for (const t of turns) {
      if (t.speaker !== "user") continue;
      if (age == null) age = parseAge(t.content);
      if (name == null) name = parseName(t.content);
    }
  }

  return { name, age };
}

function findNextUserTurn(turns, fromIndex) {
  for (let j = fromIndex + 1; j < turns.length; j++) {
    if (turns[j].speaker === "user") return turns[j].content;
  }
  return null;
}
