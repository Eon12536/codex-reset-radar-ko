const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("worker emits Korean signal notifications, preserves deduplication and queues Korean quiet-hour messages", async () => {
  const src = path.resolve(__dirname, "../src");
  const state = { settings: { quietHoursEnabled: false, timezoneMode: "manual", timezoneOverride: "Asia/Seoul" } };
  const delivered = [];
  const event = { addListener() {} };
  const context = vm.createContext({
    Intl, Date, URL, console,
    chrome: {
      i18n: { getUILanguage: () => "zh-CN", getMessage: () => "中文消息" },
      storage: { local: {
        get: async (key) => Array.isArray(key) ? Object.fromEntries(key.map(k => [k, state[k]])) : ({ [key]: state[key] }),
        set: async (values) => Object.assign(state, values)
      } },
      runtime: { onInstalled: event, onStartup: event, onMessage: event, getURL: p => 'chrome-extension://audit-extension/' + p },
      alarms: { onAlarm: event },
      notifications: {
        onClicked: event, onButtonClicked: event,
        getAll: async () => Object.fromEntries(delivered.map(item => [item.id, item.options])),
        create: async (id, options) => delivered.push({ id, options })
      }
    }
  });
  context.importScripts = (...files) => files.forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(src, file), "utf8"), context, { filename: file });
  });
  vm.runInContext(fs.readFileSync(path.join(src, "background.js"), "utf8"), context);
  const signal = { id: "ko-test", createdAt: new Date().toISOString(), assessment: { confidence: "high", eventAt: Date.parse("2026-09-17T00:00:00Z") } };
  await context.maybeNotifySignal(signal);
  await context.maybeNotifySignal(signal);
  assert.equal(delivered.length, 1);
  const { options } = delivered[0];
  assert.match(options.title, /Codex.*리셋/);
  assert.match(options.title, /오전 9:00/);
  assert.match(options.message, /실제 한도 회복은 Codex에서 확인하세요/);
  assert.equal(options.contextMessage, "Codex 리셋 레이더");
  assert.deepEqual(Array.from(options.buttons, (button) => button.title), ["근거 보기", "나중에 알림"]);
  assert.doesNotMatch(JSON.stringify(options), /\p{Script=Han}/u);

  const parts = new Intl.DateTimeFormat("en-GB", {timeZone:"Asia/Seoul", hour:"2-digit", minute:"2-digit", hourCycle:"h23"}).formatToParts(new Date());
  const time = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minute = Number(time.hour) * 60 + Number(time.minute);
  const hhmm = (offset) => {
    const value = (minute + offset + 1440) % 1440;
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  };
  Object.assign(state.settings, { quietHoursEnabled: true, quietStart: hhmm(-30), quietEnd: hhmm(30) });
  await context.maybeNotifySignal({ ...signal, id: "ko-quiet" });
  assert.equal(delivered.length, 1);
  assert.equal(state.pendingNotifications.length, 1);
  assert.match(state.pendingNotifications[0].options.title, /리셋/);
  state.settings.quietHoursEnabled = false;
  state.signalSnapshot = { activeSignals: [{ ...signal, id: 'ko-quiet' }] };
  await context.flushPendingNotifications();
  assert.equal(delivered.length, 2);
  assert.equal(state.pendingNotifications.length, 0);
});
