const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker } = require('./helpers/worker');

test('a transient initialization read failure is retried by the next trusted refresh', async () => {
  let fail = true;
  const w = makeWorker({ storageHook: async (area, operation, keys) => {
    if (fail && area === 'local' && operation === 'get' && Array.isArray(keys) && keys.includes('securitySchema')) {
      fail = false; throw Error('Storage temporarily unavailable');
    }
  } });
  const first = await w.send({ type: 'REFRESH_ACCOUNT' }, w.sender('popup'));
  assert.equal(first.ok, false);
  assert.equal(w.requests.length, 0);
  const second = await w.send({ type: 'REFRESH_ACCOUNT' }, w.sender('popup'));
  assert.equal(second.ok, true);
  assert.equal(w.local.accountSnapshot.usage.windows[1].remainingPercent, 75);
  assert.equal(w.local.settings.monitorAccount, true);
});

test('a failure late in initialization does not permanently block settings or lose retained consent', async () => {
  const w = makeWorker();
  let fail = true;
  w.context.chrome.notifications.getAll = async () => {
    if (fail) { fail = false; throw Error('Notifications temporarily unavailable'); }
    return {};
  };
  assert.equal((await w.send({ type: 'SAVE_THEME', theme: 'dark' }, w.sender('popup'))).ok, false);
  assert.equal((await w.send({ type: 'SAVE_THEME', theme: 'light' }, w.sender('popup'))).ok, true);
  assert.equal(w.local.settings.theme, 'light');
  assert.equal(w.local.settings.monitorAccount, true);
  assert.equal(w.requests.length, 0);
});

test('concurrent initial callers share a failure and a later caller retries one complete initialization', async () => {
  let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const w = makeWorker({ storageHook: async (area, operation, keys) => {
    if (area !== 'local' || operation !== 'get' || !Array.isArray(keys) || !keys.includes('securitySchema')) return;
    calls++;
    if (calls === 1) { await gate; throw Error('Interrupted startup'); }
  } });
  const first = w.send({ type: 'REFRESH_ACCOUNT' }, w.sender('popup'));
  const second = w.send({ type: 'SAVE_THEME', theme: 'dark' }, w.sender('popup'));
  await new Promise(resolve => setImmediate(resolve)); release();
  assert.deepEqual((await Promise.all([first, second])).map(result => result.ok), [false, false]);
  assert.equal(calls, 1);
  assert.equal((await w.send({ type: 'REFRESH_ACCOUNT' }, w.sender('popup'))).ok, true);
  assert.equal(calls, 2);
  assert.equal(w.access.local, 'TRUSTED_CONTEXTS');
  assert.equal(w.access.session, 'TRUSTED_CONTEXTS');
});

test('a failed first browser startup schedules autonomous recovery and restores the selected polling interval', async () => {
  let fail = true;
  const w = makeWorker({ stored: { settings: { monitorAccount: true, monitorSignals: false, pollMinutes: 15 } },
    storageHook: async (area, operation, keys) => {
      if (fail && area === 'local' && operation === 'get' && Array.isArray(keys) && keys.includes('securitySchema')) {
        fail = false; throw Error('First startup interrupted');
      }
    } });
  await assert.rejects(w.events.startup(), /First startup interrupted/);
  const alarm = await w.context.chrome.alarms.get('codex-reset-radar-initialization-retry');
  assert.ok(alarm, 'recovery cannot require the user to open the popup');
  assert.equal(w.requests.length, 0);
  await w.events.alarm({ name: alarm.name });
  assert.equal(w.local.accountSnapshot.usage.windows[1].remainingPercent, 75);
  assert.equal((await w.context.chrome.alarms.get('codex-reset-radar-poll')).periodInMinutes, 15);
  assert.equal(await w.context.chrome.alarms.get(alarm.name), undefined);
});
