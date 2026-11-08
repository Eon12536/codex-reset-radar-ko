const test = require('node:test');
const assert = require('node:assert/strict');
const Counter = require('../src/core/chat-counter');
const { makeWorker, RAW_USAGE, json } = require('./helpers/worker');

function harness() {
  const source = { user: 'A', claim: 'plus', plan: 'pro', usageAccount: 'account-A', now: Date.now() };
  const w = makeWorker({ stored: { chatCounterSchema: 2, settings: {
    monitorChat: true, monitorAccount: true, monitorSignals: false, syncChatResetWithCodex: false
  } }, fetcher: async url => {
    if (url.endsWith('/auth/session')) return json({ accessToken: 'test.' + Buffer.from(JSON.stringify({
      sub: source.user, 'https://api.openai.com/auth': { chatgpt_user_id: source.user,
        chatgpt_account_id: 'account-' + source.user, chatgpt_plan_type: source.claim }
    })).toString('base64url') + '.signature' });
    if (url.endsWith('/usage')) {
      await source.usageGate?.();
      return json({ ...RAW_USAGE, plan_type: source.plan, account_id: source.usageAccount }, source.usageStatus || 200);
    }
    if (url.endsWith('/rate-limit-reset-credits')) return json({ available_count: 0, credits: [] });
    throw new Error('Unexpected URL');
  } });
  w.context.Date = class extends Date { static now() { return source.now; } };
  return { w, source, connect: async () => { await w.context.ensureSecurity(); return w.context.refreshChatAccount({ force: true }); },
    refresh: () => w.context.refreshAccount({ quiet: true }) };
}

test('fresh same-account quota corrects stale Plus claims and survives another session refresh', async () => {
  const h = harness(); await h.connect();
  const key = h.w.local.chatAccount.key;
  const events = [{ key: 'a'.repeat(64), model: 'astra', at: h.source.now }];
  h.w.local.chatCounters[key].events = events;
  await h.refresh();
  const settings = structuredClone(h.w.local.settings);
  await h.connect();
  assert.equal(h.w.local.chatAccount.family, 'pro');
  assert.equal(Counter.view(h.w.local, h.source.now).label, 'Pro · 세부 요금제 미확인');
  assert.deepEqual(h.w.local.chatCounters[key].events, events);
  assert.deepEqual(h.w.local.settings, settings);
  assert.equal(h.w.tabs.length, 0);
  assert.doesNotMatch(JSON.stringify(h.w.local), /account-A|test\.[A-Za-z0-9_-]+\.signature/);
});

test('popup account refresh verifies the plan without needing a separate quota refresh', async () => {
  const h = harness(); await h.connect();
  const settings = structuredClone(h.w.local.settings);
  const result = await h.w.send({ type: 'REFRESH_CHAT_ACCOUNT' }, h.w.sender('popup'));
  assert.equal(result.ok, true);
  assert.equal(Counter.view(h.w.local, h.source.now).family, 'pro');
  assert.equal(h.w.requests.filter(r => r.url.endsWith('/usage')).length, 1);
  assert.equal(h.w.requests.filter(r => r.url.endsWith('/rate-limit-reset-credits')).length, 0);
  assert.equal(h.w.tabs.length, 0);
  assert.deepEqual(h.w.local.settings, settings);
  assert.equal(h.w.local.accountSnapshot, undefined);
  assert.deepEqual(h.w.notifications, {});
});

test('manual plan check cannot silently skip a Pro upgrade because the old token says Plus', async () => {
  const h = harness(); await h.connect();
  const result = await h.w.context.refreshChatPlan();
  assert.equal(h.w.local.chatAccount.family, 'pro');
  // This harness denies scripting: generic Pro is verified, the price tier is not.
  assert.equal(result.code, 'permission');
  assert.equal(Counter.view(h.w.local, h.source.now).plan, null);
});

test('automatic plan selection revalidates the stale family before returning success', async () => {
  const h = harness(); await h.connect();
  const result = await h.w.send({ type: 'SET_CHAT_PLAN_CHOICE', plan: 'auto',
    accountKey: h.w.local.chatAccount.key }, h.w.sender('popup'));
  assert.equal(h.w.local.chatAccount.family, 'pro');
  assert.notEqual(result.plan, 'plus');
});

