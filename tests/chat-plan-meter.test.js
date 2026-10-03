const test = require('node:test');
const assert = require('node:assert/strict');
const Counter = require('../src/core/chat-counter');
const { makeWorker, json } = require('./helpers/worker');
const now = Date.now(), day = 86400000;

test('shared meter uses the remaining allowance and never invents an unknown percentage', () => {
  const profile = { events: Array.from({ length: 31 }, (_, i) => ({ key: i.toString(16).padStart(64, '0'), model: 'astra', at: now })) };
  assert.deepEqual(Counter.meters(Counter.summary(profile, 'pro100', now), 'pro100'),
    [{ id: 'shared', label: 'Astra + Sol Pro', remaining: 19, limit: 50, days: 7, percent: 38 }]);
  assert.deepEqual(Counter.meters(Counter.summary(profile, null, now), null), []);
  assert.equal(Counter.meters(Counter.summary({}, 'pro100', now), 'pro100')[0].percent, 100);
  assert.equal(Counter.meters({ remaining: 29 }, 'pro100')[0].percent, 58);
  assert.equal(Counter.meters(Counter.summary(profile, 'businessStandard', now), 'businessStandard')[0].percent, 0);
});

test('Pro 200 bars respect both model and combined daily limits', () => {
  const profile = { events: Array.from({ length: 195 }, (_, i) => ({ key: i.toString(16).padStart(64, '0'), model: 'astra', at: now })) };
  const bars = Counter.meters(Counter.summary(profile, 'pro200', now), 'pro200');
  assert.deepEqual(bars.map(row => [row.remaining, row.limit]), [[5, 200], [5, 170]]);
});

test('dated plan fallback is bounded, labelled, and restricted to the same family', () => {
  const profile = { plan: 'pro100', planAt: now - 2 * day };
  assert.equal(Counter.verifiedPlan(profile, 'pro', now), null);
  assert.equal(Counter.planEvidence(profile, 'pro', now).source, 'cached');
  assert.equal(Counter.planEvidence(profile, 'business', now).plan, null);
  assert.equal(Counter.planEvidence(profile, 'pro', now + 5 * day).plan, null);
  profile.planChoice = { plan: 'pro200', at: now };
  assert.equal(Counter.planEvidence(profile, 'pro', now).source, 'selected');
  assert.equal(Counter.planEvidence(profile, 'pro', now + 30 * day).plan, null);
  profile.planAt = now + 1;
  assert.equal(Counter.planEvidence(profile, 'pro', now + 2).plan, 'pro100');
});

function worker() {
  const login = { account: 'account-a', family: 'pro' };
  const w = makeWorker({ stored: { chatCounterSchema: 2, chatPolicySchema: 1,
    settings: { monitorChat: true, syncChatHistory: false, monitorAccount: false, monitorSignals: false } }, fetcher: async () => json({
    accessToken: 'test.' + Buffer.from(JSON.stringify({ sub: 'user', 'https://api.openai.com/auth': {
      chatgpt_user_id: 'user', chatgpt_account_id: login.account, chatgpt_plan_type: login.family }
    })).toString('base64url') + '.sig'
  }) });
  return { w, login };
}

test('user plan selection applies only to the verified account without changing history or subscription', async () => {
  const { w, login } = worker();
  await w.context.ensureSecurity(); await w.context.refreshChatAccount({ force: true });
  const key = w.local.chatAccount.key;
  const event = { key: 'f'.repeat(64), model: 'astra', at: now };
  w.local.chatCounters[key].events = [event];
  const select = { type: 'SET_CHAT_PLAN_CHOICE', accountKey: key, plan: 'pro100' };
  assert.equal((await w.send(select, w.sender('popup'))).ok, true);
  assert.equal(Counter.view(w.local).count.remaining, 49);
  assert.equal(Counter.view(w.local).planSource, 'selected');
  assert.deepEqual(w.local.chatCounters[key].events, [event]);
  assert.ok(w.requests.every(request => request.options.method === 'GET' && request.url.endsWith('/auth/session')));
  assert.equal((await w.send({ ...select, plan: 'businessStandard' }, w.sender('popup'))).ok, false);
  for (const plan of ['free', 'go', 'plus', 'enterprise', 'edu'])
    assert.equal((await w.send({ ...select, plan }, w.sender('popup'))).ok, false);
  assert.equal((await w.send(select, { ...w.sender('popup'), url: 'https://chatgpt.com/' })).ok, false);
  assert.equal((await w.send({ ...select, plan: 'fake' }, w.sender('popup'))).ok, false);
  login.account = 'account-b';
  assert.equal((await w.send(select, w.sender('popup'))).ok, false);
  assert.equal(Counter.view(w.local).plan, null);
  login.account = 'account-a';
  assert.equal((await w.send({ ...select, plan: 'auto' }, w.sender('popup'))).ok, false);
  assert.equal(Counter.view(w.local).plan, 'pro100'); // Permission failure preserves the prior selection.
});

