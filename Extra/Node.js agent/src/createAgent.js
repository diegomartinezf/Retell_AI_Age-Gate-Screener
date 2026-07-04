/**
 * createAgent.js
 * --------------
 * One-shot script that provisions the age-gate voice agent on Retell:
 *   1) Creates a Retell LLM (conversation prompt + post-call analysis schema)
 *   2) Creates a voice agent bound to that LLM
 *   3) Wires the post-call webhook URL
 *
 * The post-call analysis schema is what makes Retell extract `caller_name`
 * and `caller_age` for us; our webhook then computes PASS/FAIL from them.
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Retell } from "retell-sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));

const RETELL_API_KEY = process.env.RETELL_API_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // e.g. https://<ngrok-id>.ngrok.app/webhook
const VOICE_ID = process.env.VOICE_ID || "11labs-Bing";

if (!RETELL_API_KEY) {
  console.error("Missing RETELL_API_KEY. See .env.example.");
  process.exit(1);
}

const client = new Retell({ apiKey: RETELL_API_KEY });

const prompt = readFileSync(join(__dirname, "..", "agent", "prompt.md"), "utf8");

async function main() {
  // 1) Create the Retell LLM with the prompt + structured post-call analysis.
  const llm = await client.llm.create({
    model: "gpt-4o",
    general_prompt: prompt,
    begin_message:
      "Hi! Thanks for calling. I just have two quick questions for you. What is your name?",
  });
  console.log("Created Retell LLM:", llm.llm_id);

  // 2) Create the agent bound to that LLM, with post-call analysis fields.
  const agent = await client.agent.create({
    agent_name: "Age-Gate Screener",
    voice_id: VOICE_ID,
    response_engine: { type: "retell-llm", llm_id: llm.llm_id },
    // Retell extracts these fields from the call and sends them in the
    // `call_analyzed` webhook under call_analysis.custom_analysis_data.
    post_call_analysis_data: [
      {
        type: "string",
        name: "caller_name",
        description: "The caller's name exactly as they gave it.",
      },
      {
        type: "number",
        name: "caller_age",
        description:
          "The caller's age in whole years as an integer. If the caller " +
          "refused or did not give a numeric age, leave it empty.",
      },
    ],
    ...(WEBHOOK_URL ? { webhook_url: WEBHOOK_URL } : {}),
  });

  console.log("Created agent:", agent.agent_id);
  console.log("\nDone.");
  console.log("  Agent ID :", agent.agent_id);
  console.log("  LLM ID   :", llm.llm_id);
  if (WEBHOOK_URL) console.log("  Webhook  :", WEBHOOK_URL);
  else
    console.log(
      "  Webhook  : (not set) — set WEBHOOK_URL and re-run, or add it in the dashboard."
    );
  console.log(
    "\nTest it: open the agent in dashboard.retellai.com and click 'Test Call'."
  );
}

main().catch((err) => {
  console.error("Failed to create agent:", err?.message || err);
  process.exit(1);
});