test('plan-only refresh respects private monitoring OFF', async () => {
  const h = harness(); h.w.local.settings.monitorAccount = false;
  await h.w.send({ type: 'REFRESH_CHAT_ACCOUNT' }, h.w.sender('popup'));
  assert.equal(h.w.requests.some(r => r.url.endsWith('/usage')), false);
  assert.equal(h.w.local.chatAccount.family, 'plus');
});

test('overlapping plan checks share one read and recent popup checks do not loop requests', async () => {
  const h = harness(); await h.connect();
  await Promise.all(Array.from({ length: 4 }, () => h.w.send({ type: 'REFRESH_CHAT_ACCOUNT' }, h.w.sender('popup'))));
  await h.w.send({ type: 'REFRESH_CHAT_ACCOUNT' }, h.w.sender('popup'));
  assert.equal(h.w.local.chatAccount.family, 'pro');
  assert.equal(h.w.requests.filter(r => r.url.endsWith('/usage')).length, 1);
});

test('late plan response cannot overwrite a newly signed-in account', async () => {
  const h = harness(); await h.connect();
  let release, started;
  const reading = new Promise(resolve => { started = resolve; });
  h.source.usageGate = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const pending = h.w.send({ type: 'REFRESH_CHAT_ACCOUNT' }, h.w.sender('popup'));
  await reading;
  h.source.user = 'B'; await h.connect();
  release(); await pending;
  assert.equal(h.w.local.chatAccount.family, 'plus');
  assert.equal(h.w.local.chatCounters[h.w.local.chatAccount.key].familyEvidence, undefined);
});

test('quota evidence does not cross accounts, override newer claims, or persist indefinitely', async () => {
  const h = harness(); await h.connect(); await h.refresh();
  h.source.user = 'B'; await h.connect();
  assert.equal(h.w.local.chatAccount.family, 'plus');
  h.source.user = 'A'; h.source.claim = 'business'; await h.connect();
  assert.equal(h.w.local.chatAccount.family, 'business');
  h.source.claim = 'plus'; h.source.now += 31 * 60000; await h.connect();
  assert.equal(h.w.local.chatAccount.family, 'unknown');
});

test('expired conflicting evidence and quota outage show unconfirmed, not a false Plus downgrade', async () => {
  const h = harness(); await h.connect(); await h.refresh();
  h.source.now += 31 * 60000; h.source.usageStatus = 503;
  await h.w.send({ type: 'REFRESH_CHAT_ACCOUNT' }, h.w.sender('popup'));
  const view = Counter.view(h.w.local, h.source.now);
  assert.equal(view.family, 'unknown');
  assert.equal(view.label, '요금제 미확인');
  assert.equal(view.plan, null);
});

test('mismatched, absent and unknown quota plans never upgrade Plus', async () => {
  for (const variant of [{ usageAccount: 'account-B' }, { plan: null }, { plan: 'new-product' }]) {
    const h = harness(); Object.assign(h.source, variant);
    await h.connect(); await h.refresh(); await h.connect();
    assert.equal(h.w.local.chatAccount.family, 'plus');
  }
});

test('unknown claims cannot extend expired quota evidence and Pro model names do not upgrade Plus', async () => {
  const now = Date.now();
  assert.equal(Counter.accountFamily({ family: 'pro', familyEvidence: {
    source: 'usage', family: 'pro', tokenFamily: 'unknown', at: now - 31 * 60000
  } }, 'unknown', now), 'unknown');
  const h = harness(); h.source.plan = null;
  await h.connect();
  h.w.local.chatCounters[h.w.local.chatAccount.key].events = [{ key: 'a'.repeat(64), model: 'astra', at: now }];
  await h.refresh(); await h.connect();
  assert.equal(h.w.local.chatAccount.family, 'plus');
});

test('actual downgrade replaces evidence without deleting a manual choice', async () => {
  const h = harness(); await h.connect(); await h.refresh();
  const key = h.w.local.chatAccount.key;
  const choice = { plan: 'pro200Current', at: h.source.now };
  h.w.local.chatCounters[key].planChoice = choice;
  await h.connect();
  assert.equal(Counter.view(h.w.local, h.source.now).plan, 'pro200Current');
  h.source.plan = 'plus'; await h.refresh(); await h.connect();
  assert.equal(Counter.view(h.w.local, h.source.now).plan, 'plus');
  assert.deepEqual(h.w.local.chatCounters[key].planChoice, choice);
});
