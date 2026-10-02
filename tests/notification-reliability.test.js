const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json } = require('./helpers/worker');

function worker(extra = {}) {
  return makeWorker({ stored: { settings: { monitorAccount: false, monitorLeadSource: true,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false,
    notifyHints: true, quietHoursEnabled: false } }, fetcher: async () => json({ items: [{
    external_id: '251', content: 'Burn those tokens', published_at: new Date().toISOString(),
    metadata: { author_user_name: 'reach_vb' }
  }] }), ...extra });
}

test('public notification is saved before delivery and only accepted delivery writes history', async () => {
  const w = worker();
  const create = w.context.chrome.notifications.create;
  w.context.chrome.notifications.create = async (id, options) => {
    assert.equal(w.local.pendingNotifications[0].id, id);
    assert.equal(w.local.notificationHistory?.[id], undefined);
    await create(id, options);
  };
  await w.context.refreshSignals();
  assert.ok(w.notifications['hint:251']);
  assert.ok(w.local.notificationHistory['hint:251']);
  assert.equal(w.local.pendingNotifications.length, 0);
});

test('quiet or rejected alerts remain pending without a sent marker and later deliver once', async () => {
  for (const reason of ['quiet', 'failed']) {
    const w = worker();
    const create = w.context.chrome.notifications.create;
    w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => reason === 'quiet' };
    w.context.chrome.notifications.create = async () => { throw new Error('unavailable'); };
    await w.context.refreshSignals();
    await w.context.refreshSignals();
    assert.equal(w.local.pendingNotifications.length, 1);
    assert.equal(w.local.notificationHistory?.['hint:251'], undefined);
    w.context.chrome.notifications.create = create;
    w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => false };
    await w.context.flushPendingNotifications();
    await w.context.refreshSignals();
    assert.equal(Object.keys(w.notifications).length, 1);
    assert.ok(w.local.notificationHistory['hint:251']);
    assert.equal(w.local.pendingNotifications.length, 0);
  }
});

test('interruption during queue validation preserves the pending notification for a new worker', async () => {
  let interrupt = false;
  const w = worker({ storageHook: async (_area, operation, key) => {
    if (interrupt && operation === 'get' && key === 'hintSnapshot') throw new Error('worker interrupted');
  } });
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.refreshSignals();
  interrupt = true;
  await assert.rejects(w.context.flushPendingNotifications(), /worker interrupted/);
  assert.equal(w.local.pendingNotifications.length, 1);
  const resumed = makeWorker({ stored: w.local });
  await resumed.context.flushPendingNotifications();
  assert.ok(resumed.notifications['hint:251']);
  assert.equal(resumed.local.pendingNotifications.length, 0);
});

test('public queue release does not wait for an unrelated Chat history sync', async () => {
  const w = worker();
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.refreshSignals();
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => false };
  let finish;
  w.context.refreshChatHistory = () => new Promise(resolve => { finish = resolve; });
  const polling = w.context.pollAll();
  for (let i = 0; i < 20 && !w.notifications['hint:251']; i++) await new Promise(resolve => setImmediate(resolve));
  const deliveredBeforeSync = Boolean(w.notifications['hint:251']);
  finish({ ok: true }); await polling;
  assert.equal(deliveredBeforeSync, true);
});

test('test notifications do not replace the latest real delivery diagnostic', async () => {
  const w = worker();
  w.context.chrome.notifications.getPermissionLevel = async () => 'granted';
  await w.context.refreshSignals();
  await w.context.testNotification();
  const status = await w.context.notificationStatus();
  assert.equal(status.delivery.test, true);
  assert.equal(status.realDelivery.test, false);
  assert.equal(status.realDelivery.status, 'accepted');
  assert.equal(status.realDelivery.id, undefined);
  assert.equal(status.publicAlerts.handled, 1);
  assert.equal(status.publicAlerts.eligible, 0);
});

test('an old-version queued alert with premature history can still be delivered once', async () => {
  const w = worker();
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.refreshSignals();
  w.local.notificationHistory = { 'hint:251': Date.now() - 1000 };
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => false };
  await w.context.flushPendingNotifications();
  await w.context.refreshSignals();
  assert.ok(w.notifications['hint:251']);
  assert.equal(w.local.pendingNotifications.length, 0);
});

test('an accepted but unacknowledged visible toast is not sent a second time after restart', async () => {
  const w = worker();
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.refreshSignals();
  w.notifications['hint:251'] = { title: 'Already accepted' };
  w.context.chrome.notifications.create = async () => { assert.fail('Must not resend a visible toast'); };
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => false };
  await w.context.flushPendingNotifications();
  assert.equal(w.local.pendingNotifications.length, 0);
  assert.ok(w.local.notificationHistory['hint:251']);
});

test('rechecking a pending alert does not extend its original 24-hour expiry', async () => {
  const w = worker();
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.refreshSignals();
  w.local.pendingNotifications[0].queuedAt -= 25 * 3600000;
  const first = w.local.pendingNotifications[0].queuedAt;
  await w.context.refreshSignals();
  assert.equal(w.local.pendingNotifications[0].queuedAt, first);
  await w.context.flushPendingNotifications();
  assert.equal(w.local.pendingNotifications.length, 0);
  assert.equal(Object.keys(w.notifications).length, 0);
});
