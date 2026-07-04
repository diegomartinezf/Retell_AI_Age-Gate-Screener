"""
The voice agent (configured on Retell) asks the caller two questions name and
age and then invokes a Retell Custom Function (a webhook). Retell sends a
POST request to this server with the collected arguments. This server:


  1. Reads the caller's name and age_or_birth_year (and, on a re-ask, an
     exact birth_date).
  2. Computes the caller's actual age robustly see age_gate.py. It handles:
       * a plain age or a 4-digit birth year,
       * messy phrases with several numbers ("I have 2 kids and my age is 28"),
       * names with lead-ins ("this is Alex", "I'm Alex"),
       * the 18/19 border: a bare birth year is uncertain by ± 1 year, so when
         it lands exactly on the boundary we return ASK and have the agent
         re-ask for the exact date of birth or exact age.
  3. Applies the strict business rule: age must be > 18 to PASS.
  4. Prints the decision to the console.
  5. Returns JSON telling the agent what to say/do next.

Design note — where the decision lives:
    The PASS/FAIL comparison is done in our own code, never by the LLM.
    The agent prompt only collects the two answers and calls this tool; it does
    no age math and announces no verdict.
"""

import json
import logging
import os
from typing import Literal, Optional, Union

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError

from age_gate import evaluate


# Configuration & logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
)
logger = logging.getLogger("age-gate")

# API KEY
RETELL_API_KEY: Optional[str] = os.environ.get("RETELL_API_KEY")
app = FastAPI(title="Retell Age-Gate Screener", version="2.0.0")

# Pydantic models


class AgeGateArgs(BaseModel):
    """
    The LLM usually extracts a clean integer, but accepting the raw phrase too lets the
    server parse messy answers robustly.
    """

    name: str = Field(..., description="The caller's name, as they gave it.")
    age_or_birth_year: Union[int, str, None] = Field(
        default=None,
        description="The caller's age (e.g. 25) or 4-digit birth year (e.g. 1995).",
    )
    birth_date: Optional[str] = Field(
        default=None,
        description="Exact date of birth, supplied only on a re-ask (ASK flow).",
    )


class VerifyAgeResponse(BaseModel):
    """
    ASK is a robustness path: a bare birth year on the exact 18/19 boundary is ambiguous by one year, so we ask for the
    exact date and the agent calls verify_age again.
    """

    status: Literal["PASS", "FAIL", "ASK"]
    message_for_agent: str


# Decision -> agent instruction


def build_response(result: dict) -> VerifyAgeResponse:
    decision = result["decision"]
    if decision == "PASS":
        message = (
            "The user has been approved. Warmly welcome them, let them know "
            "they're all set, and say goodbye."
        )
    elif decision == "FAIL":
        message = (
            "The user does not meet the age requirement. Politely let them "
            "know you're unable to continue, and say goodbye."
        )
    else:  # ASK
        follow_up = result.get(
            "follow_up",
            "Ask for their exact date of birth, then verify again.",
        )
        message = (
            "We can't confirm the age yet it's right on the boundary. Ask the "
            f'caller this, warmly: "{follow_up}" Then call verify_age again with '
            "the exact date of birth (as `birth_date`) or exact age they give."
        )
    return VerifyAgeResponse(status=decision, message_for_agent=message)


# Request parsing helpers

def extract_args(payload: dict) -> dict:
    """
    Retell sends one of two shapes depending on the "Payload: args only" toggle:

      * OFF (default): {"name": "<function_name>", "call": {...}, "args": {...}}
      * ON:            {"name": "Alex", "age_or_birth_year": 25}   (flat)
    """
    if isinstance(payload.get("args"), dict):
        return payload["args"]
    return payload


def verify_signature(raw_body: str, signature: Optional[str]) -> bool:
    """
    Verify the X-Retell-Signature header.
    """
    if not RETELL_API_KEY or not signature:
        return True
    try:
        from retell import Retell  # imported lazily so local dev needs no key

        return bool(
            Retell.verify(raw_body, api_key=RETELL_API_KEY, signature=signature)
        )
    except Exception as err:  # pragma: no cover - defensive
        logger.warning("Signature verification could not run: %s", err)
        return False


# Routes

@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/webhook/verify-age")
async def verify_age(request: Request) -> JSONResponse:
    # 1) Read the raw body once needed for signature verification.
    raw_body = (await request.body()).decode("utf-8")
    signature = request.headers.get("X-Retell-Signature")

    if not verify_signature(raw_body, signature):
        logger.warning("Rejected request: invalid Retell signature.")
        return JSONResponse(status_code=401, content={"message": "Unauthorized"})

    # 2) Parse JSON and pull out the function arguments.
    try:
        payload = json.loads(raw_body) if raw_body else {}
        args = extract_args(payload)
        data = AgeGateArgs(**args)
    except (json.JSONDecodeError, ValidationError, TypeError) as err:
        # Fail safe: if we can't read the input, the caller does not pass.
        logger.warning("Bad payload (%s) -> FAIL", err)
        response = build_response({"decision": "FAIL"})
        return JSONResponse(status_code=200, content=response.model_dump())

    # 3) Compute the decision robustly (see age_gate.py).
    result = evaluate(
        name=data.name,
        age_or_birth_year=data.age_or_birth_year,
        birth_date=data.birth_date,
    )

    # 4) REQUIRED: print the final decision. For the border case (ASK) the age
    #    is a one-year range until the caller confirms.
    age_str = (
        result["age"]
        if result.get("age") is not None
        else ("-".join(map(str, result["age_range"])) if result.get("age_range") else "?")
    )
    logger.info(
        "%s - Calculated Age: %s - Result: %s",
        result.get("name") or data.name,
        age_str,
        result["decision"],
    )

    # 5) Tell the agent what to do next.
    response = build_response(result)
    return JSONResponse(status_code=200, content=response.model_dump())
