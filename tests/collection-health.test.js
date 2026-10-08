const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
const fixture = require('./fixtures/reset-grant-oct8.json');
const settings = { monitorAccount: false, quietHoursEnabled: false, monitorStatusSource: false,
  monitorHistorySource: false, monitorCommunitySource: false };
function worker({ stored = {}, allFail = false } = {}) {
  const w = makeWorker({ stored: { ...stored, settings: { ...settings, ...stored.settings } }, fetcher: async () => {
    if (allFail) throw new Error('Offline');
    return json({ items: [] });
  } });
  w.context.Date = class extends Date { static now() { return Date.parse(fixture.observedAt); } };
  return w;
}
const refresh = w => w.send({ type: 'REFRESH_SIGNALS' }, w.sender('options'));
const ids = w => Object.keys(w.notifications).filter(id => id.startsWith('collector:'));
function failing(w, reason) {
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => { throw new Error(reason); } };
}
function success(w, cleanupError) {
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: w.context.RadarDirectX.normalize([fixture.posts[0]], Date.parse(fixture.observedAt)),
    diagnostics: { posts: 1, cleanupError, timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai'].map(author => ({ author, kind, ok: true, stopReason: 'seven-days' }))) } }) };
}

test('a blocked collector warns once even when public feeds still succeed', async () => {
  const w = worker(); failing(w, 'X_TAB_BLOCKED');
  await refresh(w); await finishPublicResume(w);
  assert.equal(ids(w).length, 1);
  assert.match(w.notifications[ids(w)[0]].message, /자동으로 재시도/);
  await refresh(w); await finishPublicResume(w);
  assert.equal(ids(w).length, 1);
  assert.equal(Object.keys(w.local.notificationHistory).filter(id => id.startsWith('collector:')).length, 1);
});

test('recovery cancels a failed-delivery collector warning before retrying it', async () => {
  const w = worker(); failing(w, 'X_TAB_BLOCKED');
  const create = w.context.chrome.notifications.create;
  w.context.chrome.notifications.create = async () => { throw new Error('Windows busy'); };
  await refresh(w); await finishPublicResume(w);
  assert.equal(w.local.pendingNotifications.filter(item => item.id.startsWith('collector:')).length, 1);
  success(w); w.context.chrome.notifications.create = create;
  await refresh(w); await finishPublicResume(w);
  assert.equal(ids(w).length, 0);
  assert.equal(w.local.collectorHealth.error, null);
  assert.equal(w.local.pendingNotifications.filter(item => item.id.startsWith('collector:')).length, 0);
});

test('temporary failures need two checks; initial optional-permission absence stays quiet', async () => {
  for (const [reason, expected] of [['X_TIMEOUT', 1], ['X_PERMISSION', 0]]) {
    const w = worker(); failing(w, reason);
    await refresh(w); await finishPublicResume(w);
    assert.equal(ids(w).length, 0);
    await refresh(w); await finishPublicResume(w);
    assert.equal(ids(w).length, expected);
  }
});

test('all-source failure still sends a collection warning and disabled alerts remain respected', async () => {
  const w = worker({ allFail: true }); failing(w, 'X_TAB_BLOCKED');
  await refresh(w); await finishPublicResume(w);
  assert.equal(ids(w).length, 1);
  const off = worker({ stored: { settings: { notifyOfficialReset: false, notifyResetHints: false, notifyHints: false } } });
  failing(off, 'X_TAB_BLOCKED'); await refresh(off); await finishPublicResume(off);
  assert.equal(ids(off).length, 0);
  assert.equal(off.local.pendingNotifications.some(item => item.id.startsWith('collector:')), false);
});

test('cleanup failure preserves collected grant news and sends its Windows alert', async () => {
  const w = worker(); success(w, 'tab-blocked');
  const result = await refresh(w); await finishPublicResume(w);
  assert.equal(result.ok, true);
  assert.equal(result.directOk, true);
  assert.equal(result.directError, 'tab-blocked');
  assert.equal(result.collectionVerified, false);
  assert.equal(w.local.signalSnapshot.reports[0].id, fixture.posts[0].id);
  assert.ok(w.notifications['report:' + fixture.posts[0].id]);
  assert.equal(ids(w).length, 1);
});

test('a notification-center read failure does not turn a fresh successful scan into a source failure', async () => {
  const w = worker(); success(w);
  w.context.chrome.notifications.getAll = async () => { throw new Error('OS unavailable'); };
  const result = await refresh(w);
  assert.equal(result.ok, true);
  assert.equal(w.local.signalError, null);
  assert.equal(w.local.signalSnapshot.reports[0].id, fixture.posts[0].id);
});
