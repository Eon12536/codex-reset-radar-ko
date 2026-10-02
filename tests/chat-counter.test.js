const test = require('node:test');
const assert = require('node:assert/strict');
const Counter = require('../src/core/chat-counter.js');
const { makeWorker, json } = require('./helpers/worker.js');
const NOW = Date.now();
const row = (id, role = 'assistant', slug = 'gpt-6-pro') => ({ id, role, slug });
const user = id => row(id, 'user', '');
const sender = w => ({ id: w.runtime.id, url: 'https://chatgpt.com/c/test-chat', frameId: 0, tab: { id: 1 }, documentLifecycle: 'active' });
function worker() {
  const login = { user: 'test-user-A', family: 'pro' };
  const w = makeWorker({ stored: { chatCounterSchema: 2, settings: { monitorChat: true, monitorAccount: false } }, fetcher: async () => {
    if (!login.user) return json({});
    const claims = { sub: login.user, 'https://api.openai.com/auth': { chatgpt_user_id: login.user, chatgpt_account_id: 'account-' + login.user, chatgpt_plan_type: login.family } };
    return json({ accessToken: 'test.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature' });
  } });
  w.login = login;
  let scripts = [];
  w.context.chrome.permissions.contains = async () => true;
  w.context.chrome.scripting = {
    getRegisteredContentScripts: async () => scripts,
    registerContentScripts: async value => { scripts = value; },
    unregisterContentScripts: async () => { scripts = []; },
    executeScript: async () => []
  };
  w.context.chrome.tabs.query = async () => [];
  w.context.chrome.tabs.create = async options => { const tab = { ...options, id: 40 + w.tabs.length }; w.tabs.push(tab); return tab; };
  w.scripts = () => scripts;
  return w;
}

test('shared Pro $100 pool counts both models, expires observations and never goes negative', () => {
  let state;
  for (let index = 0; index < 55; index++) state = Counter.record(state, { key: index.toString(16).padStart(64, '0'), model: index % 2 ? 'sol' : 'astra' }, NOW);
  assert.deepEqual(Counter.summary(state, 'pro100', NOW), { used: 55, astra: 28, sol: 27, remaining: 0, limit: 50, days: 7 });
  assert.equal(Counter.summary(state, 'pro100', NOW + 7 * 86400000).used, 0);
  assert.equal(Counter.summary(state).remaining, null);
  assert.equal(Counter.model('gpt-6-pro'), 'astra');
  for (const slug of ['gpt-6-astra', 'gpt-6', 'unknown']) assert.equal(Counter.model(slug), null);
  for (const slug of ['gpt-5.6-sol', 'gpt-5.6']) assert.equal(Counter.model(slug), 'solStandard');
});

test('history, streamed mutations, and conversation navigation never retroactively count', () => {
  const t = Counter.tracker();
  t.reset([user('old-u'), row('old-a')], '/c/old');
  assert.deepEqual(t.scan([user('old-u'), row('old-a'), row('older-history')], '/c/old', NOW), []);
  t.arm([user('old-u'), row('old-a')], '/c/old', NOW);
  assert.deepEqual(t.scan([user('u'), row('a')], '/c/other', NOW), []);
});

test('new Chat URL transition and delayed model metadata count one response only', () => {
  const t = Counter.tracker();
  t.reset([], '/'); t.arm([], '/', NOW);
  assert.deepEqual(t.scan([user('u'), row('a', 'assistant', '')], '/c/new', NOW), []);
  assert.deepEqual(t.scan([user('u'), row('a')], '/c/new', NOW), [{ id: 'a', model: 'gpt-6-pro' }]);
  assert.deepEqual(t.scan([user('u'), row('a')], '/c/new', NOW), []);
  assert.deepEqual(t.scan([user('u'), row('regeneration')], '/c/new', NOW), []);
});

test('normal Thinking answers, stale sends, and pre-user responses cannot count as Pro', () => {
  const t = Counter.tracker(); t.reset([], '/'); t.arm([], '/', NOW);
  assert.deepEqual(t.scan([row('pre'), user('u'), row('thinking', 'assistant', 'gpt-5.6')], '/', NOW), [{ id: 'thinking', model: 'gpt-5.6' }]);
  assert.equal(Counter.model('gpt-5.6'), 'solStandard');
  t.arm([], '/', NOW);
  assert.deepEqual(t.scan([user('late-u'), row('late')], '/', NOW + 16 * 60000), []);
});

