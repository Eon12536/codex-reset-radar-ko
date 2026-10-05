const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
global.RadarTime = require('../src/core/time');
const Alerts = require('../src/core/public-alerts');
const DAY = 86400000;
const now = Date.parse('2026-09-27T12:00:00+09:00');
const post = (id, age, text = 'We have now reset all Codex usage limits.') => ({ id, entityId: id,
  author: 'thsottiaux', text, createdAt: new Date(Date.now() - age * DAY).toISOString(),
  url: `https://x.com/thsottiaux/status/${id}`, source: { id: 'codex-lead', weight: 1 } });
function worker(items, extra = {}) {
  const source = { items };
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false, quietHoursEnabled: false, notifyHints: true }, ...extra },
    fetcher: async () => json({ items: source.items.map(p => ({ external_id: p.id, content: p.text,
      published_at: p.createdAt, metadata: { author_user_name: p.author } })) }) });
  return { w, source };
}

test('September 23 rediscovered on September 27 stays in news but is not a new alert', () => {
  const item = { id: '123', createdAt: '2026-09-23T03:23:00+09:00' };
  const state = Alerts.observe(null, [item], { now });
  assert.equal(Alerts.allowed(item, state, {}, { now }), false);
  const reboot = Alerts.observe(state, [item], { now: now + 3600000, catchUpSince: now - 7 * DAY });
  assert.equal(Alerts.allowed(item, reboot, {}, { now: now + 3600000 }), false);
});

test('an old fetched report remains visible without notifying on refresh, update or startup', async () => {
  const { w } = worker([post('123', 4)]);
  for (const operation of [() => w.context.refreshSignals(), () => w.events.installed({ reason: 'update' }), () => w.events.startup()]) {
    await operation();
    assert.equal(w.local.signalSnapshot.reports.length, 1);
    assert.equal(Object.keys(w.notifications).length, 0);
  }
});

test('migration treats cached/seen posts as known even without a category-specific notification key', async () => {
  const item = post('123', 0.1);
  for (const stored of [{ seenSignalIds: [item.id] }, { signalSnapshot: { reports: [item], checkedAt: Date.now() - 1000 } }]) {
    const { w } = worker([item], stored);
    await w.context.refreshSignals();
    assert.equal(w.local.signalSnapshot.reports.length, 1);
    assert.equal(Object.keys(w.notifications).length, 0);
  }
});

test('a new post after the last successful check alerts after four offline days; older news does not', async () => {
  const { w } = worker([post('123', 3), post('124', 5)], { signalSnapshot: { checkedAt: Date.now() - 4 * DAY } });
  await w.events.startup();
  await finishPublicResume(w);
  assert.ok(w.notifications['report:123']);
  assert.equal(w.notifications['report:124'], undefined);
  assert.equal(w.local.signalSnapshot.reports.length, 2);
  const history = JSON.stringify(w.local.notificationHistory);
  await w.events.startup();
  assert.equal(JSON.stringify(w.local.notificationHistory), history);
});

test('classification changes do not repeat a toast, while a separate completion post does', async () => {
  const hint = post('123', 0.01, 'Maybe dust off the reset button next Tuesday.');
  const { w, source } = worker([hint]);
  await w.context.refreshSignals();
  assert.ok(w.notifications['hint:123']);
  source.items = [post('123', 0.01), post('124', 0.001)];
  await w.context.refreshSignals();
  assert.equal(w.notifications['report:123'], undefined);
  assert.ok(w.notifications['report:124']);
});

test('quiet hours are not bypassed merely because a post is more than a polling interval old', async () => {
  const { w } = worker([post('123', 0.4)]);
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.refreshSignals();
  assert.equal(Object.keys(w.notifications).length, 0);
  assert.equal(w.local.pendingNotifications.length, 1);
});

test('stale queues from older versions cannot deliver historical news on the next boot', async () => {
  const item = post('123', 4);
  const { w } = worker([item], { signalSnapshot: { reports: [item], checkedAt: Date.now() - 1000 },
    pendingNotifications: [{ id: 'report:123', options: { title: 'Old notice' } }] });
  await w.events.startup();
  assert.equal(Object.keys(w.notifications).length, 0);
  assert.equal(w.local.pendingNotifications.length, 0);
});

