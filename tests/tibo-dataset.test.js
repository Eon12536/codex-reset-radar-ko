const test = require("node:test");
const assert = require("node:assert/strict");
global.RadarTime = require("../src/core/time.js");
const Signals = require("../src/core/signals.js");
const fixture = require("./fixtures/tibo-curated-excerpts.json");

// These timestamps place each excerpt in the live freshness window. This is a
// rule regression, not a historical replay or an accuracy/lead-time benchmark.
const NOW = Date.parse("2026-09-17T06:00:00Z");
const options = { now: NOW };
function post(text, extra = {}) {
  return {
    id: "123456789",
    text,
    author: "thsottiaux",
    createdAt: new Date(NOW - 60000).toISOString(),
    source: { id: "codex-lead", weight: 1 },
    ...extra
  };
}

function assertCandidate(text, expected, label = text) {
  const assessment = Signals.classifyHint(post(text), options);
  assert.equal(assessment.candidate, expected, label);
  assert.equal(assessment.actionable, false, label);
  if (expected) {
    assert.equal(assessment.confidence, "low", label);
    assert.equal(assessment.eventAt, null, label);
  }
  return assessment;
}

test("the 24 supplied excerpts retain conservative weak-hint boundaries", () => {
  assert.equal(fixture.excerpts.length, 24);
  const expectedRules = new Map([
    ["2093573991965557198", "milestone-celebration"],
    ["2096692394435752258", "rhetorical"]
  ]);
  for (const excerpt of fixture.excerpts) {
    // Only text enters the detector. Curated stage, event outcomes, summaries,
    // and later completion posts cannot leak into the live classification.
    const expectedRule = expectedRules.get(excerpt.postId);
    const assessment = assertCandidate(
      excerpt.text,
      Boolean(expectedRule),
      `${excerpt.postId}: ${excerpt.text}`
    );
    if (expectedRule) assert.equal(assessment.rule, expectedRule);
  }
});

// All sentences below are SYNTHETIC boundary/regression inputs. They are not
// additional Tibo quotations and do not establish historical reset outcomes.
test("synthetic rhetorical variants distinguish questions from true negations", () => {
  for (const text of [
    "Who says it won't reset in a while?",
    "Who says it won’t reset in a while?",
    "Who says Codex limits won't reset in a while?"
  ]) assert.equal(assertCandidate(text, true).rule, "rhetorical");
  for (const text of [
    "Codex limits won't reset in a while.",
    "We will not reset Codex usage limits tomorrow.",
    "Who says the password won't reset in a while?",
    "Who says the database won't reset in a while?",
    "Who says it won't reset in a while? We will not reset Codex limits tomorrow."
  ]) assertCandidate(text, false);
});

test("synthetic gifts and surprises require quota context beyond a generic teaser", () => {
  for (const text of [
    "Little surprise for Codex usage tomorrow.",
    "A small gift for your Codex usage limits tomorrow.",
    "Codex quota has a little surprise coming tomorrow."
  ]) assertCandidate(text, true);
  for (const text of [
    "Little surprise for you tomorrow.",
    "A small gift for you tomorrow.",
    "A surprise gift for Codex fans tomorrow.",
    "A Codex merchandise giveaway is coming tomorrow.",
    "A surprise gift for the Codex winner tomorrow.",
    "Codex usage fans get a surprise hoodie gift tomorrow.",
    "Codex swag drops on your door handle tomorrow."
  ]) assertCandidate(text, false);
});

test("synthetic milestone hints require the celebration combination", () => {
  assertCandidate("We have a new milestone to celebrate tomorrow.", true);
  for (const text of [
    "New dashboard charts arrive tomorrow.",
    "Codex has a new dashboard tomorrow.",
    "We reached a new milestone yesterday.",
    "Codex growth numbers look good."
  ]) assertCandidate(text, false);
});

