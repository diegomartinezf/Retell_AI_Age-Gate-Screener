# Age-Gate Screener — Retell AI Voice Agent

A small but complete voice agent built on **Retell AI**. When a caller connects,
the agent has a short, natural conversation, asks exactly two questions
name then age and after the call a webhook backend computes a single
decision in code:

> PASS if the caller's age is strictly greater than 18, otherwise FAIL
> (an 18-year-old FAILs).

The LLM only holds the conversation. The pass/fail decision is never made by
the model it is computed programmatically in (src/ageGate.js).


# Approach & design judgment

Where the logic lives. Three candidate places: the prompt, a post-call
process, or a webhook. This solution puts the decision in a webhook backend,
and uses Retell's post-call analysis to do the raw extraction:

| Concern | Where it's handled | Why |

| Natural conversation, ask 2 Qs in order | Retell LLM prompt (agent/prompt.md) | The model is good at conversation and re-prompting. |
| Extract caller_name + caller_age | Retell post-call analysis (structured fields) | Robust, structured, no brittle prompt parsing. |
| Fallback extraction | (src/extract.js) | If analysis is missing, parse the transcript ourselves. |
| PASS/FAIL decision | (src/ageGate.js) | The assignment requires a programmatic check, not the LLM. |

The prompt is explicitly instructed not to reveal any decision, mention "18",
or do age math that keeps the model out of the decision entirely.

Robustness / edge cases (see tests):
- Ages as digits ("25", "I'm 25 years old") and as words ("twenty-five", "eighteen").
- Missing / refused / non-numeric age → FAIL (fail-safe we can't verify).
- Names with lead-ins ("my name is…", "I'm…", "this is…"), title-cased.
- The strict > 18 boundary is unit-tested (18 → FAIL, 19 → PASS).


# Project structure

retell-age-gate/
├── agent/
│   └── prompt.md          # Conversation prompt (2 questions, in order)
├── src/
│   ├── ageGate.js         # PASS/FAIL logic + name/age parsing (pure, tested)
│   ├── extract.js         # Fallback: parse name/age from the transcript
│   ├── server.js          # Express webhook receives call_analyzed, decides
│   ├── createAgent.js     # Provisions the Retell LLM + agent via the API
│   └── simulate.js        # Run the whole decision pipeline with no phone call
├── test/
│   └── ageGate.test.js    # Unit tests (node --test)
├── .env.example
└── README.md


# Setup

Requires Node.js 20+

```bash
cd retell-age-gate
npm install
cp .env      # Fill in your values
```

# Environment variables

| Variable | Required | Description |

| `RETELL_API_KEY` | yes | API key from dashboard.retellai.com → Settings → API Keys. |
| `WEBHOOK_URL` | for live calls | Public URL of this server's /webhook (e.g. an ngrok URL). |
| `VOICE_ID` | no | Retell voice id. |
| `PORT` | no | Local server port (e.g. 3000). |


# Run it

# 1. Verify the logic (no Retell needed)

```bash
npm test                 # unit tests, including the >18 boundary
node src/simulate.js     # runs a sample call payload -> prints PASS
node src/simulate.js 18  # quick boundary check -> prints FAIL
node src/simulate.js 25 Maria Garcia
```

# 2. Start the webhook server

```bash
npm start                # listens on http://localhost:3000
```

Expose it publicly so Retell can reach it:

```bash
ngrok http 3000          # copy the https URL -> use as WEBHOOK_URL
```

# 3. Create the Retell agent

```bash
# with RETELL_API_KEY and WEBHOOK_URL set in .env:
npm run create-agent
```

This creates a Retell LLM (with the prompt + a post-call analysis schema for
caller_name and caller_age) and a voice agent wired to your webhook. It
prints the new agent_id.

# 4. Test a call

Open the agent in dashboard.retellai.com and click Test Audio, or place a
call to a number attached to the agent. After the call ends, Retell fires the
call_analyzed webhook; the server logs the extracted name/age and prints
PASS or FAIL to stdout, and responds with JSON:

```json
{ "decision": "PASS", "name": "Maria Garcia", "age": 25, "reason": "Age 25 is greater than 18." }
```

# How the decision is computed

1. Retell sends the call_analyzed webhook to POST /webhook.
2. The server verifies the Retell signature.
3. It reads call.call_analysis.custom_analysis_data.caller_name / caller_age.
4. If either is missing, it falls back to parsing call.transcript.
5. evaluate({ name, age }) in (src/ageGate.js) parses the age
   (digits or words), applies the strict age > 18 rule, and returns the
   PASS/FAIL result which is printed and returned as JSON.

The comparison is a single line of our own code:

```js
const decision = parsedAge > 18 ? "PASS" : "FAIL";
```