test('authorized queued news survives badge expiry and is delivered once', async () => {
  const { w } = worker([post('123', 0.1)]);
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.refreshSignals();
  const queuedAt = w.local.pendingNotifications[0].queuedAt;
  const before = Date.now();
  w.context.Date = class extends Date { static now() { return before + 2 * DAY; } };
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => false };
  await w.context.flushPendingNotifications();
  assert.equal(Object.keys(w.notifications).length, 1);
  assert.equal(w.local.pendingNotifications.length, 0);
  assert.ok(w.local.notificationHistory['report:123'] > queuedAt);
  await w.context.flushPendingNotifications();
  assert.equal(Object.keys(w.notifications).length, 1);
});

test('all fresh reports are considered; the fourth item is not permanently excluded', async () => {
  const { w } = worker(Array.from({ length: 5 }, (_, i) => post(String(100 + i), i / 100)));
  await w.context.refreshSignals();
  assert.equal(Object.keys(w.notifications).length, 5);
});

test('a fresh Tibo feed cannot end retries while VB replies or context lookups are incomplete', async () => {
  const { w } = worker([post('123', 0.1)]);
  w.local.settings.monitorDirectX = true;
  const timelines = ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai'].map(author =>
    ({ author, kind, ok: true, stopReason: 'seven-days' })));
  const scan = { timelines, contextPending: 0, conversationFailures: 0 };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: [post('123', 0.1)], diagnostics: scan }) };
  scan.timelines[3].ok = false;
  await w.events.startup();
  assert.ok(w.local.publicResumeCheck);
  assert.equal(w.local.signalSnapshot.leadStatus.collectionVerified, false);
  scan.timelines[3].ok = true; scan.contextPending = 1;
  await w.events.alarm({ name: 'codex-reset-radar-public-resume' });
  assert.ok(w.local.publicResumeCheck);
  scan.contextPending = 0;
  await w.events.alarm({ name: 'codex-reset-radar-public-resume' });
  assert.equal(w.local.publicResumeCheck, undefined);
});

test('partial periodic scans retry without treating retries as offline catch-up, and retries are bounded', async () => {
  const { w } = worker([post('123', 0.1)]);
  w.local.settings.monitorDirectX = true;
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: [], diagnostics: { timelines: [] } }) };
  const alarms = [];
  w.context.chrome.alarms.create = async (name, options) => alarms.push({ name, ...options });
  await w.context.refreshSignals();
  assert.ok(w.local.publicRetryCheck);
  assert.equal(w.local.publicResumeCheck, undefined);
  for (let i = 0; i < 3; i++) await w.events.alarm({ name: 'codex-reset-radar-public-retry' });
  assert.equal(alarms.filter(a => a.name === 'codex-reset-radar-public-retry').length, 3);
  await w.context.saveSettings({ ...w.local.settings, monitorDirectX: false });
  assert.equal(w.local.publicRetryCheck, undefined);
});

test('a second Chrome start preserves the offline window until every timeline has been checked', async () => {
  const since = Date.now() - 4 * DAY;
  const { w, source } = worker([post('123', 0.1)], { signalSnapshot: { checkedAt: since } });
  w.local.settings.monitorDirectX = true;
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: [], diagnostics: { timelines: [] } }) };
  await w.events.startup();
  source.items.push(post('124', 3));
  await w.events.startup();
  assert.equal(w.local.publicResumeCheck.since, since);
  await finishPublicResume(w);
  assert.ok(w.notifications['report:124']);
});

test('migration preserves a recent legitimate queued notice while suppressing a new duplicate', async () => {
  const item = post('123', 0.1);
  const { w } = worker([item], { seenSignalIds: ['123'], signalSnapshot: { reports: [item], checkedAt: Date.now() },
    pendingNotifications: [{ id: 'report:123', queuedAt: Date.now(), options: { title: 'Pending' } }] });
  await w.context.refreshSignals();
  assert.equal(Object.keys(w.notifications).length, 0);
  await w.context.flushPendingNotifications();
  assert.ok(w.notifications['report:123']);
  assert.equal(w.local.pendingNotifications.length, 0);
});
