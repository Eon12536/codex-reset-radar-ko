const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
const NOW = Date.parse('2026-10-28T01:00:00Z');
const RETRY = 'codex-reset-radar-public-retry';
function worker(stored = {}) {
  const w = makeWorker({ stored: { ...stored, settings: { monitorAccount: false,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false,
    quietHoursEnabled: false, notifyResetHints: true, semanticEnabled: false, ...stored.settings } }, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  return w;
}

test('a worker restart restores a lost pending collection retry without resetting its retry budget', async () => {
  const pending = { attempts: 1, startedAt: NOW - 5 * 60000 };
  const w = worker({ publicRetryCheck: pending });
  await w.context.ensureSecurity();
  assert.ok(await w.context.chrome.alarms.get(RETRY));
  assert.deepEqual(w.local.publicRetryCheck, pending);
  const alarm = await w.context.chrome.alarms.get(RETRY);
  await w.context.schedulePublicRetry();
  assert.deepEqual(await w.context.chrome.alarms.get(RETRY), alarm);
  assert.deepEqual(w.local.publicRetryCheck, pending);
});

test('retry recovery respects exhausted budgets and monitoring being disabled', async () => {
  const exhausted = worker({ publicRetryCheck: { attempts: 3, startedAt: NOW - 5 * 60000 } });
  await exhausted.context.ensureSecurity();
  await exhausted.context.schedulePublicRetry();
  assert.equal(await exhausted.context.chrome.alarms.get(RETRY), undefined);
  assert.equal(exhausted.local.publicRetryCheck.attempts, 3);
  const off = worker({ settings: { monitorSignals: false }, publicRetryCheck: { attempts: 1, startedAt: NOW } });
  await off.context.ensureSecurity();
  assert.equal(await off.context.chrome.alarms.get(RETRY), undefined);
});

test('checkpointed news is classified and delivered when X fails after saving but another feed succeeds', async () => {
  const w = worker();
  const delivered = [];
  const create = w.context.chrome.notifications.create;
  w.context.chrome.notifications.create = async (id, options) => { delivered.push(id); return create(id, options); };
  const post = { id: '90201', author: 'thsottiaux', text: 'Day 13 / Le limit reset',
    url: 'https://x.com/thsottiaux/status/90201', createdAt: '2026-10-27T23:00:00Z' };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async (_signal, options) => {
    await options.onCheckpoint({ posts: [post], contextCache: {} });
    throw new Error('X_TIMEOUT');
  } };
  const result = await w.context.refreshSignals();
  assert.equal(result.collectionVerified, false);
  assert.equal(result.directOk, false);
  assert.equal(w.local.signalSnapshot.leadStatus.directError, 'timeout');
  assert.ok(w.local.hintSnapshot.items.some(item => item.id === post.id));
  await finishPublicResume(w);
  assert.ok(w.notifications['hint:' + post.id]);
  const receipt = w.local.notificationHistory['hint:' + post.id];
  await w.context.refreshSignals();
  await finishPublicResume(w);
  assert.equal(w.local.notificationHistory['hint:' + post.id], receipt);
  assert.equal(delivered.filter(id => id === 'hint:' + post.id).length, 1);
});
