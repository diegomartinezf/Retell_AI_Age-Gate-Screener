/**
 * ageGate.js
 * -----------
 * Pure, dependency-free age-gate logic. Strict rule: age must be > 18 to PASS.
 *
 * Accepts the age three ways, in order of precision:
 *   1. A stated age            — "I'm 25", "twenty-five", "34 years old"
 *   2. A full date of birth    — "March 5 1990", "05/03/2008", "1990-03-05"  -> exact age
 *   3. A birth year only       — "I was born in 1996"                        -> age ± 1
 *
 * A birth year alone is uncertain by one year (we don't know if the birthday
 * already happened this year). That only matters at the 18/19 border, where we
 * return decision "ASK" with a follow-up question ("have you turned 19 yet, or
 * what's your exact date of birth?"). Everywhere else the year is decisive.
 *
 * `today` is injectable for testing; it defaults to the real current date.
 */

const ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};

const MIN_AGE = 0;
const MAX_AGE = 120;
const MIN_BIRTH_YEAR = 1900;

// Month names (English + Spanish) -> 1..12.
const MONTHS = {
  jan: 1, january: 1, ene: 1, enero: 1,
  feb: 2, february: 2, febrero: 2,
  mar: 3, march: 3, marzo: 3,
  apr: 4, april: 4, abr: 4, abril: 4,
  may: 5, mayo: 5,
  jun: 6, june: 6, junio: 6,
  jul: 7, july: 7, julio: 7,
  aug: 8, august: 8, ago: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, septiembre: 9, setiembre: 9,
  oct: 10, october: 10, octubre: 10,
  nov: 11, november: 11, noviembre: 11,
  dec: 12, december: 12, dic: 12, diciembre: 12,
};

