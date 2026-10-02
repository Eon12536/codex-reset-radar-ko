const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json } = require('./helpers/worker');
const Counter = require('../src/core/chat-counter');
const History = require('../src/core/chat-history');
const crypto = require('node:crypto');
const hash = async value => crypto.createHash('sha256').update(value).digest('hex');
const now = Date.now();
const message = (id, slug, metadata = {}) => ({ id, author: { role: 'assistant' }, create_time: now / 1000,
  status: 'finished_successfully', end_turn: true, metadata: { model_slug: slug, ...metadata } });

test('Sol and Luna observations never consume the Pro shared or combined pools', () => {
  let state;
  for (let i = 0; i < 300; i++) state = Counter.record(state, { key: i.toString(16).padStart(64, '0'), model: i % 2 ? 'solStandard' : 'luna' }, now);
  assert.equal(Counter.summary(state, 'pro100', now).remaining, 50);
  assert.equal(Counter.summary(state, 'pro200', now).astraRemaining, 200);
  assert.equal(Counter.summary(state, 'pro200', now).solRemaining, 170);
  assert.equal(Counter.modelCounts(state, now).solStandard, 150);
  assert.equal(Counter.modelCounts(state, now).luna, 150);
});

test('model catalog distinguishes actual Pro metadata, ordinary thinking, and unsupported product aliases', () => {
  const projected = History.project({ messages: [
    message('astra-001', 'gpt-6-pro'), message('sol-pro01', 'gpt-5.6-sol-pro'),
    message('sol-pro02', 'gpt-5.6', { reasoning_effort: 'pro' }),
    message('sol-high1', 'gpt-5.6', { reasoning_effort: 'high' }),
    message('sol-xhigh', 'gpt-5.6', { reasoning_effort: 'xhigh' }),
    message('luna-0001', 'gpt-5.6-luna'), message('work-0001', 'gpt-6-pro', { product: 'work' }),
    message('future001', 'gpt-7-pro'), message('codex-001', 'gpt-6-astra')
  ] }, now, { family: 'pro' });
  assert.deepEqual(projected.entries.map(e => e.model), ['astra', 'sol', 'sol', 'solStandard', 'solStandard', 'luna']);
  assert.equal(projected.unknown, 2);
  assert.equal(Counter.model('gpt-5.6-instant', { family: 'free' }), 'luna');
  assert.equal(Counter.model('gpt-5.6-instant', { family: 'plus' }), 'solStandard');
  assert.equal(Counter.model('gpt-5.6-instant'), null);
});

test('a model parser upgrade revisits unchanged history and retains metadata-only counts', async () => {
  const calls = [];
  const read = async url => {
    calls.push(url);
    return url.includes('is_archived=true') ? { items: [], total: 0 } : url.includes('is_archived=false')
      ? { items: [{ id: 'thread-0001', update_time: now / 1000 }], total: 1 }
      : { messages: [message('response-001', 'gpt-5.6-sol-pro')], title: 'PRIVATE' };
  };
  const previous = { historyCache: { [await hash('conversation:thread-0001')]: { updatedAt: now, unknown: 1 } } };
  const first = await History.collect({ read, hash, now, previous });
  assert.equal(first.history.scanned, 1);
  assert.equal(first.historyEvents[0].model, 'sol');
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE|thread-0001|response-001/);
  const second = await History.collect({ read, hash, now, previous: first });
  assert.equal(second.history.reused, 1);
  assert.equal(second.historyEvents.length, 1);
});

function worker({ family = 'pro', reply = true, activeAfter = false, settings = {} } = {}) {
  let details = 0;
  const login = { account: 'account-1' };
  const w = makeWorker({ stored: { chatCounterSchema: 2, settings: { monitorChat: true, syncChatHistory: true,
    monitorSignals: false, monitorAccount: false, ...settings } }, fetcher: async url => {
    if (url.endsWith('/auth/session')) return json({ accessToken: 'test.' + Buffer.from(JSON.stringify({ sub: 'test-user',
      'https://api.openai.com/auth': { chatgpt_user_id: 'test-user', chatgpt_account_id: login.account, chatgpt_plan_type: family }
    })).toString('base64url') + '.signature' });
    if (url.includes('is_archived=true')) return json({ items: [], total: 0 });
    if (url.includes('is_archived=false')) return json({ items: [{ id: 'thread-0001', update_time: Date.now() / 1000 }], total: 1 });
    details++;
    return json({ messages: [message('response-001', 'gpt-5.6-sol-pro')] });
  } });
  const removed = [];
  w.context.chrome.permissions.contains = async () => true;
  w.context.chrome.scripting = { getRegisteredContentScripts: async () => [{ id: 'radar-chat-counter' }], unregisterContentScripts: async () => {} };
  w.context.chrome.tabs.query = async () => [];
  w.context.chrome.tabs.get = async id => ({ id, url: 'https://chatgpt.com/#settings/Billing', active: activeAfter });
  w.context.chrome.tabs.remove = async id => removed.push(id);
  w.context.chrome.tabs.create = async options => {
    const tab = { ...options, id: 80 + w.tabs.length }; w.tabs.push(tab);
    if (reply) setTimeout(async () => {
      const sender = { id: w.runtime.id, frameId: 0, tab: { id: tab.id }, url: tab.url, documentId: 'plan-' + tab.id };
      const status = await w.send({ type: 'CHAT_COUNT_STATUS' }, sender);
      await w.send({ type: 'CHAT_PLAN_OBSERVED', scope: status.scope, heading: 'ChatGPT Pro 5x' }, sender);
    }, 10);
    return tab;
  };
  w.context.setTimeout = (fn, delay) => setTimeout(fn, delay === 45000 ? reply ? 1000 : 15 : 0);
  return { w, removed, details: () => details, login };
}

