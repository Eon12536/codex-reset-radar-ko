const test = require("node:test");
const assert = require("node:assert/strict");

global.RadarTime = require("../src/core/time.js");
global.RadarSignals = require("../src/core/signals.js");
const Sources = require("../src/core/sources.js");

test("enables four weighted public sources by default", () => {
  const sources = Sources.enabled({});
  assert.deepEqual(sources.map((source) => source.weight), [1, 0.7, 0.58, 0.35]);
});

test("turns recent, repeated milestone resets into a weighted community forecast", () => {
  const source = Sources.DEFINITIONS.find((item) => item.kind === "reset-tracker-html");
  const html = `
    <a class="cg-cell" data-date="2026-07-13" data-snippet="Codex now has 7M active users" href="https://x.com/a/status/7"></a>
    <a class="cg-cell" data-date="2026-07-14" data-snippet="Codex now has 8M active users" href="https://x.com/a/status/8"></a>
    <a class="cg-cell" data-date="2026-07-16" data-snippet="Codex now has 9M active users" href="https://x.com/a/status/9"></a>
  `;
  const items = Sources.normalize(html, source, { now: Date.parse("2026-07-19T04:00:00Z") });
  const prediction = items.find((item) => item.prediction?.target === 10_000_000);
  assert.ok(prediction);
  assert.equal(prediction.source.weight, 0.58);
  assert.equal(prediction.prediction.sampleCount, 3);
  assert.equal(prediction.eventAtHint, Date.parse("2026-07-20T00:00:00Z"));
  const assessment = RadarSignals.classify(prediction, { now: Date.parse("2026-07-19T04:00:00Z") });
  assert.equal(assessment.actionable, true);
  assert.equal(assessment.confidence, "medium");
  assert.equal(assessment.weightedScore, 5.22);
});

test("does not keep moving an overdue milestone prediction into another tomorrow", () => {
  const source = Sources.DEFINITIONS.find((item) => item.kind === "reset-tracker-html");
  const html = `
    <a class="cg-cell" data-date="2026-07-13" data-snippet="7M active users" href="https://x.com/a/status/7"></a>
    <a class="cg-cell" data-date="2026-07-14" data-snippet="8M active users" href="https://x.com/a/status/8"></a>
    <a class="cg-cell" data-date="2026-07-16" data-snippet="9M active users" href="https://x.com/a/status/9"></a>
  `;
  const items = Sources.normalize(html, source, { now: Date.parse("2026-07-21T00:00:00Z") });
  assert.equal(items.some((item) => item.prediction), false);
});

test("normalizes OpenAI Status incidents with revision-aware identifiers", () => {
  const source = Sources.DEFINITIONS.find((item) => item.kind === "statuspage");
  const [item] = Sources.normalize({
    incidents: [{
      id: "incident-1",
      name: "Codex usage limits degraded",
      created_at: "2026-07-19T01:00:00Z",
      updated_at: "2026-07-19T02:00:00Z",
      incident_updates: [{ body: "We will restore Codex usage limits later today.", created_at: "2026-07-19T02:00:00Z" }]
    }]
  }, source);
  assert.match(item.id, /incident-1:2026-07-19T02:00:00Z/);
  assert.equal(item.entityId, "status:incident-1");
  assert.equal(item.source.weight, 0.7);
});

test("normalizes GitHub rate-limit issues as low-weight community evidence", () => {
  const source = Sources.DEFINITIONS.find((item) => item.kind === "github-issues");
  const [item] = Sources.normalize([{
    id: 42,
    number: 7,
    title: "Codex quota reset expected tomorrow",
    body: "Community report",
    created_at: "2026-07-19T01:00:00Z",
    updated_at: "2026-07-19T02:00:00Z",
    html_url: "https://github.com/openai/codex/issues/7",
    user: { login: "reporter" }
  }], source);
  assert.equal(item.author, "reporter");
  assert.equal(item.entityId, "github:42");
  assert.equal(item.source.weight, 0.35);
});
