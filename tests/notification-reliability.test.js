const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');

function worker(extra = {}) {
  const publishedAt = new Date().toISOString();
  return makeWorker({ stored: { settings: { monitorAccount: false, monitorLeadSource: true,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false,
    notifyHints: true, quietHoursEnabled: false } }, fetcher: async () => json({ items: [{
    external_id: '251', content: 'Burn those tokens', published_at: publishedAt,
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

test('failed removal of an obsolete Windows alert cannot block fresh startup or wake notifications', async () => {
  for (const trigger of ['startup', 'wake']) {
    const w = worker();
    w.notifications['hint:removed'] = { title: 'Obsolete alert' };
    const clear = w.context.chrome.notifications.clear;
    w.context.chrome.notifications.clear = async () => { throw new Error('notification center unavailable'); };
    w.local.signalSnapshot = { checkedAt: Date.now() - 4 * 3600000 };
    w.local.wakeCheckedAt = Date.now() - 4 * 3600000;
    if (trigger === 'startup') await w.events.startup();
    else await w.events.alarm({ name: 'codex-reset-radar-wake-check', scheduledTime: Date.now() - 3 * 3600000 });
    assert.equal(w.local.signalError, null, trigger);
    assert.ok(w.local.hintSnapshot.items.some(item => item.id === '251'), trigger);
    assert.ok(w.local.pendingNotifications.some(item => item.id === 'hint:251'), trigger);
    assert.equal(w.notifications['hint:251'], undefined, 'wait for the desktop wake grace period');
    await finishPublicResume(w);
    assert.ok(w.notifications['hint:251'], trigger);
    assert.ok(w.local.notificationHistory['hint:251'], trigger);
    assert.equal(w.local.pendingNotifications.length, 0, trigger);
    const accepted = w.local.notificationHistory['hint:251'];
    w.context.chrome.notifications.clear = clear;
    await w.context.refreshSignals();
    assert.equal(w.notifications['hint:removed'], undefined, 'retry obsolete cleanup when Windows recovers');
    assert.equal(w.local.notificationHistory['hint:251'], accepted, 'do not repeat the delivered news');
  }
});

test('notification-center failures cannot interrupt disabling alerts or clearing local records', async () => {
  for (const failure of ['read', 'clear']) {
    const w = worker();
    await w.context.refreshSignals();
    w.notifications['expiry:obsolete'] = { title: 'Old expiry alert' };
    w.notifications['event:obsolete'] = { title: 'Old event alert' };
    const api = failure === 'read' ? 'getAll' : 'clear';
    w.context.chrome.notifications[api] = async () => { throw new Error('notification center unavailable'); };
    const saved = await w.send({ type: 'SAVE_SETTINGS', settings: { ...w.local.settings,
      notifyHints: false, notifyCreditExpiry: false, notifyAdvice: false } }, w.sender('options'));
    assert.equal(saved.ok, true, failure);
    assert.equal(w.local.settings.notifyHints, false, failure);
    assert.equal(w.local.settings.notifyCreditExpiry, false, failure);
    const cleared = await w.send({ type: 'CLEAR_LOCAL_DATA' }, w.sender('options'));
    assert.equal(cleared.ok, true, failure);
    assert.equal(w.local.notificationHistory, undefined, failure);
    assert.equal(w.local.hintSnapshot, undefined, failure);
    assert.equal(w.local.settings.notifyHints, false, failure);
  }
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

test('rechecking preserves queue time and badge expiry without dropping an authorized undelivered alert', async () => {
  const w = worker();
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.refreshSignals();
  const first = w.local.pendingNotifications[0].queuedAt;
  const expiry = w.local.publicAlertState.entries['251'].expiresAt;
  const before = Date.now();
  w.context.Date = class extends Date { static now() { return before + 25 * 3600000; } };
  await w.context.refreshSignals();
  assert.equal(w.local.pendingNotifications[0].queuedAt, first);
  assert.equal(w.local.publicAlertState.entries['251'].expiresAt, expiry);
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => false };
  await finishPublicResume(w);
  assert.equal(w.local.pendingNotifications.length, 0);
  assert.equal(Object.keys(w.notifications).length, 1);
});
