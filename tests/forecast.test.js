const test = require("node:test");
const assert = require("node:assert/strict");

global.RadarTime = require("../src/core/time.js");
global.RadarSignals = require("../src/core/signals.js");
const Forecast = require("../src/core/forecast.js");

test("places the highest probability in the six-hour slot around an active signal", () => {
  const now = Date.parse("2026-07-19T00:00:00Z");
  const eventAt = Date.parse("2026-07-19T12:00:00Z");
  const forecast = Forecast.build({
    now,
    timeZone: "Asia/Shanghai",
    signal: {
      createdAt: now,
      assessment: { actionable: true, confidence: "high", score: 9, eventAt }
    }
  });
  const strongest = [...forecast.slots].sort((a, b) => b.probability - a.probability)[0];
  assert.equal(forecast.totalProbability, 88);
  assert.equal(forecast.basis, "public-signal");
  assert.ok(strongest.startAt <= eventAt && strongest.endAt >= eventAt);
});

test("aligns forecast slots to local six-hour periods", () => {
  const now = Date.parse("2026-07-19T13:25:00Z");
  const [first] = Forecast.slotBoundaries(now, "Asia/Shanghai", 6);
  assert.equal(global.RadarTime.formatTime(first.startAt, "Asia/Shanghai", "en-GB"), "18:00");
  assert.equal(global.RadarTime.formatTime(first.endAt, "Asia/Shanghai", "en-GB"), "00:00");
});

test("uses a visibly low baseline when no active public signal exists", () => {
  const forecast = Forecast.build({
    now: Date.parse("2026-07-19T00:00:00Z"),
    timeZone: "UTC",
    signal: null
  });
  assert.equal(forecast.totalProbability, 8);
  assert.equal(forecast.basis, "baseline");
  assert.ok(forecast.slots.every((slot) => slot.probability <= 1));
});
