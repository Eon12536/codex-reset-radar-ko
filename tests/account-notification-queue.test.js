const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, FAKE_TOKEN, RAW_USAGE, json } = require('./helpers/worker');
const START = Date.parse('2026-10-03T03:00:00Z');
const HOUR = 3600000;

function harness(kind, stored = {}) {
  let now = START;
  const source = { token: FAKE_TOKEN, usage: structuredClone(RAW_USAGE), status: 200,
    credits: { available_count: 1, credits: [{ id: 'credit', expires_at: new Date(START + HOUR).toISOString() }] } };
  if (kind === 'advice') { source.usage.rate_limit.allowed = false; source.credits.credits[0].expires_at = null; }
  const h = makeWorker({ stored: { ...stored, settings: { monitorAccount: true, monitorSignals: false,
    notifyAccountReset: false, notifyBankedReset: false, notifyCreditExpiry: kind === 'expiry', notifyAdvice: kind === 'advice',
    quietHoursEnabled: true, quietStart: '00:00', quietEnd: '23:59', timezoneMode: 'manual', timezoneOverride: 'UTC', ...stored.settings } },
  fetcher(url) {
    if (url.endsWith('/auth/session')) return json({ accessToken: source.token });
    if (url.endsWith('/usage')) return json(source.usage, source.status);
    if (url.endsWith('/rate-limit-reset-credits')) return json(source.credits, source.status);
    throw new Error('Unexpected request');
  } });
  h.context.Date = class extends Date { static now() { return now; } };
  return { ...h, source, clock: value => { now = value; },
    refresh: () => h.send({ type: 'REFRESH_NOW' }, h.sender('popup')),
    save: settings => h.send({ type: 'SAVE_SETTINGS', settings: { ...h.local.settings, ...settings } }, h.sender('options')) };
}

test('turning off account guidance cancels its quiet-hours queue before delivery', async () => {
  for (const kind of ['expiry', 'advice']) {
    const h = harness(kind); await h.refresh();
    assert.equal(h.local.pendingNotifications.length, 1);
    await h.save({ quietHoursEnabled: false, [kind === 'expiry' ? 'notifyCreditExpiry' : 'notifyAdvice']: false });
    assert.equal(h.local.pendingNotifications.length, 0);
    await h.refresh(); assert.equal(Object.keys(h.notifications).length, 0);
  }
});

test('expired or already-spent credits cannot release an outdated expiry notification', async () => {
  for (const change of ['expired', 'spent']) {
    const h = harness('expiry'); await h.refresh();
    assert.equal(h.local.pendingNotifications.length, 1);
    if (change === 'expired') h.clock(START + 2 * HOUR);
    else h.source.credits = { available_count: 0, credits: [] };
    await h.save({ quietHoursEnabled: false }); await h.refresh();
    assert.equal(Object.keys(h.notifications).length, 0);
    assert.equal(h.local.pendingNotifications.length, 0);
  }
});

test('recovered quota cancels obsolete blocked advice', async () => {
  const h = harness('advice'); await h.refresh();
  assert.equal(h.local.pendingNotifications.length, 1);
  h.source.usage = structuredClone(RAW_USAGE);
  await h.save({ quietHoursEnabled: false }); await h.refresh();
  assert.equal(Object.keys(h.notifications).length, 0);
  assert.equal(h.local.pendingNotifications.length, 0);
});

test('queued account guidance waits for fresh account data and updates its message before delivery', async () => {
  const h = harness('expiry'); await h.refresh();
  await h.save({ quietHoursEnabled: false });
  h.source.status = 500; await h.refresh();
  assert.equal(Object.keys(h.notifications).length, 0);
  assert.equal(h.local.pendingNotifications.length, 1);
  h.source.status = 200; h.source.usage.rate_limit.secondary_window.used_percent = 40;
  await h.refresh(); await h.refresh();
  const delivered = Object.values(h.notifications);
  assert.equal(delivered.length, 1);
  assert.match(delivered[0].message, /60%/);
});

test('switching accounts cannot deliver the previous account guidance or suppress the new account notice', async () => {
  for (const kind of ['expiry', 'advice']) {
    const h = harness(kind); await h.refresh();
    const oldId = h.local.pendingNotifications[0].id;
    h.source.token = 'OTHER_AUDIT_TOKEN';
    await h.save({ quietHoursEnabled: false }); await h.refresh();
    assert.equal(Object.keys(h.notifications).length, 1);
    assert.equal(Object.hasOwn(h.notifications, oldId), false);
    assert.equal(h.local.pendingNotifications.length, 0);
  }
});

test('account guidance queues expire after 24 hours even if account requests keep failing', async () => {
  for (const kind of ['expiry', 'advice']) {
    const h = harness(kind); await h.refresh();
    assert.equal(h.local.pendingNotifications.length, 1);
    h.source.status = 500;
    h.clock(START + 24 * HOUR - 1); await h.refresh();
    assert.equal(h.local.pendingNotifications.length, 1);
    h.clock(START + 24 * HOUR); await h.refresh();
    assert.equal(h.local.pendingNotifications.length, 0);
    assert.equal(Object.keys(h.notifications).length, 0);
  }
});

test('a zero credit total cannot emit an immediate expiry alert from a stale available row', async () => {
  const h = harness('expiry', { settings: { quietHoursEnabled: false } });
  h.source.credits.available_count = 0;
  await h.refresh();
  assert.equal(h.local.accountSnapshot.credits.availableCount, 0);
  assert.equal(Object.keys(h.notifications).length, 0);
  assert.equal(h.local.pendingNotifications.length, 0);
});