const AGE_CUES = [
  /\b(?:i['’]?m|i am|im)\s+(\d{1,3})\b/i,
  /\bage[d]?\s*(?:is|:|=|of)?\s*(\d{1,3})\b/i,
  /\bturn(?:ed|ing)?\s+(\d{1,3})\b/i,
  /\b(\d{1,3})\s*(?:years?|yrs?|y[/. ]?o)\b/i,
];

const REFUSAL =
  /\b(rather not|prefer not|won['’]?t say|won['’]?t tell|not gonna say|not going to say|do(?:n['’]?t| not) want|none of your|no comment|decline|not telling|not comfortable|no quiero|prefiero no)\b/i;

const isPlausibleAge = (n) => Number.isFinite(n) && n >= MIN_AGE && n <= MAX_AGE;

// ---------- number words (ones, teens, tens, hundreds) ----------
function evalNumberRun(words, start) {
  let current = 0;
  let started = false;
  for (let i = start; i < words.length; i++) {
    const w = words[i];
    if (w in ONES) { current += ONES[w]; started = true; }
    else if (w in TENS) { current += TENS[w]; started = true; }
    else if (w === "hundred") { current = (current || 1) * 100; started = true; }
    else if (w === "and" && started) { continue; }
    else if ((w === "a" || w === "an") && words[i + 1] === "hundred") { current += 1; started = true; }
    else break;
  }
  return started ? current : null;
}
function firstWordNumber(words) {
  for (let i = 0; i < words.length; i++) {
    if (words[i] in ONES || words[i] in TENS || words[i] === "hundred") {
      return evalNumberRun(words, i);
    }
  }
  return null;
}

/** Parse a directly-stated age (digits or words). Returns a number or null. */
export function parseAge(raw) {
  if (raw == null) return null;
  const text = String(raw).toLowerCase();

  for (const re of AGE_CUES) {
    const m = text.match(re);
    if (m) {
      const n = Number(m[1]);
      if (isPlausibleAge(n)) return n;
    }
  }

  const words = text
    .replace(/[^\p{L}\s-]/gu, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const wordNumber = firstWordNumber(words);
  if (wordNumber != null && isPlausibleAge(wordNumber)) return wordNumber;

  const digitMatches = text.match(/\b\d{1,3}\b/g);
  if (digitMatches) {
    for (const d of digitMatches) {
      const n = Number(d);
      if (isPlausibleAge(n)) return n;
    }
  }
  return null;
}

// ---------- dates ----------
function makeDate(y, m, d) {
  if (!(y >= MIN_BIRTH_YEAR && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null; // rejects e.g. Feb 30
  }
  return { y, m, d };
}

/** Parse a full date of birth. Returns {y,m,d} or null. */
export function parseBirthDate(raw) {
  if (raw == null) return null;
  const text = String(raw).toLowerCase();

  // ISO: 1990-03-05 or 1990/03/05
  let m = text.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return makeDate(+m[1], +m[2], +m[3]);

  // Numeric with a 4-digit year at the end: 05/03/2008, 3-5-1990, 05.03.2008
  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (m) {
    let a = +m[1], b = +m[2];
    const y = +m[3];
    // Disambiguate D/M vs M/D: default D/M (international); flip if impossible.
    let day = a, mon = b;
    if (a > 12 && b <= 12) { day = a; mon = b; }
    else if (b > 12 && a <= 12) { day = b; mon = a; }
    return makeDate(y, mon, day);
  }

  // Textual month: "march 5 1990", "5 de marzo de 1990", "march 5, 1990"
  const monthAlt = Object.keys(MONTHS).join("|");
  // day month year
  m = text.match(new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?(${monthAlt})\\s+(?:de\\s+)?(\\d{4})\\b`, "i"));
  if (m) return makeDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  // month day year
  m = text.match(new RegExp(`\\b(${monthAlt})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "i"));
  if (m) return makeDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);

  return null;
}

/** Parse a birth year on its own. Returns a 4-digit year or null. */
export function parseBirthYear(raw, today = new Date()) {
  if (raw == null) return null;
  const thisYear = today.getFullYear();
  const years = (String(raw).match(/\b(\d{4})\b/g) || [])
    .map(Number)
    .filter((y) => y >= MIN_BIRTH_YEAR && y <= thisYear);
  return years.length ? years[0] : null;
}

function ageOnDate({ y, m, d }, today) {
  let age = today.getFullYear() - y;
  const beforeBirthday =
    today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * Resolve an age from any supported form.
 * Returns one of:
 *   { refused: true }
 *   { exact: true, age }
 *   { exact: false, min, max }          // birth-year only
 *   null                                // nothing usable
 */
export function resolveAge(raw, today = new Date()) {
  if (raw == null) return null;
  if (typeof raw === "number") {
    return isPlausibleAge(raw) ? { exact: true, age: raw } : null;
  }
  const text = String(raw);
  if (REFUSAL.test(text)) return { refused: true };

  // 1) Full date of birth -> exact age (most precise; also avoids misreading
  //    date parts as an age).
  const dob = parseBirthDate(text);
  if (dob) {
    const age = ageOnDate(dob, today);
    if (isPlausibleAge(age)) return { exact: true, age };
  }

  // 2) Directly stated age.
  const stated = parseAge(text);
  if (stated != null) return { exact: true, age: stated };

  // 3) Birth year only -> a one-year range.
  const year = parseBirthYear(text, today);
  if (year != null) {
    const max = today.getFullYear() - year;
    const min = max - 1;
    return { exact: false, min, max };
  }

  return null;
}

// ---------- name ----------
const NAME_LEADINS =
  /^\s*(?:(?:hi|hello|hey|yeah|yes|yep|um+|uh+|so|well|ok|okay|hola|buenas)[\s,.!-]*)+/i;
const NAME_INTRO =
  /^\s*(?:my name(?:['’]s| is)|this is|i am|i['’]?m|it(?:['’]s| is)|the name(?:['’]s| is)|they call me|(?:you can )?call me|me llamo|mi nombre es|soy)\s+/i;
const NAME_STOP = new Set([
  "and", "but", "i", "im", "from", "the", "is", "was", "a", "an", "calling",
  "here", "speaking", "how", "are", "you", "thanks", "thank", "no", "nope",
  "nah", "not", "don't", "dont", "want", "rather", "prefer", "my", "name",
  "y", "de", "soy", "no",
]);
// Letters (any script), combining marks, apostrophes, hyphen, period.
const NAME_TOKEN = /^[\p{L}\p{M}][\p{L}\p{M}'’.\-]*$/u;

function titleCase(word) {
  return word.replace(/\p{L}+/gu, (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
}

/** Extract a plausible name. Returns a title-cased name or null. */
export function parseName(raw) {
  if (raw == null) return null;
  let text = String(raw).trim();
  if (!text || REFUSAL.test(text)) return null;

  text = text.replace(NAME_LEADINS, "").replace(NAME_INTRO, "").replace(NAME_LEADINS, "");
  if (!text) return null;

  const out = [];
  for (let token of text.split(/\s+/)) {
    token = token.replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}'’.\-]+$/gu, "");
    const low = token.toLowerCase();
    const usable = token.length >= 1 && NAME_TOKEN.test(token) && !NAME_STOP.has(low);
    if (!usable) {
      if (out.length) break;
      continue;
    }
    out.push(token);
    if (out.length >= 4) break;
  }
  return out.length ? out.map(titleCase).join(" ") : null;
}

// ---------- decision ----------
const FOLLOWUP =
  "Just to confirm — have you already turned 19? If you're not sure, what's your exact date of birth?";

/**
 * Compute the age-gate decision. Strict: age must be > 18 to PASS.
 *
 * decision:
 *   "PASS"  age is definitely > 18
 *   "FAIL"  age is definitely <= 18, missing, or refused
 *   "ASK"   birth year lands on the 18/19 border — ask `followUpQuestion`,
 *           then call evaluate again with the answer.
 */
export function evaluate({ name, age, today = new Date() } = {}) {
  const parsedName = parseName(name);
  const resolved = resolveAge(age, today);

  if (resolved == null || resolved.refused) {
    return {
      decision: "FAIL",
      name: parsedName,
      age: null,
      reason: resolved?.refused
        ? "Age was refused by the caller."
        : "Age was missing or could not be parsed.",
    };
  }

  if (resolved.exact) {
    const decision = resolved.age > 18 ? "PASS" : "FAIL";
    return {
      decision,
      name: parsedName,
      age: resolved.age,
      reason:
        decision === "PASS"
          ? `Age ${resolved.age} is greater than 18.`
          : `Age ${resolved.age} is not greater than 18 (must be over 18 to pass).`,
    };
  }

  // Birth-year only: min..max spans one year.
  const { min, max } = resolved;
  if (min > 18) {
    return { decision: "PASS", name: parsedName, age: null, ageRange: [min, max],
      reason: `Born that year makes them ${min}–${max}, which is over 18.` };
  }
  if (max <= 18) {
    return { decision: "FAIL", name: parsedName, age: null, ageRange: [min, max],
      reason: `Born that year makes them at most ${max}, which is not over 18.` };
  }
  return {
    decision: "ASK",
    name: parsedName,
    age: null,
    ageRange: [min, max],
    followUpQuestion: FOLLOWUP,
    reason: `Born that year makes them ${min} or ${max} — right on the 18/19 line. Need the exact date.`,
  };
}