const test = require("node:test");
const assert = require("node:assert/strict");
const Time = require("../src/core/time.js");

test("seconds and milliseconds resolve to the same timestamp", () => {
  assert.equal(Time.parseTimestamp(1_800_000_000), Time.parseTimestamp(1_800_000_000_000));
});

test("manual valid timezone overrides system timezone", () => {
  assert.equal(Time.resolveTimeZone({ timezoneMode: "manual", timezoneOverride: "Asia/Shanghai" }), "Asia/Shanghai");
});

test("invalid manual timezone falls back safely", () => {
  assert.equal(
    Time.resolveTimeZone({ timezoneMode: "manual", timezoneOverride: "Mars/Olympus" }),
    Time.systemTimeZone()
  );
});

test("quiet hours support overnight windows", () => {
  const settings = {
    quietHoursEnabled: true,
    quietStart: "23:00",
    quietEnd: "08:00",
    timezoneMode: "manual",
    timezoneOverride: "UTC"
  };
  assert.equal(Time.isQuietHours(settings, Date.parse("2026-07-16T23:30:00Z")), true);
  assert.equal(Time.isQuietHours(settings, Date.parse("2026-07-16T12:00:00Z")), false);
});