test('background deduplicates concurrent observations, stores only hashes and model, and purges on OFF', async () => {
  const w = worker();
  const { scope } = await w.send({ type: 'CHAT_COUNT_STATUS' }, sender(w));
  const message = { type: 'CHAT_COUNT_RECORD', scope, id: 'sample-response-id', model: 'gpt-6-pro' };
  await Promise.all([w.send(message, sender(w)), w.send(message, sender(w))]);
  const profile = w.local.chatCounters[w.local.chatAccount.key];
  assert.equal(profile.events.length, 1);
  assert.equal(Counter.summary(profile, 'pro100').remaining, 49);
  assert.equal(Counter.view(w.local).count.remaining, null); // Generic Pro has no assumed price tier.
  assert.equal(JSON.stringify(w.local).includes(message.id), false);
  assert.equal(w.scripts()[0].world, 'ISOLATED');
  assert.ok(w.requests.every(request => request.url.endsWith('/auth/session')));
  assert.equal(JSON.stringify(w.local).includes('test-user-A'), false);
  await w.context.saveSettings({ ...w.local.settings, monitorChat: false });
  assert.equal(w.local.chatCounters, undefined);
  assert.equal(w.local.chatAccount, undefined);
  assert.equal(w.scripts().length, 0);
  assert.equal((await w.send({ ...message, id: 'after-off' }, sender(w))).ok, false);
});

test('only same-extension top-frame Chat pages with bounded metadata may send counter events', async () => {
  const w = worker(); const { scope } = await w.send({ type: 'CHAT_COUNT_STATUS' }, sender(w));
  const message = { type: 'CHAT_COUNT_RECORD', scope, id: 'id', model: 'gpt-6-pro' };
  for (const override of [{ frameId: 1 }, { id: 'other-extension' }, { url: 'https://example.com/' }, { url: 'https://chatgpt.com/work' }, { url: 'https://chatgpt.com.evil.test/' }, { documentLifecycle: 'prerender' }]) {
    assert.equal((await w.send(message, { ...sender(w), ...override })).ok, false);
  }
  for (const override of [{ id: 'x'.repeat(129) }, { text: 'private prompt' }, { model: 'gpt-6-astra' }]) {
    assert.equal((await w.send({ ...message, ...override }, sender(w))).ok, false);
  }
  assert.equal((await w.send({ type: 'OPEN_ACCOUNT_LOGIN' }, sender(w))).ok, false);
  assert.equal((await w.send({ type: 'SAVE_SETTINGS', settings: {} }, sender(w))).ok, false);
  const status = await w.send({ type: 'CHAT_COUNT_STATUS' }, sender(w));
  assert.deepEqual(Object.keys(status).sort(), ['enabled', 'family', 'scope']);
});

async function confirmPlan(w, heading) {
  assert.equal((await w.send({ type: 'OPEN_CHAT_CONNECTION' }, w.sender('popup'))).ok, true);
  const tab = w.tabs.at(-1);
  const from = { ...sender(w), tab: { id: tab.id }, url: tab.url, documentId: 'billing-' + tab.id };
  const { scope } = await w.send({ type: 'CHAT_COUNT_STATUS' }, from);
  return w.send({ type: 'CHAT_PLAN_OBSERVED', scope, heading }, from);
}

test('current Billing evidence selects this account plan; generic Pro and stale evidence do not', async () => {
  const w = worker(); await w.context.ensureSecurity(); await w.context.refreshChatAccount({ force: true });
  assert.equal(Counter.view(w.local).plan, null);
  assert.equal((await confirmPlan(w, 'ChatGPT Pro 5x')).ok, true);
  assert.equal(Counter.view(w.local).plan, 'pro100');
  assert.equal(Counter.view(w.local).count.limit, 50);
  assert.equal((await confirmPlan(w, 'ChatGPT Pro 20x')).ok, true);
  assert.equal(Counter.view(w.local).plan, 'pro200Current');
  assert.equal(Counter.view(w.local).count.remaining, null);
  assert.deepEqual(Counter.view(w.local).meters, []);
  w.local.chatCounters[w.local.chatAccount.key].planAt = Date.now() - 86400001;
  assert.equal(Counter.view(w.local).count.remaining, null);
  assert.equal(Counter.view(w.local).plan, 'pro200Current');
  assert.equal(Counter.view(w.local).planSource, 'cached');
  w.local.chatCounters[w.local.chatAccount.key].planAt = Date.now() - 7 * 86400000;
  assert.equal(Counter.view(w.local).plan, null);
});

test('an unrequested billing tab, pricing text, or another account family cannot assign a plan', async () => {
  const w = worker(); const from = { ...sender(w), url: 'https://chatgpt.com/#settings/Billing' };
  const { scope } = await w.send({ type: 'CHAT_COUNT_STATUS' }, from);
  assert.equal((await w.send({ type: 'CHAT_PLAN_OBSERVED', scope, heading: 'ChatGPT Pro 5x' }, from)).ok, false);
  for (const heading of ['Pro', 'Upgrade to ChatGPT Pro 5x', 'ChatGPT Pro', 'ChatGPT Pro $100 sale']) assert.equal(Counter.planFromHeading(heading), null);
  w.login.family = 'plus';
  assert.equal((await confirmPlan(w, 'ChatGPT Pro 5x')).ok, false);
  assert.equal(Counter.view(w.local).label, 'Plus');
});

