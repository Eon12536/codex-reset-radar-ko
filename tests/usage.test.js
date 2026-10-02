const test = require("node:test");
const assert = require("node:assert/strict");
global.RadarTime = require("../src/core/time.js");
const Usage = require("../src/core/usage.js");

test("classifies swapped usage windows by duration", () => {
  const usage = Usage.normalizeUsage({
    rate_limit: {
      primary_window: { used_percent: 37, limit_window_seconds: 604800, reset_at: 1_800_000_000 },
      secondary_window: { used_percent: 71, limit_window_seconds: 18000, reset_at: 1_800_003_600 }
    }
  });
  assert.equal(Usage.findWindow(usage, "weekly").remainingPercent, 63);
  assert.equal(Usage.findWindow(usage, "fiveHour").remainingPercent, 29);
});

test("does not invent known windows without duration", () => {
  const usage = Usage.normalizeUsage({
    rate_limit: {
      primary_window: { used_percent: 20, reset_after_seconds: 3600 },
      secondary_window: { used_percent: 40, reset_after_seconds: 7200 }
    }
  });
  assert.deepEqual(usage.windows.map((window) => window.kind), ["generic", "generic"]);
});

test("uses authoritative available count and filters redeemed credits", () => {
  const credits = Usage.normalizeCredits({
    available_count: 2,
    credits: [
      { status: "available", expires_at: "2026-07-17T10:00:00Z" },
      { status: "available", expires_at: "2026-07-18T10:00:00Z" },
      { status: "redeemed", expires_at: "2026-07-19T10:00:00Z" }
    ]
  });
  assert.equal(credits.availableCount, 2);
  assert.equal(credits.credits.length, 2);
});

test("malformed numeric fields never become a zero usage or credit reading", () => {
  for (const value of [false, true, [], [0], {}, " ", "\t"]) {
    assert.equal(Usage.normalizeWindow({ used_percent: value, limit_window_seconds: 604800 }), null);
    assert.equal(Usage.normalizeCredits({ available_count: value }), null);
    assert.equal(Usage.normalizeUsage({ rate_limit: {
      primary_window: { used_percent: value, limit_window_seconds: 604800 }
    } }), null);
    const partial = Usage.normalizeUsage({ rate_limit: {
      primary_window: { used_percent: value, limit_window_seconds: 18000 },
      secondary_window: { used_percent: 25, limit_window_seconds: 604800 }
    } });
    assert.deepEqual(partial.invalidWindowKinds, ['fiveHour']);
    assert.deepEqual(partial.windows.map(window => window.kind), ['weekly']);
  }
  assert.equal(Usage.normalizeWindow({ used_percent: "0", limit_window_seconds: "604800" }).remainingPercent, 100);
  assert.equal(Usage.normalizeCredits({ available_count: "0" }).availableCount, 0);
});
