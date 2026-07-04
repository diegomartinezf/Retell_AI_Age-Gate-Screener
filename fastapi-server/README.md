# Age-Gate Screener FastAPI backend in Python

Retell AI voice agent acting as an age-gate screener. The agent asks the caller for their name and age, then calls a Retell Custom Function through a webhook that POSTs to this
server. The server computes the caller's real age and returns a PASS or FAIL
decision plus an instruction for the agent to speak.

> The PASS/FAIL decision is computed in code never by the LLM.
> The rule is strict: age must be > 18 to PASS (an 18-year-old FAILs).

# Key Files

*  main.py : FastAPI app and the /webhook/verify-age endpoint.
*  age_gate.py :Validation and parsing logic.
*  create_agent.py : Script to automatically provision the LLM and agent in Retell.
*  prompt.md : The base prompt for the agent.
*  .env : Environment variables configuration.

# Endpoint

POST /webhook/verify-age

# Request 

Data is extracted from the  args  object (or the body directly if "Payload: args only" is enabled in Retell):

   json
{
  "args": {
    "name": "Samuel greens",
    "age_or_birth_year": 1995
  }
}
   

*  name  (string): The caller's name (lead-ins like "my name is…" are stripped).
*  age_or_birth_year  (integer/string): A plain age ( 25 ), a 4-digit birth year ( 1995 ), or a raw phrase.
*  birth_date  (string, optional): Exact date of birth only sent on a re-ask (see the  ASK  flow).

# Response 

   json
{
  "status": "PASS",
  "message_for_agent": "The user has been approved. Warmly welcome them, let them know they're all set, and say goodbye."
}
   

 status  is one of  PASS ,  FAIL , or  ASK  (the boundary re-ask, below).

# How the age is resolved

All parsing lives in (age_gate.py):
- Plain age vs. birth year an integer  ≥ 1000  is read as a birth year
  ( current_year − value ); anything smaller is the age directly.
- Messy phrases with several numbers —  "I have 2 kids and my age is 28" 
  resolves to  28 , not  2 . Age cues ( my age is … ,  I'm … ,  aged … ,
   … years old ) are matched before any bare number, so incidental counts are
  ignored.
- Names lead-ins are stripped and the result is title-cased:
   "my name is alex"  →  "Alex" ,  "this is john smith"  →  "John Smith" .
- Dates month-first US format:  3/5/1998  is March 5th;  "March 5, 1998" 
  and ISO  1998-03-05  also parse.
- The 18/19 border (± 1 year) a bare birth year can't tell us whether this
  year's birthday has happened yet, so it's only certain to ± 1 year. When that
  range straddles the boundary (e.g. born 2007 → age 18 or 19), we return
   ASK :  message_for_agent  tells the agent to ask for the caller's exact
  date of birth or exact age, then call  verify_age  again (passing
   birth_date ). An exact date removes the uncertainty and yields  PASS / FAIL .

Then the strict rule:  PASS  if  age > 18 , otherwise  FAIL . Implausible values
(negative, or > 120) also  FAIL , and a malformed/missing payload fails safe to
 FAIL .

Spoken words like "twenty-five" are parsed too (English number words). In
practice Retell's LLM usually transcribes spoken numbers to digits before
calling the tool, so the webhook typically receives  28 .

# Required print

Before responding, the server prints the decision exactly as:

   
<Name> - Calculated Age: <X> - Result: PASS/FAIL
   

(emitted via  logger.info , e.g.  Maria Garcia - Calculated Age: 31 - Result: PASS ).

# Setup

Requires Python 3.9+.

   bash
cd fastapi-server
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Create the agent
source .venv/bin/activate
python create_agent.py

# Run a Tmux Session
tmux new -s fastapi

# inside tmux:

source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000
   

# Environment variables

*  RETELL_API_KEY  (server + script): Server: if set, verifies the  X-Retell-Signature  header. Script: required.
*  WEBHOOK_URL  ( create_agent.py ): Public URL of the endpoint. 

*  VOICE_ID  ( create_agent.py ): Retell voice id. Default  11labs-Bing .
*  LLM_MODEL  ( create_agent.py ): LLM model. Default  gpt-4o .                                         |

> For quick testing, leave  RETELL_API_KEY  unset in the server's
> environment so signature verification is skipped.  create_agent.py .


# Run it locally

   bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
   

Expose it publicly so Retell can reach it:

   bash
ngrok http 8000
   

Use the resulting  https://<id>.ngrok.app/webhook/verify-age  as the custom
function URL in the Retell dashboard.

## Test it

Birth year → PASS:

   bash
curl -s -X POST http://localhost:8000/webhook/verify-age \
  -H "Content-Type: application/json" \
  -d '{"args": {"name": "Maria Garcia", "age_or_birth_year": 1995}}' | python -m json.tool
   

Plain age, boundary → FAIL (18 is not > 18):

   bash
curl -s -X POST http://localhost:8000/webhook/verify-age \
  -H "Content-Type: application/json" \
  -d '{"args": {"name": "Sam", "age_or_birth_year": 18}}'
   

Flat body (Retell "Payload: args only" mode) also works:

   bash
curl -s -X POST http://localhost:8000/webhook/verify-age \
  -H "Content-Type: application/json" \
  -d '{"name": "Alex", "age_or_birth_year": 25}'
   

# Create the Retell agent (recommended: script)

 create_agent.py  provisions everything via the Retell API — an LLM with the
prompt, the  verify_age  custom function (pointed at your  WEBHOOK_URL ) and an
 end_call  tool, plus the voice agent bound to that LLM. It then **re-fetches
the LLM and confirms  verify_age  attached**, and surfaces the API's error body
if anything fails.

   bash
cd fastapi-server
source .venv/bin/activate
# RETELL_API_KEY in .env (WEBHOOK_URL/VOICE_ID/LLM_MODEL optional overrides)
python create_agent.py
   

Then open the agent in retellai and click Test Call.

> The dashboard's Post Call Data Retrieval section stays empty on purpose
> this flow sends name/age as live function arguments, not post-call variables.


# Keeping the server reachable (deployment)

Retell calls the webhook during the call, so the server must be up and
listening on a public address.
