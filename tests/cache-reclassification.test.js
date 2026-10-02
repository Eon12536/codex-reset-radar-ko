const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json } = require('./helpers/worker.js');

function cachedSignal(text = 'Codex will reset soon, but not today') {
  const now = Date.now();
  return { id: '123456', entityId: '123456', text, author: 'thsottiaux',
    createdAt: new Date(now).toISOString(), source: { id: 'codex-lead', weight: 1 },
    url: 'https://x.com/thsottiaux/status/123456',
    assessment: { actionable: true, confidence: 'high', score: 8, weightedScore: 8,
      eventAt: now + 6 * 3600000, reason: 'future-quota-reset-language' } };
}

function cachedWorker(signal, { fail = false, text = signal.text, monitorAccount = false } = {}) {
  const state = { fail, text };
  const w = makeWorker({ stored: {
    settings: { monitorAccount, monitorSignals: true, monitorLeadSource: true,
      monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false,
      quietHoursEnabled: false, notifyHints: true, notifyOfficialReset: true },
    signalSnapshot: { signal, activeSignals: [signal], checkedAt: Date.now() - 60000 },
    adviceSnapshot: { tier: 'signal', detail: 'Legacy forecast' }, seenSignalIds: [signal.id],
    pendingNotifications: [{ id: 'signal:' + signal.id, options: { title: 'Legacy forecast' } }]
  }, fetcher: async () => {
    if (state.fail) throw new Error('Feed unavailable');
    return json({ items: [{ external_id: signal.id, content: state.text, published_at: signal.createdAt,
      metadata: { author_user_name: signal.author } }] });
  } });
  w.notifications['signal:' + signal.id] = { title: 'Legacy forecast' };
  return { w, state };
}

test('worker initialization reclassifies an older cached prediction without disabling account access', async () => {
  const { w } = cachedWorker(cachedSignal(), { monitorAccount: true });
  const checkedAt = w.local.signalSnapshot.checkedAt;
  await w.context.ensureSecurity();
  assert.equal(w.local.settings.monitorAccount, true);
  assert.equal(w.local.securitySchema, 1);
  assert.equal(w.local.signalSnapshot.signal, null);
  assert.equal(w.local.signalSnapshot.activeSignals.length, 0);
  assert.equal(w.local.signalSnapshot.checkedAt, checkedAt);
  assert.notEqual(w.local.adviceSnapshot.tier, 'signal');
  assert.equal(w.local.hintSnapshot.items[0].assessment.rule, 'qualified-reset');
  assert.equal(w.local.pendingNotifications.length, 0);
  assert.equal(w.notifications['signal:123456'], undefined);
  assert.equal(w.requests.length, 0);
});

test('an upgrade cannot keep or re-notify a cached qualified prediction when the feed fails', async () => {
  const { w } = cachedWorker(cachedSignal(), { fail: true });
  assert.equal((await w.context.refreshSignals()).ok, false);
  assert.equal(w.local.signalSnapshot.signal, null);
  assert.equal(w.local.signalSnapshot.activeSignals.length, 0);
  assert.notEqual(w.local.adviceSnapshot.tier, 'signal');
  assert.equal(w.local.pendingNotifications.length, 0);
  assert.equal(Object.keys(w.notifications).length, 0);
  await w.events.alarm({ name: 'snooze:signal:123456' });
  assert.equal(Object.keys(w.notifications).length, 0);
});

test('new text replaces a previously seen explicit forecast with a weak hint and removes its old alerts', async () => {
  const { w, state } = cachedWorker(cachedSignal('We will reset Codex usage limits later today.'));
  await w.context.ensureSecurity();
  assert.equal(w.local.signalSnapshot.signal.assessment.actionable, true);
  state.text = 'Codex will reset soon, but not today';
  await w.context.refreshSignals();
  assert.equal(w.local.signalSnapshot.signal, null);
  assert.equal(w.local.signalSnapshot.activeSignals.length, 0);
  assert.notEqual(w.local.adviceSnapshot.tier, 'signal');
  assert.equal(w.local.hintSnapshot.items[0].assessment.rule, 'qualified-reset');
  assert.equal(w.notifications['signal:123456'], undefined);
  assert.equal(w.notifications['hint:123456'], undefined, 'reclassifying an already observed post must not alert again');
  assert.equal(w.local.pendingNotifications.some(item => item.id === 'signal:123456'), false);
  await w.events.alarm({ name: 'snooze:signal:123456' });
  assert.equal(w.notifications['signal:123456'], undefined);
  state.text = 'No reset tomorrow.';
  await w.context.refreshSignals();
  assert.equal(w.local.hintSnapshot.items.length, 0);
  assert.equal(Object.keys(w.notifications).length, 0);
});

test('valid cached predictions survive a feed failure within their established grace window', async () => {
  const signal = cachedSignal('We will reset Codex usage limits later today.');
  signal.createdAt = new Date(Date.now() - 9 * 3600000).toISOString();
  signal.assessment.eventAt = Date.now() - 3600000;
  const { w } = cachedWorker(signal, { fail: true });
  await w.context.refreshSignals({ quiet: true });
  assert.equal(w.local.signalSnapshot.signal.id, signal.id);
  assert.equal(w.local.signalSnapshot.signal.assessment.actionable, true);
  assert.ok(w.notifications['signal:123456']);
});
