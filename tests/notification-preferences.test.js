const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker } = require('./helpers/worker');

async function queuedSignal(weight = 0.65) {
  const w = makeWorker({ stored: { settings: { monitorAccount: false,
    confidenceThreshold: 'medium', quietHoursEnabled: false } } });
  await w.context.ensureSecurity();
  const item = { id: '901', entityId: '901', author: 'example',
    text: 'We will reset Codex usage limits tomorrow.', createdAt: new Date().toISOString(),
    source: { id: 'community', weight }, url: 'https://x.com/example/status/901' };
  const signal = { ...item, assessment: w.context.RadarSignals.classify(item) };
  w.local.signalSnapshot = { signal, activeSignals: [signal] };
  w.local.publicAlertState = w.context.RadarPublicAlerts.observe(null, [signal]);
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.maybeNotifySignal(signal);
  assert.equal(w.local.pendingNotifications.length, 1);
  return w;
}

test('raising confidence cancels a queued lower-confidence alert while preserving its evidence', async () => {
  const w = await queuedSignal();
  assert.equal(w.local.signalSnapshot.signal.assessment.confidence, 'medium');
  await w.context.saveSettings({ ...w.local.settings, confidenceThreshold: 'high' });
  assert.equal(w.local.signalSnapshot.activeSignals.length, 1);
  assert.equal(w.local.pendingNotifications.length, 0);
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => false };
  await w.context.flushPendingNotifications();
  assert.equal(Object.keys(w.notifications).length, 0);
});

test('a restarted delivery worker checks the current confidence preference before releasing a queue', async () => {
  const w = await queuedSignal();
  w.local.settings.confidenceThreshold = 'high';
  const resumed = makeWorker({ stored: w.local });
  await resumed.context.flushPendingNotifications();
  assert.equal(Object.keys(resumed.notifications).length, 0);
  assert.equal(resumed.local.pendingNotifications.length, 0);
});

test('a snoozed lower-confidence alert cannot bypass a newly raised confidence preference', async () => {
  const w = await queuedSignal();
  w.local.pendingNotifications = [];
  w.local.settings.confidenceThreshold = 'high';
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => false };
  await w.events.alarm({ name: 'snooze:signal:901' });
  assert.equal(Object.keys(w.notifications).length, 0);
});

test('raising confidence retains a qualifying high-confidence queue and delivers it once', async () => {
  const w = await queuedSignal(1);
  await w.context.saveSettings({ ...w.local.settings, confidenceThreshold: 'high' });
  assert.equal(w.local.pendingNotifications.length, 1);
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => false };
  await w.context.flushPendingNotifications();
  await w.context.flushPendingNotifications();
  assert.ok(w.notifications['signal:901']);
  assert.equal(w.local.pendingNotifications.length, 0);
});
