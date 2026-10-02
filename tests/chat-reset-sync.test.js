const test = require('node:test');
const assert = require('node:assert/strict');
const Counter = require('../src/core/chat-counter.js');
const { makeWorker, RAW_USAGE, json } = require('./helpers/worker.js');
const NOW = 1800000000000;
const HOUR = 3600000;
const WEEK = 7 * 24 * HOUR;
const token = user => 'test.' + Buffer.from(JSON.stringify({ sub: user,
  'https://api.openai.com/auth': { chatgpt_user_id: user, chatgpt_account_id: 'account-' + user, chatgpt_plan_type: 'pro' }
})).toString('base64url') + '.signature';

function harness(settings = {}, stored = {}) {
  const source = { user: 'A', raw: structuredClone(RAW_USAGE), status: 200, now: NOW, ...stored.source };
  source.raw.plan_type = 'pro';
  const w = makeWorker({ stored: { chatCounterSchema: 2, chatPolicySchema: 1, ...stored.local, settings: {
    monitorChat: true, monitorAccount: true, monitorSignals: false, quietHoursEnabled: false,
    notifyCreditExpiry: false, notifyAdvice: false, syncChatResetWithCodex: true, ...settings
  } }, fetcher(url) {
    if (url.endsWith('/auth/session')) return json({ accessToken: token(source.user) });
    if (url.endsWith('/usage')) return json(source.raw, source.status);
    if (url.endsWith('/rate-limit-reset-credits')) return json({ available_count: 0, credits: [] });
    throw new Error('Unexpected request: ' + url);
  } });
  w.context.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [source.now])); } static now() { return source.now; } };
  let scripts = [];
  w.context.chrome.permissions.contains = async () => true;
  w.context.chrome.scripting = { getRegisteredContentScripts: async () => scripts,
    registerContentScripts: async value => { scripts = value; }, unregisterContentScripts: async () => { scripts = []; }, executeScript: async () => [] };
  w.context.chrome.tabs.query = async () => [];
  const connect = async () => { await w.context.ensureSecurity(); return w.context.refreshChatAccount({ force: true }); };
  const profile = () => w.local.chatCounters[w.local.chatAccount.key];
  const count = (kind = 'astra', id = 'a') => {
    const key = w.local.chatAccount.key;
    w.local.chatCounters[key] = Counter.record(profile(), { model: kind, key: id.repeat(64) }, source.now);
  };
  return { ...w, source, connect, profile, count,
    refresh: () => w.send({ type: 'REFRESH_NOW' }, w.sender('popup')),
    used: () => Counter.summary(profile(), 'pro100', source.now).used };
}

test('confirmed Codex reset clears both local models once; duplicate responses remain excluded', async () => {
  const w = harness(); await w.connect();
  Object.assign(w.profile(), { plan: 'pro100', planAt: NOW });
  w.count(); w.count('sol', 'b'); await w.refresh();
  assert.equal(w.used(), 2);
  w.source.now += 1000;
  w.source.raw.rate_limit.primary_window.used_percent = 0;
  w.source.raw.rate_limit.secondary_window.used_percent = 0;
  await w.refresh();
  assert.equal(w.used(), 0);
  assert.equal(w.profile().plan, 'pro100');
  assert.deepEqual([...w.profile().codexReset.kinds], ['fiveHour', 'weekly']);
  w.count('astra', 'a'); // Retry of a response counted before reset.
  assert.equal(w.used(), 0);
  w.count('sol', 'c'); // A genuinely new response, even in the same millisecond.
  await w.refresh();
  assert.equal(w.used(), 1);
  assert.equal(Object.keys(w.notifications).length, 1);
  const restarted = harness({}, { local: structuredClone(w.local), source: { ...w.source } });
  await restarted.refresh();
  assert.equal(restarted.used(), 1);
});

test('counter synchronization does not depend on desktop notifications being enabled', async () => {
  const w = harness({ notifyAccountReset: false }); await w.connect(); w.count(); await w.refresh();
  w.source.now += 1000; w.source.raw.rate_limit.primary_window.used_percent = 0;
  await w.refresh();
  assert.equal(w.used(), 0);
  assert.equal(Object.keys(w.notifications).length, 0);
  assert.equal(w.local.recoveryState.events.length, 0);
  await w.context.saveSettings({ ...w.local.settings, notifyAccountReset: true });
  await w.refresh();
  assert.equal(Object.keys(w.notifications).length, 0); // No retroactive alert from sync-only events.
});

