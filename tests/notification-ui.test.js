const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/options/notification-test.js'), 'utf8');
const version = require('../manifest.json').version;
const settle = () => new Promise(resolve => setImmediate(resolve));
function page(reply, dependencies = {}) {
  const elements = Object.fromEntries(['testNotification', 'notificationTestStatus', 'notificationWorkerStatus'].map(id => [id, { textContent: '', disabled: false, addEventListener(_, fn) { this.click = fn; } }]));
  const timers = new Map(); let next = 0;
  const context = vm.createContext({ document: { getElementById: id => elements[id] },
    chrome: { runtime: { sendMessage: reply } },
    setTimeout(fn) { timers.set(++next, fn); return next; }, clearTimeout(id) { timers.delete(id); }, ...dependencies });
  vm.runInContext(source, context);
  return { elements, timers };
}
const status = { ok: true, version, permission: 'granted', hintAlerts: false, pending: 0, quiet: false };

test('startup grace is explicitly shown while real alerts are durably pending', async () => {
  const p = page(async () => ({ ...status, pending: 2, resumeReadyAt: Date.now() + 60000 }));
  await settle();
  assert.match(p.elements.notificationWorkerStatus.textContent, /대기 2개/);
  assert.match(p.elements.notificationWorkerStatus.textContent, /알림 준비 중 \(1분 대기\)/);
});

test('test UI binds and reports progress without any settings or translation dependencies', async () => {
  let release;
  const p = page(async message => message.type === 'NOTIFICATION_STATUS' ? status : new Promise(resolve => { release = resolve; }));
  assert.match(p.elements.notificationTestStatus.textContent, /준비 완료/);
  await settle(); assert.ok(p.elements.notificationWorkerStatus.textContent.includes('실행 v' + version));
  assert.match(p.elements.notificationWorkerStatus.textContent, /후보 알림 꺼짐/);
  const pending = p.elements.testNotification.click();
  assert.match(p.elements.notificationTestStatus.textContent, /테스트 버튼이 동작/);
  assert.equal(p.elements.testNotification.disabled, true);
  release({ ok: true, version }); await pending;
  assert.match(p.elements.notificationTestStatus.textContent, /Chrome이 테스트 알림을 접수/);
  assert.equal(p.elements.testNotification.disabled, false);
});

test('unresponsive worker becomes a visible timeout instead of a permanently disabled button', async () => {
  const p = page(message => message.type === 'NOTIFICATION_STATUS' ? Promise.resolve(status) : new Promise(() => {}));
  await settle(); const pending = p.elements.testNotification.click();
  p.timers.values().next().value(); await pending;
  assert.match(p.elements.notificationTestStatus.textContent, /10초/);
  assert.equal(p.elements.testNotification.disabled, false);
});

test('old worker replies and disconnected pages are diagnosed explicitly', async () => {
  const old = page(async () => ({ ...status, version: '0.2.18' }));
  await settle(); assert.match(old.elements.notificationWorkerStatus.textContent, /실행 코드 확인 불가/);
  await old.elements.testNotification.click();
  assert.match(old.elements.notificationTestStatus.textContent, /최신 버전과 연결되지/);
  const disconnected = page(async () => { throw new Error('Extension context invalidated'); });
  await settle(); await disconnected.elements.testNotification.click();
  assert.match(disconnected.elements.notificationTestStatus.textContent, /설정 탭을 닫고/);
});

test('denial and image rejection do not appear as successful delivery', async () => {
  for (const [reason, text] of [['denied', /차단/], ['image', /내장 아이콘 처리에 실패/]]) {
    const p = page(async message => message.type === 'NOTIFICATION_STATUS' ? status : { ok: false, reason, version });
    await p.elements.testNotification.click();
    assert.match(p.elements.notificationTestStatus.textContent, text);
  }
});

test('real delivery time and exclusions remain visible after a successful test alert', async () => {
  const p = page(async () => ({ ...status, hintAlerts: true,
    delivery: { test: true, status: 'accepted' },
    realDelivery: { test: false, status: 'failed', at: Date.parse('2026-09-29T03:00:00Z') },
    publicAlerts: { pending: 1, handled: 2, expired: 3, disabled: 0, eligible: 0 }
  }));
  await settle();
  assert.match(p.elements.notificationWorkerStatus.textContent, /실제 알림:.*전송 실패/);
  assert.match(p.elements.notificationWorkerStatus.textContent, /대기 1 \/ 처리 기록 2 \/ 기존·기한 지난 글 3/);
});

test('diagnostics wait for country preferences and update time after a country change', async () => {
  let release, changed, locale = 'en-US', zone = 'America/New_York', calls = 0;
  const ready = new Promise(resolve => { release = resolve; });
  const p = page(async () => {
    calls++;
    return { ...status, realDelivery: { status: 'accepted', at: Date.parse('2026-10-04T01:15:00Z') } };
  }, { RadarI18n: { ready, uiLanguage: () => locale, subscribe: fn => { changed = fn; } },
    RadarTime: { countryZone: () => ({ zone }) } });
  await settle(); assert.equal(calls, 0);
  release(); await settle();
  assert.match(p.elements.notificationWorkerStatus.textContent, /10\/3.*9:15 PM/);
  locale = 'en-GB'; zone = 'Europe/London'; changed(); await settle();
  assert.equal(calls, 2);
  assert.match(p.elements.notificationWorkerStatus.textContent, /04\/10.*2:15 am/);
});
