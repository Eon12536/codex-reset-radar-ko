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
function success(w, cleanupError, diagnostics = {}) {
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: w.context.RadarDirectX.normalize([fixture.posts[0]], Date.parse(fixture.observedAt)),
    diagnostics: { posts: 1, cleanupError, timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai'].map(author => ({ author, kind, ok: true, stopReason: 'seven-days' }))), ...diagnostics } }) };
}
function partial(w, cleanupError) {
  success(w, cleanupError, { timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai'].map((author, index) => ({
    author, kind, ok: kind === 'posts' && index === 0, error: 'timeout', stopReason: 'seven-days'
  }))) });
}

test('a blocked collector warns once even when public feeds still succeed', async () => {
  const w = worker(); failing(w, 'X_TAB_BLOCKED');
  await refresh(w); await finishPublicResume(w);
  assert.equal(ids(w).length, 1);
  assert.match(w.notifications[ids(w)[0]].message, /자동으로 재시도/);
  assert.match(w.notifications[ids(w)[0]].message, /탭 닫은 후 재개/);
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

test('automatic tab recovery collects fresh posts before delivering a Windows notification', async () => {
  const w = worker({ stored: { directXScanTabV1GuardV1: { blocked: true, reason: 'session-lost' } } });
  success(w);
  let reads = 0;
  const read = w.context.RadarDirectX.read;
  w.context.RadarDirectX = { ...w.context.RadarDirectX,
    cleanup: async () => { delete w.local.directXScanTabV1GuardV1; return true; },
    read: async (...args) => { reads++; return read(...args); } };
  await w.events.alarm({ name: w.context.RadarDirectX.CLEANUP_ALARM });
  assert.equal(reads, 1);
  assert.equal(w.local.signalSnapshot.reports[0].id, fixture.posts[0].id);
  await finishPublicResume(w);
  assert.ok(w.notifications['report:' + fixture.posts[0].id]);
  await w.events.alarm({ name: w.context.RadarDirectX.CLEANUP_ALARM });
  assert.equal(reads, 1);
});

test('tab recovery keeps disabled public monitoring disabled', async () => {
  const w = worker({ stored: { settings: { monitorSignals: false }, directXScanTabV1GuardV1: { blocked: true } } });
  let reads = 0;
  w.context.RadarDirectX = { ...w.context.RadarDirectX,
    cleanup: async () => { delete w.local.directXScanTabV1GuardV1; return true; },
    read: async () => { reads++; throw new Error('Unexpected scan'); } };
  await w.events.alarm({ name: w.context.RadarDirectX.CLEANUP_ALARM });
  assert.equal(reads, 0);
  assert.deepEqual(Object.keys(w.notifications), []);
});

test('blocked to partial collection replaces the old warning while preserving fresh news', async () => {
  const w = worker(); failing(w, 'X_TAB_BLOCKED');
  await refresh(w); await finishPublicResume(w);
  assert.equal(ids(w).length, 1);
  partial(w);
  const result = await refresh(w); await finishPublicResume(w);
  assert.equal(result.directOk, true);
  assert.equal(result.collectionVerified, false);
  assert.equal(result.directError, 'partial');
  assert.equal(w.local.collectorHealth.error, 'partial');
  assert.equal(ids(w).length, 1);
  assert.ok(ids(w)[0].includes(':partial:'));
  assert.match(w.notifications[ids(w)[0]].title, /일부/);
  assert.doesNotMatch(w.notifications[ids(w)[0]].message, /새 트윗을 확인하지 못/);
  assert.equal(w.local.signalSnapshot.reports[0].id, fixture.posts[0].id);
  assert.ok(w.notifications['report:' + fixture.posts[0].id]);
  assert.ok(w.local.publicRetryCheck || w.local.publicResumeCheck);
});

test('two partial scans warn once and a healthy scan clears the warning', async () => {
  const w = worker(), previousSuccess = Date.parse(fixture.observedAt) - 3600000;
  w.local.collectorHealth = { error: null, lastSuccessAt: previousSuccess };
  partial(w); await refresh(w); await finishPublicResume(w);
  assert.equal(ids(w).length, 0);
  assert.equal(w.local.collectorHealth.error, 'partial');
  assert.equal(w.local.collectorHealth.lastSuccessAt, previousSuccess);
  await refresh(w); await finishPublicResume(w);
  assert.equal(ids(w).length, 1);
  await refresh(w); await finishPublicResume(w);
  assert.equal(ids(w).length, 1);
  success(w); const result = await refresh(w); await finishPublicResume(w);
  assert.equal(result.collectionVerified, true);
  assert.equal(w.local.collectorHealth.error, null);
  assert.equal(ids(w).length, 0);
  assert.equal(w.local.pendingNotifications.some(item => item.id.startsWith('collector:')), false);
});

test('a queued blocked warning cannot replay after the cause changes to partial collection', async () => {
  const w = worker(); failing(w, 'X_TAB_BLOCKED');
  const create = w.context.chrome.notifications.create;
  w.context.chrome.notifications.create = async () => { throw new Error('Windows busy'); };
  await refresh(w); await finishPublicResume(w);
  assert.ok(w.local.pendingNotifications.some(item => item.id.includes(':tab-blocked:')));
  partial(w); await refresh(w);
  assert.equal(w.local.pendingNotifications.some(item => item.id.includes(':tab-blocked:')), false);
  assert.ok(w.local.pendingNotifications.some(item => item.id.includes(':partial:')));
  w.context.chrome.notifications.create = create; await finishPublicResume(w);
  assert.equal(ids(w).length, 1);
  assert.ok(ids(w)[0].includes(':partial:'));
});

test('range limits and deferred conversation context alone do not mark collection as stopped', async () => {
  for (const diagnostics of [{ contextPending: 2, conversationFailures: 1 }, {
    timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai'].map(author => ({ author, kind, ok: true, stopReason: 'scan-limit' })))
  }]) {
    const w = worker(); success(w, undefined, diagnostics);
    for (let i = 0; i < 2; i++) { await refresh(w); await finishPublicResume(w); }
    assert.equal(w.local.signalSnapshot.leadStatus.collectionVerified, false);
    assert.equal(w.local.collectorHealth.error, null);
    assert.equal(ids(w).length, 0);
  }
});

test('a cleanup failure remains the primary error even when some timelines also fail', async () => {
  const w = worker(); partial(w, 'tab-blocked');
  const result = await refresh(w); await finishPublicResume(w);
  assert.equal(result.directError, 'tab-blocked');
  assert.equal(w.local.collectorHealth.error, 'tab-blocked');
  assert.equal(ids(w).length, 1);
  assert.ok(w.notifications['report:' + fixture.posts[0].id]);
});

test('partial collection respects disabled alerts without cancelling valid collected posts', async () => {
  const w = worker({ stored: { settings: { notifyOfficialReset: false, notifyResetHints: false, notifyHints: false } } });
  partial(w);
  for (let i = 0; i < 2; i++) { await refresh(w); await finishPublicResume(w); }
  assert.equal(ids(w).length, 0);
  assert.equal(w.local.signalSnapshot.reports[0].id, fixture.posts[0].id);
  assert.equal(w.local.pendingNotifications.some(item => item.id.startsWith('collector:')), false);
});

test('a protected tab remains fenced until recovery succeeds, then collection resumes', async () => {
  const w = worker({ stored: { directXScanTabV1GuardV1: { blocked: true, reason: 'tab-open' } } });
  success(w);
  let reads = 0, canRecover = false;
  const read = w.context.RadarDirectX.read;
  w.context.RadarDirectX = { ...w.context.RadarDirectX,
    cleanup: async () => { if (!canRecover) return false; delete w.local.directXScanTabV1GuardV1; return true; },
    read: async (...args) => { reads++; return read(...args); } };
  await w.events.alarm({ name: w.context.RadarDirectX.CLEANUP_ALARM });
  assert.equal(reads, 0);
  assert.equal(w.local.directXScanTabV1GuardV1.blocked, true);
  canRecover = true;
  await w.events.alarm({ name: w.context.RadarDirectX.CLEANUP_ALARM });
  await finishPublicResume(w);
  assert.equal(reads, 1);
  assert.ok(w.notifications['report:' + fixture.posts[0].id]);
});

test('turning monitoring off during warning replacement prevents a stale partial alert', async () => {
  const w = worker(); failing(w, 'X_TAB_BLOCKED');
  await refresh(w); await finishPublicResume(w);
  const created = [], create = w.context.chrome.notifications.create, clear = w.context.chrome.notifications.clear;
  w.context.chrome.notifications.create = async (id, options) => { created.push(id); return create(id, options); };
  let saving;
  w.context.chrome.notifications.clear = async id => {
    if (id.includes(':tab-blocked:') && !saving) saving = w.context.saveSettings({ ...w.local.settings, monitorSignals: false });
    return clear(id);
  };
  partial(w); await refresh(w); await saving;
  assert.equal(w.local.settings.monitorSignals, false);
  assert.equal(created.some(id => id.includes(':partial:')), false);
});