test("synthetic postponements require reset context and preserve an unknown event time", () => {
  for (const text of [
    "Codex celebration is moved to tomorrow.",
    "We already pressed the reset button today. This celebration is moved to tomorrow."
  ]) assertCandidate(text, true);
  for (const text of [
    "This celebration is moved to tomorrow.",
    "The product launch celebration is moved to tomorrow.",
    "The Codex merchandise celebration is moved to tomorrow."
  ]) assertCandidate(text, false);
});

test("synthetic conditional timing requires a reset subject without making today's promise", () => {
  for (const text of [
    "Codex reset: soon, but not today.",
    "Codex will reset soon, but not today.",
    "Not today; Codex will reset soon.",
    "The reset button? Soon, but not today."
  ]) {
    assertCandidate(text, true);
    assert.equal(Signals.classify(post(text), options).actionable, false, text);
    assert.equal(Signals.classify(post(text), options).eventAt, null, text);
    assert.match(Signals.classifyHint(post(text), options).reason, /오늘은 아님/, text);
  }
  for (const text of [
    "Soon, but not today.",
    "The hoodie giveaway is soon, but not today.",
    "We will not reset Codex usage limits today or tomorrow."
  ]) assertCandidate(text, false);
});

test("synthetic button hints need an identifiable button rather than a bare pronoun", () => {
  assertCandidate("That old reset button? I'll find it tomorrow and dust it up.", true);
  for (const text of [
    "I'll find it tomorrow and dust it up.",
    "The old password reset button? I'll find it tomorrow and dust it up.",
    "One day we created the reset button and the rest is history."
  ]) assertCandidate(text, false);
});

test("synthetic completion claims plus unrelated future news are not new reset hints", () => {
  for (const text of [
    "Codex has now been reset. Another round of product news tomorrow.",
    "Codex has now been reset. Codex could get another round of product news tomorrow.",
    "Codex limits have now been reset. Codex could have another round of funding tomorrow.",
    "All Codex limits have been reset. We have a surprise product launch tomorrow.",
    "Codex usage is brand new. We'll share the dashboard tomorrow.",
    "We reset Codex limits yesterday. A merchandise gift is coming tomorrow."
  ]) {
    assertCandidate(text, false);
    assert.equal(Signals.classify(post(text), options).actionable, false, text);
  }
});

test("synthetic uncertainty cannot promote unrelated resets or cancelled surprises", () => {
  for (const text of [
    "Maybe I should reset my keyboard tomorrow.",
    "There won't be any Codex surprise tomorrow.",
    "No milestone celebration for Codex tomorrow.",
    "We will not give Codex a fresh start tomorrow."
  ]) {
    assertCandidate(text, false);
    assert.equal(Signals.classify(post(text), options).actionable, false, text);
  }
});

test("cached old assessments cannot turn a qualified hint into an active forecast", () => {
  const cached = post("Codex will reset soon, but not today.", {
    assessment: { actionable: true, confidence: "high", eventAt: NOW + 6 * 3600000 }
  });
  assert.equal(Signals.isActive(cached, options), false);
  const valid = post("We will reset Codex usage limits later today.");
  valid.assessment = Signals.classify(valid, options);
  assert.equal(Signals.isActive(valid, { now: valid.assessment.eventAt + 3600000 }), true);
  assert.equal(Signals.isActive(valid, { now: valid.assessment.eventAt + 13 * 3600000 }), false);
});

test("synthetic completion and a separate explicit future reset retain the future promise", () => {
  const text = "Codex usage limits have now been reset. We will reset Codex limits again tomorrow.";
  assert.equal(Signals.classify(post(text), options).actionable, true);
  assertCandidate(text, false);
});

test("synthetic banked reset credit grants are not automatic usage restoration", () => {
  for (const text of [
    "We will give Codex users a banked reset credit tomorrow.",
    "A little surprise for Codex usage tomorrow: an extra banked reset credit.",
    "We will replenish your Codex reset credits tomorrow so you can redeem them later.",
    "A gift for Codex quota tomorrow: one reset credit to use when you need it."
  ]) {
    assertCandidate(text, false);
    assert.equal(Signals.classify(post(text), options).actionable, false, text);
  }
});
