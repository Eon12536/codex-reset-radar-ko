const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker } = require('./helpers/worker');

test('fresh install uses requested defaults without enabling account or history access', async () => {
  const w = makeWorker({ stored: { settings: {}, securitySchema: undefined, preferenceDefaultsSchema: undefined } });
  await w.context.ensureSecurity();
  assert.equal(w.local.settings.quietHoursEnabled, false);
  assert.equal(w.local.settings.notifyHints, true);
  assert.equal(w.local.settings.syncChatResetWithCodex, true);
  assert.equal(w.local.settings.monitorAccount, false);
  assert.equal(w.local.settings.monitorChat, false);
  assert.equal(w.local.settings.syncChatHistory, false);
  assert.equal(w.requests.length, 0);
});

test('upgrade changes the three requested preferences once and preserves unrelated settings', async () => {
  const w = makeWorker({ stored: { preferenceDefaultsSchema: undefined, chatCounterSchema: 2,
    settings: { monitorAccount: false, monitorChat: false, monitorSignals: false, notifyOfficialReset: false,
      quietHoursEnabled: true, notifyHints: false, syncChatResetWithCodex: false,
      quietStart: '22:30', quietEnd: '07:15', pollMinutes: 15, theme: 'dark' } } });
  await w.context.ensureSecurity();
  assert.equal(w.local.settings.quietHoursEnabled, false);
  assert.equal(w.local.settings.notifyHints, true);
  assert.equal(w.local.settings.syncChatResetWithCodex, true);
  for (const [key, value] of Object.entries({ monitorAccount: false, monitorChat: false,
    monitorSignals: false, notifyOfficialReset: false, quietStart: '22:30', quietEnd: '07:15', pollMinutes: 15, theme: 'dark' })) {
    assert.equal(w.local.settings[key], value, key);
  }
  assert.equal(w.local.preferenceDefaultsSchema, 1);
  assert.equal(w.requests.length, 0);
});

test('later user choices survive worker restart and clearing collected data', async () => {
  const w = makeWorker({ stored: { preferenceDefaultsSchema: undefined, settings: { monitorAccount: false, monitorSignals: false } } });
  await w.context.ensureSecurity();
  await w.context.saveSettings({ ...w.local.settings, quietHoursEnabled: true, notifyHints: false, syncChatResetWithCodex: false });
  assert.equal((await w.send({ type: 'CLEAR_LOCAL_DATA' }, w.sender('options'))).ok, true);
  const restarted = makeWorker({ stored: structuredClone(w.local) });
  await restarted.context.ensureSecurity();
  assert.equal(restarted.local.settings.quietHoursEnabled, true);
  assert.equal(restarted.local.settings.notifyHints, false);
  assert.equal(restarted.local.settings.syncChatResetWithCodex, false);
});