test('an older popup cannot restore a retired Pro 200 allowance through a stale selection message', async () => {
  const { w } = worker();
  await w.context.ensureSecurity(); await w.context.refreshChatAccount({ force: true });
  const accountKey = w.local.chatAccount.key;
  const events = [{ key: 'e'.repeat(64), model: 'astra', at: now }];
  w.local.chatCounters[accountKey].events = events;
  assert.equal((await w.send({ type: 'SET_CHAT_PLAN_CHOICE', accountKey, plan: 'pro200' }, w.sender('popup'))).ok, true);
  assert.equal(w.local.chatCounters[accountKey].planChoice.plan, 'pro200Current');
  const view = Counter.view(w.local);
  assert.equal(view.plan, 'pro200Current');
  assert.equal(view.count.astra, 1);
  assert.equal(view.count.remaining, null);
  assert.deepEqual(view.meters, []);
  assert.deepEqual(w.local.chatCounters[accountKey].events, events);
});

test('account-level plans support manual and automatic selection without billing access or losing counts', async () => {
  for (const family of ['free', 'go', 'plus', 'enterprise', 'edu']) {
    const { w, login } = worker();
    login.family = family;
    await w.context.ensureSecurity(); await w.context.refreshChatAccount({ force: true });
    const accountKey = w.local.chatAccount.key;
    const events = [{ key: 'c'.repeat(64), model: family === 'free' || family === 'go' ? 'luna' : 'solStandard', at: now }];
    w.local.chatCounters[accountKey].events = events;
    assert.equal(Counter.view(w.local).plan, family);
    assert.equal((await w.send({ type: 'SET_CHAT_PLAN_CHOICE', accountKey, plan: family }, w.sender('popup'))).ok, true);
    assert.equal(Counter.view(w.local).planSource, 'selected');
    assert.equal((await w.send({ type: 'SET_CHAT_PLAN_CHOICE', accountKey, plan: 'pro100' }, w.sender('popup'))).ok, false);
    assert.equal((await w.send({ type: 'SET_CHAT_PLAN_CHOICE', accountKey, plan: 'auto' }, w.sender('popup'))).ok, true);
    const view = Counter.view(w.local);
    assert.equal(view.plan, family);
    assert.equal(view.planSource, 'account');
    assert.equal(view.modelCounts[events[0].model], 1);
    assert.equal(view.count.remaining, null);
    assert.deepEqual(view.meters, []);
    assert.deepEqual(w.local.chatCounters[accountKey].events, events);
    assert.equal(w.local.chatCounters[accountKey].planChoice, null);
    assert.equal(w.tabs.length, 0);
    assert.ok(w.requests.every(request => request.options.method === 'GET' && request.url.endsWith('/auth/session')));
  }
});

test('refresh preserves dated plan evidence instead of erasing it after one day', async () => {
  const { w } = worker();
  await w.context.ensureSecurity(); await w.context.refreshChatAccount({ force: true });
  const key = w.local.chatAccount.key;
  Object.assign(w.local.chatCounters[key], { plan: 'pro100', planAt: now - 2 * day });
  await w.context.refreshChatAccount({ force: true });
  assert.equal(w.local.chatCounters[key].planAt, now - 2 * day);
  assert.equal(Counter.view(w.local).planSource, 'cached');
});
