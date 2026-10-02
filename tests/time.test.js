const test = require("node:test");
const assert = require("node:assert/strict");
const Time = require("../src/core/time.js");
const fs = require("node:fs");
const vm = require("node:vm");

test("Korean day periods remain localized across ICU versions without changing English", () => {
  const context = vm.createContext({
    Intl: {
      DateTimeFormat: function (locale, options) {
        const formatter = new Intl.DateTimeFormat(locale, options);
        return {
          format: value => formatter.format(value).replace(/오전/g, 'AM').replace(/오후/g, 'PM'),
          resolvedOptions: () => formatter.resolvedOptions()
        };
      }
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../src/core/time.js'), 'utf8'), context);
  for (const [hour, korean, english] of [[9, '오전', 'AM'], [21, '오후', 'PM']]) {
    const timestamp = Date.UTC(2026, 9, 3, hour);
    assert.ok(context.RadarTime.formatTime(timestamp, 'UTC', 'ko-KR').includes(korean));
    assert.ok(context.RadarTime.formatDateTime(timestamp, 'UTC', 'ko-KR').includes(korean));
    assert.ok(context.RadarTime.formatTime(timestamp, 'UTC', 'en-US').includes(english));
  }
});

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
