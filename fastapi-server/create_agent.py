import os
import sys

from retell import Retell

# Creation of the Retell LLM and Agent is done in this script. It reads the prompt from prompt.md, and uses the webhook URL from .env.

_env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(_env_path):
    with open(_env_path) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))

RETELL_API_KEY = os.environ.get("RETELL_API_KEY")
WEBHOOK_URL = os.environ.get("WEBHOOK_URL")
VOICE_ID = os.environ.get("VOICE_ID")
LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-4o") # Valor por defecto seguro

if not RETELL_API_KEY:
    sys.exit("Error: Falta RETELL_API_KEY.")

client = Retell(api_key=RETELL_API_KEY)

# Load the conversation prompt that lives next to this script.
with open(os.path.join(os.path.dirname(__file__), "prompt.md")) as fh:
    prompt = fh.read()

# The custom function the LLM calls once it has the name + age. Its `url` points
verify_age_tool = {
    "type": "custom",
    "name": "verify_age",
    "description": (
        "Verify the caller's age. Call this exactly once, right after you have "
        "collected the caller's name and age. Pass their name and their age (or "
        "4-digit birth year). If the result asks you to re-check with an exact "
        "date, ask for it and call again, also passing birth_date."
    ),
    "url": WEBHOOK_URL,
    "method": "POST",
    "speak_during_execution": False,
    "speak_after_execution": True,
    "parameters": {
        "type": "object",
        "required": ["name", "age_or_birth_year"],
        "properties": {
            "name": {
                "type": "string",
                "description": "The caller's name, as they gave it.",
            },
            "age_or_birth_year": {
                "type": "integer",
                "description": "The caller's age in years, or their 4-digit birth year.",
            },
            "birth_date": {
                "type": "string",
                "description": (
                    "Exact date of birth (MM/DD/YYYY). Only send this on a "
                    "re-ask, to resolve a borderline age."
                ),
            },
        },
    },
}

end_call_tool = {
    "type": "end_call",
    "name": "end_call",
    "description": "End the call after saying goodbye.",
}


def main():
    print(f"Webhook URL : {WEBHOOK_URL}")
    print(f"Model       : {LLM_MODEL}   Voice: {VOICE_ID}\n")

    # 1) Create the Retell LLM: prompt + tools.
    try:
        llm = client.llm.create(
            model=LLM_MODEL,
            general_prompt=prompt,
            begin_message=(
                "Hi! Thanks for calling. I just have two quick questions for you. "
                "What is your name?"
            ),
            general_tools=[verify_age_tool, end_call_tool],
        )
    except Exception as err:
        _die("creating the Retell LLM", err)
    print("Created Retell LLM:", llm.llm_id)

    # 3) Create the agent bound to that LLM.
    try:
        agent = client.agent.create(
            agent_name="Age-Gate Screener (FastAPI)",
            voice_id=VOICE_ID,
            response_engine={"type": "retell-llm", "llm_id": llm.llm_id},
        )
    except Exception as err:
        _die("creating the agent", err)

    print("\nDone.")
    print("  Agent ID :", agent.agent_id)
    print("  LLM ID   :", llm.llm_id)
    print("  Webhook  :", WEBHOOK_URL)


if __name__ == "__main__":
    main()