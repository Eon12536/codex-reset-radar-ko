const test = require('node:test');
const assert = require('node:assert/strict');
const Settings = require('../src/core/settings');
const { makeWorker } = require('./helpers/worker');

test('new defaults favor reset evidence, prompt collection, enabled recovery and opt-in private data', () => {
  const settings = Settings.sanitize();
  assert.equal(settings.pollMinutes, 15);
  assert.equal(settings.confidenceThreshold, 'high');
  assert.equal(settings.expiryWarningHours, 72);
  for (const key of ['resetOnly', 'semanticEnabled', 'monitorSignals', 'monitorLeadSource', 'monitorDirectX',
    'monitorStatusSource', 'notifyHints', 'notifyResetHints', 'notifyOfficialReset', 'notifyScheduleChanges',
    'notifyAccountReset', 'notifyBankedReset', 'notifyRecoveryOnResume', 'notifyPublicOnResume', 'notifyCreditExpiry',
    'syncChatResetWithCodex']) assert.equal(settings[key], true, key);
  for (const key of ['quietHoursEnabled', 'monitorHistorySource', 'monitorCommunitySource',
    'monitorAccount', 'monitorChat', 'syncChatHistory']) assert.equal(settings[key], false, key);
});

test('fresh initialization saves reset-focused defaults without requests or private access', async () => {
  const w = makeWorker({ stored: { settings: {}, securitySchema: undefined,
    preferenceDefaultsSchema: undefined, resetFocusDefaultsSchema: undefined } });
  await w.context.ensureSecurity();
  assert.equal(w.local.settings.pollMinutes, 15);
  assert.equal(w.local.settings.resetOnly, true);
  assert.equal(w.local.settings.monitorHistorySource, false);
  assert.equal(w.local.settings.monitorCommunitySource, false);
  assert.equal(w.local.settings.monitorAccount, false);
  assert.equal(w.local.settings.monitorChat, false);
  assert.equal(w.local.resetFocusDefaultsSchema, 1);
  assert.equal(w.requests.length, 0);
  assert.equal((await w.context.chrome.alarms.get('codex-reset-radar-poll')).periodInMinutes, 15);
});

test('upgrade replaces old 30-minute and community defaults, preserving explicit choices and enabled account consent', async () => {
  const w = makeWorker({ stored: { resetFocusDefaultsSchema: undefined, chatCounterSchema: 2,
    settings: { pollMinutes: 30, monitorHistorySource: true, monitorCommunitySource: true,
      monitorAccount: true, monitorChat: false, monitorSignals: false, notifyPublicOnResume: false,
      quietHoursEnabled: true, confidenceThreshold: 'all', theme: 'dark' } } });
  await w.context.ensureSecurity();
  assert.equal(w.local.settings.pollMinutes, 15);
  assert.equal(w.local.settings.monitorHistorySource, false);
  assert.equal(w.local.settings.monitorCommunitySource, false);
  for (const [key, value] of Object.entries({ monitorAccount: true, monitorChat: false,
    monitorSignals: false, notifyPublicOnResume: false, quietHoursEnabled: true,
    confidenceThreshold: 'all', theme: 'dark' })) assert.equal(w.local.settings[key], value, key);
  assert.equal(w.requests.length, 0);
});

test('custom slower intervals are preserved and later source choices survive restart and data clearing', async () => {
  for (const interval of [60, 120]) {
    const w = makeWorker({ stored: { resetFocusDefaultsSchema: undefined,
      settings: { monitorAccount: false, monitorSignals: false, pollMinutes: interval } } });
    await w.context.ensureSecurity();
    assert.equal(w.local.settings.pollMinutes, interval);
    await w.context.saveSettings({ ...w.local.settings, pollMinutes: 30,
      monitorHistorySource: true, monitorCommunitySource: true, resetOnly: false });
    await w.send({ type: 'CLEAR_LOCAL_DATA' }, w.sender('options'));
    assert.equal(w.local.resetFocusDefaultsSchema, 1, 'the real persisted marker must survive clearing, without helper defaults');
    const restarted = makeWorker({ stored: structuredClone(w.local) });
    await restarted.context.ensureSecurity();
    assert.equal(restarted.local.settings.pollMinutes, 30);
    assert.equal(restarted.local.settings.monitorHistorySource, true);
    assert.equal(restarted.local.settings.monitorCommunitySource, true);
    assert.equal(restarted.local.settings.resetOnly, false);
  }
});

test('disabling an optional source removes its cached news, badge and pending/visible alert immediately', async () => {
  const w = makeWorker({ stored: { settings: { monitorAccount: false, confidenceThreshold: 'all',
    monitorHistorySource: true, monitorCommunitySource: true, quietHoursEnabled: false } } });
  await w.context.ensureSecurity();
  const signal = { id: 'community-1', text: 'We will reset Codex usage limits tomorrow.',
    author: 'community', createdAt: new Date().toISOString(),
    url: 'https://github.com/openai/codex/issues/101', source: { id: 'github-community', weight: 1 } };
  signal.assessment = w.context.RadarSignals.classify(signal);
  assert.equal(signal.assessment.actionable, true);
  w.local.signalSnapshot = { signal, activeSignals: [signal] };
  w.notifications['signal:community-1'] = { title: 'Previously enabled source' };
  w.local.pendingNotifications = [{ id: 'signal:community-1', options: { title: 'Old queued source' } }];
  await w.context.saveSettings({ ...w.local.settings, monitorCommunitySource: false });
  assert.equal(w.local.signalSnapshot.activeSignals.length, 0);
  assert.equal(w.local.signalSnapshot.signal, null);
  assert.equal(w.local.pendingNotifications.length, 0);
  assert.equal(w.notifications['signal:community-1'], undefined);
  assert.equal(w.context.RadarNews.list({ signal, activeSignals: [signal] }, null, w.local.settings).length, 0);
  assert.equal(w.context.RadarBadge.view({ signalSnapshot: { activeSignals: [signal] } }, w.local.settings).publicItems.length, 0);
  const other = { ...signal, source: { id: 'openai-status', weight: 1 } };
  assert.equal(w.context.RadarResetScope.allows(other, w.local.settings), true, 'official source remains available');
});