async function selected(w, plan = 'pro200') {
  await w.context.ensureSecurity(); await w.context.refreshChatAccount({ force: true });
  const accountKey = w.local.chatAccount.key;
  assert.equal((await w.send({ type: 'SET_CHAT_PLAN_CHOICE', accountKey, plan }, w.sender('popup'))).ok, true);
  return accountKey;
}

test('selecting automatic actually verifies billing and preserves the current meter until success', async () => {
  const { w, removed } = worker();
  const accountKey = await selected(w);
  const create = w.context.chrome.tabs.create;
  w.context.chrome.tabs.create = async options => {
    assert.equal(Counter.view(w.local).plan, 'pro200Current');
    assert.equal(Counter.view(w.local).planSource, 'selected');
    assert.equal(Counter.view(w.local).planCheck.status, 'running');
    return create(options);
  };
  const result = await w.send({ type: 'SET_CHAT_PLAN_CHOICE', accountKey, plan: 'auto' }, w.sender('popup'));
  assert.equal(result.ok, true);
  assert.equal(w.tabs.length, 1);
  assert.equal(Counter.view(w.local).plan, 'pro100');
  assert.equal(Counter.view(w.local).planSource, 'verified');
  assert.equal(w.local.chatCounters[accountKey].planChoice, null);
  assert.deepEqual(removed, [80]);
});

test('automatic selection timeout preserves manual evidence, count and meter after reopening', async () => {
  const { w } = worker({ reply: false });
  const accountKey = await selected(w, 'pro100');
  w.local.chatCounters[accountKey].events = Array.from({ length: 31 }, (_, i) => ({ key: i.toString(16).padStart(64, '0'), model: 'astra', at: Date.now() }));
  const before = structuredClone(w.local.chatCounters[accountKey]);
  const result = await w.send({ type: 'SET_CHAT_PLAN_CHOICE', accountKey, plan: 'auto' }, w.sender('popup'));
  assert.equal(result.code, 'plan-check-failed');
  assert.equal(w.tabs.length, 1);
  assert.deepEqual(w.local.chatCounters[accountKey].planChoice, before.planChoice);
  assert.deepEqual(w.local.chatCounters[accountKey].events, before.events);
  const reopened = Counter.view(structuredClone(w.local));
  assert.equal(reopened.meters[0].percent, 38);
  assert.equal(reopened.planSource, 'selected');
  assert.equal(reopened.planCheck.status, 'failed');
});

test('late automatic results cannot overwrite a newer manual choice', async () => {
  const { w } = worker({ reply: false });
  w.context.setTimeout = (fn, delay) => setTimeout(fn, delay === 45000 ? 1000 : 0);
  const accountKey = await selected(w, 'pro100');
  let ready;
  const registered = new Promise(resolve => { ready = resolve; });
  const original = w.context.chrome.storage.session.set;
  w.context.chrome.storage.session.set = async data => { await original(data); if (Object.keys(data.chatPlanTabsV2 || {}).length) ready(); };
  const attempt = w.send({ type: 'SET_CHAT_PLAN_CHOICE', accountKey, plan: 'auto' }, w.sender('popup'));
  await registered;
  await w.send({ type: 'SET_CHAT_PLAN_CHOICE', accountKey, plan: 'pro200' }, w.sender('popup'));
  const from = { id: w.runtime.id, frameId: 0, tab: { id: 80 }, url: w.tabs[0].url, documentId: 'late-billing' };
  const { scope } = await w.send({ type: 'CHAT_COUNT_STATUS' }, from);
  assert.equal((await w.send({ type: 'CHAT_PLAN_OBSERVED', scope, heading: 'ChatGPT Pro 5x' }, from)).ok, false);
  assert.equal((await attempt).ok, false);
  assert.equal(Counter.view(w.local).plan, 'pro200Current');
  assert.equal(Counter.view(w.local).planSource, 'selected');
});

test('account switch during automatic lookup cannot carry the previous choice to the new account', async () => {
  const { w, login } = worker({ reply: false });
  const accountKey = await selected(w, 'pro100');
  const create = w.context.chrome.tabs.create;
  w.context.chrome.tabs.create = async options => {
    const tab = await create(options);
    login.account = 'account-2';
    await w.context.refreshChatAccount({ force: true });
    return tab;
  };
  const result = await w.send({ type: 'SET_CHAT_PLAN_CHOICE', accountKey, plan: 'auto' }, w.sender('popup'));
  assert.equal(result.ok, false);
  assert.notEqual(w.local.chatAccount.key, accountKey);
  assert.equal(Counter.view(w.local).plan, null);
  assert.equal(w.local.chatCounters[accountKey].planChoice.plan, 'pro100');
});