test('account switches reject the old document scope and keep separate counters when switching back', async () => {
  const w = worker(); const fromA = { ...sender(w), documentId: 'document-A' };
  const statusA = await w.send({ type: 'CHAT_COUNT_STATUS' }, fromA);
  const countA = { type: 'CHAT_COUNT_RECORD', scope: statusA.scope, id: 'response-A', model: 'gpt-6-pro' };
  assert.equal((await w.send(countA, fromA)).ok, true);
  const keyA = w.local.chatAccount.key;
  w.login.user = 'test-user-B';
  assert.equal((await w.send({ ...countA, id: 'late-from-A' }, fromA)).ok, false);
  assert.equal((await w.send({ type: 'CHAT_COUNT_STATUS' }, fromA)).enabled, false);
  const fromB = { ...sender(w), documentId: 'document-B', tab: { id: 2 } };
  const statusB = await w.send({ type: 'CHAT_COUNT_STATUS' }, fromB);
  assert.equal((await w.send({ ...countA, scope: statusB.scope, id: 'response-B' }, fromB)).ok, true);
  assert.equal(w.local.chatCounters[keyA].events.length, 1);
  assert.equal(w.local.chatCounters[w.local.chatAccount.key].events.length, 1);
  assert.notEqual(keyA, w.local.chatAccount.key);
  w.login.user = 'test-user-A'; await w.context.refreshChatAccount({ force: true });
  assert.equal(w.local.chatAccount.key, keyA);
  assert.equal(Counter.view(w.local).count.used, 1);
  w.login.user = null; await w.context.refreshChatAccount({ force: true });
  assert.equal(Counter.view(w.local).connected, false);
});

test('Pro 200 intersects weekly Astra, daily Sol Pro and combined daily budgets', () => {
  let state;
  for (let index = 0; index < 195; index++) state = Counter.record(state, { key: index.toString(16).padStart(64, '0'), model: 'astra' }, NOW - 2 * 86400000);
  for (let index = 200; index < 370; index++) state = Counter.record(state, { key: index.toString(16).padStart(64, '0'), model: 'sol' }, NOW);
  const count = Counter.summary(state, 'pro200', NOW);
  assert.equal(count.astraRemaining, 5);
  assert.equal(count.solRemaining, 0);
  for (let index = 400; index < 430; index++) state = Counter.record(state, { key: index.toString(16).padStart(64, '0'), model: 'astra' }, NOW);
  assert.equal(Counter.summary(state, 'pro200', NOW).astraRemaining, 0);
});

test('legacy browser-profile counts are never assigned to a newly connected account', async () => {
  const w = makeWorker({ stored: { settings: { monitorChat: true }, chatCounter: { events: [{ key: 'a'.repeat(64), model: 'astra', at: NOW }] } } });
  await w.context.ensureSecurity();
  assert.equal(w.local.settings.monitorChat, false);
  assert.equal(w.local.chatCounter, undefined);
  assert.equal(w.local.chatCounterSchema, 2);
  assert.equal(w.requests.length, 0);
});

test('account scope survives a service worker restart during a long Pro answer', async () => {
  const w = worker(); const from = { ...sender(w), documentId: 'long-answer-document' };
  const first = await w.send({ type: 'CHAT_COUNT_STATUS' }, from);
  const restarted = worker();
  Object.assign(restarted.local, structuredClone(w.local));
  Object.assign(restarted.session, structuredClone(w.session));
  const resumed = await restarted.send({ type: 'CHAT_COUNT_STATUS' }, from);
  assert.equal(resumed.scope, first.scope);
  assert.equal((await restarted.send({ type: 'CHAT_COUNT_RECORD', id: 'long-answer', model: 'gpt-6-pro', scope: first.scope }, from)).ok, true);
  assert.equal(Counter.view(restarted.local).count.used, 1);
});

test('Business budgets require their exact tier and do not inherit personal Pro limits', () => {
  assert.equal(Counter.summary(null, 'businessStandard').limit, 15);
  assert.equal(Counter.summary(null, 'businessPremium').limit, 50);
  assert.equal(Counter.summary(null, 'business').limit, null);
  assert.equal(Counter.verifiedPlan({ plan: 'pro100', planAt: NOW }, 'business', NOW), null);
});

test('enabling requires scripting permission and a trusted popup gesture message', async () => {
  const w = makeWorker({ stored: { settings: { monitorChat: false, monitorAccount: false } } });
  assert.equal((await w.send({ type: 'ENABLE_CHAT_COUNTER' }, w.sender('popup'))).ok, false);
  assert.equal(w.local.settings.monitorChat, false);
  const granted = worker(); granted.local.settings.monitorChat = false;
  assert.equal((await granted.send({ type: 'ENABLE_CHAT_COUNTER' }, granted.sender('popup'))).ok, true);
  assert.equal(granted.local.settings.monitorChat, true);
});
