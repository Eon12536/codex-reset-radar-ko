const test = require("node:test");
const assert = require("node:assert/strict");
global.RadarTime = require("../src/core/time.js");
const Signals = require("../src/core/signals.js");

test("promotes a future Codex quota reset announcement", () => {
  const assessment = Signals.classify({
    text: "We will reset Codex usage limits later today.",
    createdAt: "2026-07-16T10:00:00Z"
  }, { now: Date.parse("2026-07-16T10:05:00Z") });
  assert.equal(assessment.actionable, true);
  assert.equal(assessment.confidence, "high");
});

test("suppresses git reset and completed quota resets", () => {
  assert.equal(Signals.classify({ text: "git reset fixed my Codex branch" }).actionable, false);
  assert.equal(Signals.classify({ text: "Codex usage limits have now been reset" }).actionable, false);
});

test("extracts the public Dayclaw item shape", () => {
  const items = Signals.extractItems({
    items: [{
      external_id: "123",
      content: "Codex limits will reset tomorrow",
      published_at: "2026-07-16T10:00:00Z",
      metadata: { author_user_name: "example" }
    }]
  });
  assert.equal(items[0].author, "example");
  assert.match(items[0].url, /example\/status\/123/);
});
