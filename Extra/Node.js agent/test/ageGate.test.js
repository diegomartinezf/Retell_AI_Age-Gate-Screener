import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAge, parseName, evaluate } from "../src/ageGate.js";
import { extractFromTranscript } from "../src/extract.js";

test("parseAge: digits", () => {
  assert.equal(parseAge("25"), 25);
  assert.equal(parseAge("I'm 25 years old"), 25);
  assert.equal(parseAge("age 7"), 7);
});

test("parseAge: spoken words", () => {
  assert.equal(parseAge("twenty-five"), 25);
  assert.equal(parseAge("twenty five"), 25);
  assert.equal(parseAge("eighteen"), 18);
  assert.equal(parseAge("nineteen"), 19);
  assert.equal(parseAge("forty"), 40);
  assert.equal(parseAge("I am thirty two"), 32);
});

test("parseAge: unparseable / refused", () => {
  assert.equal(parseAge(""), null);
  assert.equal(parseAge("I'd rather not say"), null);
  assert.equal(parseAge(null), null);
});

test("parseName: strips lead-ins and title-cases", () => {
  assert.equal(parseName("my name is alex"), "Alex");
  assert.equal(parseName("I'm Maria Garcia"), "Maria Garcia");
  assert.equal(parseName("this is JOHN"), "John");
  assert.equal(parseName("hello, it's sam"), "Sam");
});

test("evaluate: strict > 18 boundary", () => {
  assert.equal(evaluate({ name: "A", age: 19 }).decision, "PASS");
  assert.equal(evaluate({ name: "A", age: 18 }).decision, "FAIL"); // boundary
  assert.equal(evaluate({ name: "A", age: 17 }).decision, "FAIL");
  assert.equal(evaluate({ name: "A", age: "twenty" }).decision, "PASS");
  assert.equal(evaluate({ name: "A", age: "eighteen" }).decision, "FAIL");
});

test("evaluate: missing age fails safe", () => {
  const r = evaluate({ name: "A", age: null });
  assert.equal(r.decision, "FAIL");
  assert.equal(r.age, null);
});

test("extractFromTranscript: full conversation", () => {
  const transcript = [
    "Agent: Hi! What is your name?",
    "User: My name is Alex.",
    "Agent: Thanks, Alex. And what is your age?",
    "User: I'm twenty-five.",
    "Agent: Perfect, goodbye!",
  ].join("\n");
  const { name, age } = extractFromTranscript(transcript);
  assert.equal(name, "Alex");
  assert.equal(age, 25);
  assert.equal(evaluate({ name, age }).decision, "PASS");
});

test("extractFromTranscript: 18-year-old fails", () => {
  const transcript = [
    "Agent: What is your name?",
    "User: Jordan",
    "Agent: What is your age?",
    "User: eighteen",
  ].join("\n");
  const { name, age } = extractFromTranscript(transcript);
  assert.equal(name, "Jordan");
  assert.equal(age, 18);
  assert.equal(evaluate({ name, age }).decision, "FAIL");
});
