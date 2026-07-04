
"""This is the age-screen code the only Strict rule is that the age must be > 18 to PASS.

The code is flexible and accepts the caller's age answer in several forms, in order of precision:
  1. A stated age            — "I'm 25", "my age is 28", "twenty-five"
  2. A full date of birth    — "March 5, 1998", "1998-03-05", "3/5/1998" (M/D/Y)
  3. A birth year only       — "born in 1996", or the integer 1996   -> age ± 1

A birth year alone is uncertain by one year (we don't know whether this year's
birthday has already happened). That only matters at the 18/19 border, where we
return decision "ASK" with a follow-up question. Everywhere else the year is
decisive.

"""

import re
from datetime import datetime
from typing import Optional, Union

# Constants


MIN_AGE = 0
MAX_AGE = 120
MIN_BIRTH_YEAR = 1900
BIRTH_YEAR_THRESHOLD = 1000  # >= this are read as a year

ONES = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19,
}
TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
    "seventy": 70, "eighty": 80, "ninety": 90,
}

# Month names -> 1..12.
MONTHS = {
    "jan": 1, "january": 1,
    "feb": 2, "february": 2,
    "mar": 3, "march": 3,
    "apr": 4, "april": 4,
    "may": 5,
    "jun": 6, "june": 6,
    "jul": 7, "july": 7,
    "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10,
    "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}

# Age cues, in priority order. Each anchors a number to an explicit age marker,
# so a phrase with several numbers ("I have 2 kids and my age is 28") resolves
# to the AGE (28), never an incidental count (2).
AGE_CUES = [
    re.compile(r"\bmy age\s*(?:is|=|:)?\s*(\d{1,3})\b", re.I),
    re.compile(r"\bage[d]?\s*(?:is|:|=|of)?\s*(\d{1,3})\b", re.I),
    re.compile(r"\b(?:i['’]?m|i am|im)\s+(\d{1,3})\b", re.I),
    re.compile(r"\bturn(?:ed|ing)?\s+(\d{1,3})\b", re.I),
    re.compile(r"\b(\d{1,3})\s*(?:years?|yrs?|y[/. ]?o)(?:\s+old)?\b", re.I),
]

REFUSAL = re.compile(
    r"\b(rather not|prefer not|won['’]?t say|won['’]?t tell|not gonna say|"
    r"not going to say|do(?:n['’]?t| not) want|none of your|no comment|decline|"
    r"not telling|not comfortable)\b",
    re.I,
)

FOLLOWUP = (
    "Just to confirm — have you already had your birthday this year? "
    "If you're not sure, what's your exact date of birth?"
)


def _is_plausible_age(n) -> bool:
    return isinstance(n, int) and MIN_AGE <= n <= MAX_AGE


# Number words (English: ones, teens, tens, hundreds)

def _eval_number_run(words, start):
    current = 0
    started = False
    for i in range(start, len(words)):
        w = words[i]
        if w in ONES:
            current += ONES[w]
            started = True
        elif w in TENS:
            current += TENS[w]
            started = True
        elif w == "hundred":
            current = (current or 1) * 100
            started = True
        elif w == "and" and started:
            continue
        elif w in ("a", "an") and i + 1 < len(words) and words[i + 1] == "hundred":
            current += 1
            started = True
        else:
            break
    return current if started else None


def _first_word_number(words):
    for i, w in enumerate(words):
        if w in ONES or w in TENS or w == "hundred":
            return _eval_number_run(words, i)
    return None


# Parsers


def parse_age(raw) -> Optional[int]:
    """Parse a directly-stated age (digits or English words). None if not found."""
    if raw is None:
        return None
    text = str(raw).lower()

    # 1) Anchored cues first — robust to phrases with several numbers.
    for cue in AGE_CUES:
        m = cue.search(text)
        if m:
            n = int(m.group(1))
            if _is_plausible_age(n):
                return n

    # 2) English number words ("twenty-five").
    words = re.sub(r"[^\w\s-]", " ", text).replace("-", " ").split()
    wn = _first_word_number(words)
    if wn is not None and _is_plausible_age(wn):
        return wn

    # 3) Fallback: first standalone number in a plausible age range.
    for d in re.findall(r"\b\d{1,3}\b", text):
        n = int(d)
        if _is_plausible_age(n):
            return n
    return None


def _make_date(y, mo, d):
    if not (y >= MIN_BIRTH_YEAR and 1 <= mo <= 12 and 1 <= d <= 31):
        return None
    try:
        datetime(y, mo, d)  # rejects e.g. Feb 30
    except ValueError:
        return None
    return (y, mo, d)


def parse_birth_date(raw):
    """Parse a full date of birth. Returns (y, m, d) or None."""
    if raw is None:
        return None
    text = str(raw).lower()

    # ISO: 1998-03-05 or 1998/03/05
    m = re.search(r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b", text)
    if m:
        return _make_date(int(m.group(1)), int(m.group(2)), int(m.group(3)))

    # Numeric with 4-digit year at the end, US month-first: 3/5/1998, 03-05-1998
    m = re.search(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b", text)
    if m:
        a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        mon, day = a, b  # US default M/D; flip only if the month is impossible
        if a > 12 and b <= 12:
            mon, day = b, a
        return _make_date(y, mon, day)

    month_alt = "|".join(MONTHS.keys())
    # month day year: "March 5, 1998", "March 5th 1998"
    m = re.search(
        rf"\b({month_alt})\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s+(\d{{4}})\b", text
    )
    if m:
        return _make_date(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2)))
    # day month year: "5 March 1998"
    m = re.search(
        rf"\b(\d{{1,2}})\s+({month_alt})\s+(\d{{4}})\b", text
    )
    if m:
        return _make_date(int(m.group(3)), MONTHS[m.group(2)], int(m.group(1)))
    return None


def parse_birth_year(raw, today: datetime) -> Optional[int]:
    """Parse a standalone 4-digit birth year. Returns the year or None."""
    if raw is None:
        return None
    this_year = today.year
    for y in re.findall(r"\b(\d{4})\b", str(raw)):
        yi = int(y)
        if MIN_BIRTH_YEAR <= yi <= this_year:
            return yi
    return None


def _age_on_date(dob, today: datetime) -> int:
    y, mo, d = dob
    age = today.year - y
    before_birthday = (today.month, today.day) < (mo, d)
    if before_birthday:
        age -= 1
    return age


def resolve_age(raw: Union[int, str, None], today: datetime):
    """
    Resolve an age from any supported form. Returns one of:
      {"refused": True}
      {"exact": True, "age": n}
      {"exact": False, "min": m, "max": M}   # birth-year only (± 1 year)
      None                                    # nothing usable
    """
    if raw is None:
        return None

    # Numeric input: distinguish a plausible age from a 4-digit year.
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        n = int(raw)
        if n >= BIRTH_YEAR_THRESHOLD:
            if MIN_BIRTH_YEAR <= n <= today.year:
                mx = today.year - n
                return {"exact": False, "min": mx - 1, "max": mx}
            return None
        return {"exact": True, "age": n} if _is_plausible_age(n) else None

    text = str(raw)
    if REFUSAL.search(text):
        return {"refused": True}

    # 1) Full date of birth -> exact age (most precise).
    dob = parse_birth_date(text)
    if dob:
        age = _age_on_date(dob, today)
        if _is_plausible_age(age):
            return {"exact": True, "age": age}

    # 2) Directly stated age.
    stated = parse_age(text)
    if stated is not None:
        return {"exact": True, "age": stated}

    # 3) Birth year only -> a one-year range.
    year = parse_birth_year(text, today)
    if year is not None:
        mx = today.year - year
        return {"exact": False, "min": mx - 1, "max": mx}

    return None



# Name

NAME_LEADINS = re.compile(
    r"^\s*(?:(?:hi|hello|hey|yeah|yes|yep|um+|uh+|so|well|ok|okay)"
    r"[\s,.!-]*)+",
    re.I,
)
NAME_INTRO = re.compile(
    r"^\s*(?:my name(?:['’]s| is)|this is|i am|i['’]?m|it(?:['’]s| is)|"
    r"the name(?:['’]s| is)|they call me|(?:you can )?call me)\s+",
    re.I,
)
NAME_STOP = {
    "and", "but", "i", "im", "from", "the", "is", "was", "a", "an", "calling",
    "here", "speaking", "how", "are", "you", "thanks", "thank", "no", "nope",
    "nah", "not", "don't", "dont", "want", "rather", "prefer", "my", "name",
}
NAME_TOKEN = re.compile(r"^[^\W\d_][\w'’.\-]*$", re.UNICODE)


def _title_case(word: str) -> str:
    return re.sub(
        r"\w+", lambda m: m.group(0)[:1].upper() + m.group(0)[1:].lower(), word
    )


def parse_name(raw) -> Optional[str]:
    """Extract a plausible name. Returns a title-cased name or None."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text or REFUSAL.search(text):
        return None

    text = NAME_LEADINS.sub("", text)
    text = NAME_INTRO.sub("", text)
    text = NAME_LEADINS.sub("", text)
    if not text:
        return None

    out = []
    for token in text.split():
        token = re.sub(r"^[^\w'’.\-]+|[^\w'’.\-]+$", "", token)
        low = token.lower()
        usable = len(token) >= 1 and NAME_TOKEN.match(token) and low not in NAME_STOP
        if not usable:
            if out:
                break
            continue
        out.append(token)
        if len(out) >= 4:
            break
    return " ".join(_title_case(t) for t in out) if out else None



# Decision

def evaluate(name, age_or_birth_year, birth_date=None, today: Optional[datetime] = None):
    """
    Compute the age-gate decision. Strict: age must be > 18 to PASS.

    Returns a dict with keys: decision ("PASS" | "FAIL" | "ASK"), name, age,
    age_range, follow_up (only for ASK), reason.

    birth_date is an optional exact that the caller gives on a re-ask; it takes
    priority because it removes the ±1-year uncertainty of a bare birth year.
    """
    today = today or datetime.now()
    parsed_name = parse_name(name)

    # An exact DOB supplied on a re-ask resolves the border case outright.
    resolved = None
    if birth_date is not None:
        dob = parse_birth_date(birth_date)
        if dob:
            age = _age_on_date(dob, today)
            if _is_plausible_age(age):
                resolved = {"exact": True, "age": age}
    if resolved is None:
        resolved = resolve_age(age_or_birth_year, today)

    if resolved is None or resolved.get("refused"):
        return {
            "decision": "FAIL",
            "name": parsed_name,
            "age": None,
            "reason": "Age was refused by the caller."
            if resolved and resolved.get("refused")
            else "Age was missing or could not be parsed.",
        }

    if resolved.get("exact"):
        age = resolved["age"]
        decision = "PASS" if age > 18 else "FAIL"
        return {
            "decision": decision,
            "name": parsed_name,
            "age": age,
            "reason": f"Age {age} is greater than 18."
            if decision == "PASS"
            else f"Age {age} is not greater than 18 (must be over 18 to pass).",
        }

    # Birth-year only: min..max spans one year.
    mn, mx = resolved["min"], resolved["max"]
    if mn > 18:
        return {
            "decision": "PASS", "name": parsed_name, "age": None,
            "age_range": [mn, mx],
            "reason": f"Born that year makes them {mn}-{mx}, which is over 18.",
        }
    if mx <= 18:
        return {
            "decision": "FAIL", "name": parsed_name, "age": None,
            "age_range": [mn, mx],
            "reason": f"Born that year makes them at most {mx}, not over 18.",
        }
    return {
        "decision": "ASK",
        "name": parsed_name,
        "age": None,
        "age_range": [mn, mx],
        "follow_up": FOLLOWUP,
        "reason": (
            f"Born that year makes them {mn} or {mx} right on the 18/19 line. "
            "Need the exact date of birth or exact age."
        ),
    }