test('disabled sync preserves records, and re-enabling does not replay an old reset', async () => {
  const w = harness({ syncChatResetWithCodex: false }); await w.connect(); w.count(); await w.refresh();
  w.source.now += 1000; w.source.raw.rate_limit.primary_window.used_percent = 0;
  await w.refresh(); assert.equal(w.used(), 1);
  await w.context.saveSettings({ ...w.local.settings, syncChatResetWithCodex: true });
  await w.refresh(); assert.equal(w.used(), 1);
  w.source.now += 1000; w.source.raw.rate_limit.primary_window.used_percent = 10; await w.refresh();
  w.source.now += 1000; w.source.raw.rate_limit.primary_window.used_percent = 0; await w.refresh();
  assert.equal(w.used(), 0);
});

test('first reading, errors, mere time passage, and rounded or blocked quota do not clear Chat counts', async () => {
  const w = harness(); await w.connect(); w.count();
  w.source.raw.rate_limit.primary_window.used_percent = 0;
  w.source.raw.rate_limit.secondary_window.used_percent = 0;
  await w.refresh(); assert.equal(w.used(), 1);
  w.source.raw = structuredClone(RAW_USAGE); w.source.raw.plan_type = 'pro'; await w.refresh();
  w.source.now += 1000; w.source.status = 500; await w.refresh(); assert.equal(w.used(), 1);
  w.source.status = 200; w.source.raw.rate_limit.primary_window.used_percent = 0.4; await w.refresh(); assert.equal(w.used(), 1);
  w.source.raw.rate_limit.primary_window.used_percent = 0;
  w.source.raw.rate_limit.allowed = false; await w.refresh(); assert.equal(w.used(), 1);
  w.source.now += 2 * HOUR; await w.refresh(); assert.equal(w.used(), 1);
});

test('recovery is scoped to the quota response account and never the previously displayed Chat account', async () => {
  const w = harness(); await w.connect(); w.count(); const keyA = w.local.chatAccount.key; await w.refresh();
  w.source.user = 'B'; await w.connect(); w.count('sol', 'b'); const keyB = w.local.chatAccount.key;
  await w.refresh(); // New account baseline.
  w.source.now += 1000; w.source.raw.rate_limit.primary_window.used_percent = 0; await w.refresh();
  assert.equal(Counter.summary(w.local.chatCounters[keyA], 'pro100', w.source.now).used, 1);
  assert.equal(Counter.summary(w.local.chatCounters[keyB], 'pro100', w.source.now).used, 0);
  w.source.user = 'A'; await w.connect();
  assert.equal(w.used(), 1);
});

test('a usage workspace inconsistent with the trusted session cannot reset that Chat profile', async () => {
  const w = harness(); await w.connect(); w.count();
  w.source.raw.account_id = 'another-workspace'; await w.refresh();
  w.source.now += 1000; w.source.raw.rate_limit.primary_window.used_percent = 0; await w.refresh();
  assert.equal(w.used(), 1);
});

test('scheduled reset found on resume preserves Chat responses recorded after that boundary', async () => {
  const w = harness(); await w.connect(); w.count();
  const boundary = NOW + HOUR;
  const weekly = w.source.raw.rate_limit.secondary_window;
  weekly.reset_at = boundary / 1000; delete weekly.reset_after_seconds;
  await w.refresh();
  w.source.now = boundary + 1000; w.count('sol', 'b');
  w.source.now += HOUR;
  w.local.resumeCheck = { at: w.source.now };
  weekly.used_percent = 5; weekly.reset_at = (boundary + WEEK) / 1000;
  await w.refresh();
  assert.equal(w.used(), 1);
  assert.equal(w.profile().codexReset.effectiveAt, boundary);
  assert.equal(Counter.summary(w.profile(), 'pro100', w.source.now).astra, 0);
  assert.equal(Counter.summary(w.profile(), 'pro100', w.source.now).sol, 1);
});

test('both models resume counting after synchronization under each detected policy', () => {
  const first = Counter.record(null, { model: 'astra', key: 'a'.repeat(64) }, NOW - 1000);
  const event = { id: 'recovery:test', observedAt: NOW, windows: [{ kind: 'weekly', counterResetAt: NOW }] };
  const cleared = Counter.resetAfterCodex(first, event, NOW);
  const next = Counter.record(cleared, { model: 'sol', key: 'b'.repeat(64) }, NOW);
  assert.equal(Counter.resetAfterCodex(next, event, NOW), next);
  assert.equal(Counter.summary(next, 'pro100', NOW).remaining, 49);
  assert.equal(Counter.summary(next, 'pro200', NOW).astraRemaining, 199);
  assert.equal(Counter.summary(next, 'pro200', NOW).solRemaining, 169);
  assert.equal(Counter.summary(next, 'businessStandard', NOW).remaining, 14);
  assert.equal(Counter.summary(next, 'businessPremium', NOW).remaining, 49);
  assert.equal(Counter.summary(next, null, NOW).remaining, null);
});