test('one manual refresh confirms the account tier and synchronizes account history without separate buttons', async () => {
  const { w, removed, details } = worker();
  const result = await w.send({ type: 'REFRESH_NOW' }, w.sender('popup'));
  assert.equal(result.chatPlan.ok, true);
  assert.equal(result.chatHistory.ok, true);
  assert.equal(w.tabs.length, 1);
  assert.equal(w.tabs[0].active, false);
  assert.deepEqual(removed, [80]);
  assert.equal(Counter.view(w.local).plan, 'pro100');
  assert.equal(Counter.view(w.local).count.sol, 1);
  assert.equal(Counter.view(w.local).count.remaining, 49);
  const before = details();
  await w.send({ type: 'REFRESH_NOW' }, w.sender('popup'));
  assert.ok(details() > before, 'manual refresh is not hidden by the 30-second cooldown');
  assert.equal(Counter.view(w.local).count.sol, 1, 'same response is not counted twice');
});

test('a fast billing response before waiter registration still completes the refresh', async () => {
  const { w, removed } = worker({ reply: false });
  const original = w.context.chrome.storage.session.set;
  let sent = false;
  w.context.chrome.storage.session.set = async data => {
    await original(data);
    if (sent || !Object.keys(data.chatPlanTabsV2 || {}).length) return;
    sent = true;
    const sender = { id: w.runtime.id, frameId: 0, tab: { id: 80 },
      url: 'https://chatgpt.com/#settings/Billing', documentId: 'fast-billing' };
    const status = await w.send({ type: 'CHAT_COUNT_STATUS' }, sender);
    await w.send({ type: 'CHAT_PLAN_OBSERVED', scope: status.scope, heading: 'ChatGPT Pro 5x' }, sender);
  };
  const result = await w.send({ type: 'REFRESH_NOW' }, w.sender('popup'));
  assert.equal(result.chatPlan.ok, true);
  assert.equal(Counter.view(w.local).plan, 'pro100');
  assert.deepEqual(removed, [80]);
});

test('a worker restart cannot leave an old plan check displayed as running forever', () => {
  const data = { settings: { monitorChat: true }, chatAccount: { status: 'connected', family: 'pro', key: 'a', checkedAt: now },
    chatCounters: { a: { planCheck: { status: 'running', checkedAt: now - 61000 } } } };
  assert.equal(Counter.view(data, now).planCheck.status, 'timeout');
  assert.equal(Counter.view(data, now).count.remaining, null);
});

test('plan failure does not prevent history sync and does not assume the Pro price tier', async () => {
  const { w, removed } = worker({ reply: false });
  const result = await w.send({ type: 'REFRESH_NOW' }, w.sender('popup'));
  assert.equal(result.chatPlan.ok, false);
  assert.equal(result.chatHistory.ok, true);
  assert.equal(Counter.view(w.local).plan, null);
  assert.equal(Counter.view(w.local).count.sol, 1);
  assert.equal(Counter.view(w.local).planCheck.status, 'timeout');
  assert.deepEqual(removed, [80]);
});

test('automatic plan check never closes a tab the user activated', async () => {
  const { w, removed } = worker({ activeAfter: true });
  await w.send({ type: 'REFRESH_NOW' }, w.sender('popup'));
  assert.deepEqual(removed, []);
});

test('refresh honors account-history opt-out and never opens billing for periodic polls', async () => {
  const { w } = worker({ settings: { syncChatHistory: false } });
  await w.events.alarm({ name: 'codex-reset-radar-poll' });
  assert.equal(w.tabs.length, 0);
  assert.equal(w.requests.length, 0);
  const manual = await w.send({ type: 'REFRESH_NOW' }, w.sender('popup'));
  assert.equal(manual.chatHistory.skipped, true);
  assert.ok(w.requests.every(request => request.url.endsWith('/auth/session')));
  const off = worker({ settings: { monitorChat: false } });
  await off.w.send({ type: 'REFRESH_NOW' }, off.w.sender('popup'));
  assert.equal(off.w.tabs.length, 0);
  assert.equal(off.w.requests.length, 0);
});

test('migration restores stored Chat counts excluded by an unrelated Codex reset, without deleting them', async () => {
  const { w } = worker({ settings: { syncChatResetWithCodex: true, syncChatHistory: false } });
  await w.context.ensureSecurity();
  assert.equal(w.local.settings.syncChatResetWithCodex, false);
  await w.context.refreshChatAccount({ force: true });
  const profile = w.local.chatCounters[w.local.chatAccount.key];
  profile.events = [{ key: 'a'.repeat(64), model: 'astra', at: now, beforeCodexReset: true }];
  profile.codexReset = { effectiveAt: now + 1 };
  assert.equal(Counter.view(w.local).count.astra, 1);
  assert.equal(profile.events.length, 1);
  assert.equal(Counter.view(w.local).codexReset, null);
});
