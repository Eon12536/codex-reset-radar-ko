const test = require("node:test");
const assert = require("node:assert/strict");
global.RadarTime = require("../src/core/time.js");
global.RadarUsage = require("../src/core/usage.js");
const Advice = require("../src/core/advice.js");

function usage(fiveRemaining, weeklyRemaining, fiveResetHours = 1, weeklyResetDays = 5) {
  const now = Date.now();
  return {
    windows: [
      { kind: "fiveHour", remainingPercent: fiveRemaining, resetAt: now + fiveResetHours * 3600000 },
      { kind: "weekly", remainingPercent: weeklyRemaining, resetAt: now + weeklyResetDays * 86400000 }
    ],
    allowed: true,
    limitReached: false
  };
}

test("official high-confidence signal tells user to hold credits", () => {
  const advice = Advice.make({
    usage: usage(18, 31),
    credits: { availableCount: 2, credits: [] },
    signal: { assessment: { actionable: true, confidence: "high", eventAt: Date.now() + 8 * 3600000 } }
  });
  assert.equal(advice.tier, "signal");
});

test("expiring credit overrides conservative hold advice", () => {
  const advice = Advice.make({
    usage: usage(80, 8),
    credits: { availableCount: 1, credits: [{ expiresAt: Date.now() + 9 * 3600000 }] }
  });
  assert.equal(advice.tier, "expiring");
});

test("low five-hour window with nearby refill waits", () => {
  const advice = Advice.make({
    usage: usage(5, 80, 1),
    credits: { availableCount: 1, credits: [] }
  });
  assert.equal(advice.tier, "wait");
});

test("blocked state takes highest priority", () => {
  const current = usage(80, 80);
  current.limitReached = true;
  const advice = Advice.make({ usage: current, credits: { availableCount: 1, credits: [] } });
  assert.equal(advice.tier, "blocked");
});
