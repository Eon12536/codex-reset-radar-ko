const test = require('node:test');
const assert = require('node:assert/strict');
const Counter = require('../src/core/chat-counter');
const { makeWorker, json, RAW_USAGE } = require('./helpers/worker');

function card({ name = 'ChatGPT Pro 100', marker = '플랜 자동 갱신: 2030년 12월 4일', hidden = false, invoice = false, offer = false } = {}) {
  const heading = { textContent: name, children: [], closest: () => offer, getClientRects: () => hidden ? [] : [{}] };
  const panel = { parentElement: null, querySelector: () => invoice, querySelectorAll: () => [heading] };
  return { textContent: marker, closest: () => invoice || hidden, getClientRects: () => hidden ? [] : [{}],
    parentElement: { parentElement: panel, querySelector: () => false, querySelectorAll: () => [] } };
}

test('observed current-plan DIV and renewal paragraph yield Pro 100, excluding invoice Plus', () => {
  const doc = { querySelectorAll: () => [card(), card({ name: 'ChatGPT Plus', invoice: true })] };
  assert.equal(Counter.currentBillingHeading(doc), 'ChatGPT Pro 100');
  assert.equal(Counter.planFromHeading(Counter.currentBillingHeading(doc)), 'pro100');
});

test('hidden, invoice, offer, unrelated and conflicting cards cannot prove a subscription', () => {
  for (const values of [[{ hidden: true }], [{ invoice: true }], [{ offer: true }],
    [{ marker: 'Upgrade now' }], [{}, { name: 'ChatGPT Plus' }]]) {
    assert.equal(Counter.currentBillingHeading({ querySelectorAll: () => values.map(card) }), null);
  }
});

test('only exact legacy and current billing routes are permitted', () => {
  for (const url of ['https://chatgpt.com/settings/billing', 'https://chatgpt.com/settings/billing/', 'https://chatgpt.com/#settings/Billing']) assert.equal(Counter.billingUrl(url), true);
  for (const url of ['https://chatgpt.com/c/billing', 'https://chatgpt.com/settings/billing/upgrade', 'https://chatgpt.com.evil.test/settings/billing', 'https://evil@chatgpt.com/settings/billing', 'https://chatgpt.com/settings/billing?next=bad']) assert.equal(Counter.billingUrl(url), false);
  assert.equal(Counter.chatUrl('https://chatgpt.com/settings/billing'), false, 'billing is never a conversation counter page');
});

function worker({ contentMessages = true } = {}) {
  const w = makeWorker({ stored: { chatCounterSchema: 2, settings: { monitorChat: true, monitorAccount: true, monitorSignals: false, syncChatHistory: false } }, fetcher: async url => {
    if (url.endsWith('/auth/session')) return json({ accessToken: 'test.' + Buffer.from(JSON.stringify({ sub: 'test-user',
      'https://api.openai.com/auth': { chatgpt_user_id: 'test-user', chatgpt_account_id: 'test-account', chatgpt_plan_type: 'plus' }
    })).toString('base64url') + '.signature' });
    if (url.endsWith('/usage')) return json({ ...RAW_USAGE, plan_type: 'plus' });
    if (url.endsWith('/rate-limit-reset-credits')) return json({ available_count: 0, credits: [] });
    throw Error('Unexpected URL');
  } });
  const removed = [];
  w.context.chrome.permissions.contains = async () => true;
  w.context.chrome.tabs.query = async () => [];
  w.context.chrome.tabs.get = async id => ({ id, windowId: 1, url: 'https://chatgpt.com/settings/billing', active: false });
  w.context.chrome.tabs.remove = async id => removed.push(id);
  w.context.chrome.tabs.create = async options => {
    const tab = { ...options, id: 90 + w.tabs.length, windowId: 1 }; w.tabs.push(tab);
    if (contentMessages) setTimeout(async () => {
      const sender = { id: w.runtime.id, frameId: 0, tab: { id: tab.id }, url: tab.url, documentId: 'current-plan-' + tab.id };
      const status = await w.send({ type: 'CHAT_COUNT_STATUS' }, sender);
      await w.send({ type: 'CHAT_PLAN_OBSERVED', scope: status.scope, heading: 'ChatGPT Pro 100', currentPlan: true }, sender);
    }, 10);
    return tab;
  };
  w.context.setTimeout = (fn, delay) => setTimeout(fn, delay === 45000 ? 1000 : 0);
  return { w, removed };
}

test('popup verifies actual Pro billing despite Plus JWT and quota, closes the owned tab and preserves records', async () => {
  const { w, removed } = worker(); await w.context.ensureSecurity(); await w.context.refreshChatAccount({ force: true });
  const key = w.local.chatAccount.key;
  const events = [{ key: 'a'.repeat(64), model: 'astra', at: Date.now() }];
  w.local.chatCounters[key].events = events;
  w.local.chatCounters[key].planCheck = { status: 'confirmed', checkedAt: Date.now() };
  const settings = structuredClone(w.local.settings);
  await w.send({ type: 'REFRESH_CHAT_ACCOUNT' }, w.sender('popup'));
  assert.equal(Counter.view(w.local).plan, 'pro100');
  assert.equal(Counter.view(w.local).planSource, 'verified');
  assert.deepEqual(removed, [90]);
  assert.equal(w.tabs[0].url, 'https://chatgpt.com/settings/billing');
  await w.context.refreshChatPlanAccount({ force: true });
  await w.context.refreshAccount({ quiet: true });
  await w.context.refreshChatAccount({ force: true });
  assert.equal(Counter.view(w.local).plan, 'pro100', 'lagging quota and JWT cannot erase the current billing card');
  await w.send({ type: 'REFRESH_CHAT_ACCOUNT' }, w.sender('popup'));
  assert.equal(w.tabs.length, 1, 'fresh confirmation does not open repeated tabs');
  assert.deepEqual(w.local.settings, settings);
  assert.deepEqual(w.local.chatCounters[key].events, events);
});

test('an unrelated current-plan message cannot change family or record Chat usage on billing pages', async () => {
  const { w } = worker(); await w.context.ensureSecurity();
  const sender = { id: w.runtime.id, frameId: 0, tab: { id: 777 }, url: 'https://chatgpt.com/settings/billing', documentId: 'unrequested' };
  const status = await w.send({ type: 'CHAT_COUNT_STATUS' }, sender);
  assert.equal((await w.send({ type: 'CHAT_PLAN_OBSERVED', scope: status.scope, heading: 'ChatGPT Pro 100', currentPlan: true }, sender)).ok, false);
  assert.equal(w.local.chatAccount.family, 'plus');
  assert.equal((await w.send({ type: 'CHAT_COUNT_RECORD', scope: status.scope, id: 'not-a-message', model: 'gpt-6-pro' }, sender)).ok, false);
});

test('opening the popup never overwrites a user-selected plan', async () => {
  const { w } = worker(); await w.context.ensureSecurity(); await w.context.refreshChatAccount({ force: true });
  const key = w.local.chatAccount.key;
  w.local.chatCounters[key].planChoice = { plan: 'plus', at: Date.now() };
  await w.send({ type: 'REFRESH_CHAT_ACCOUNT' }, w.sender('popup'));
  assert.equal(w.tabs.length, 0);
  assert.equal(Counter.view(w.local).planSource, 'selected');
});


test('owned billing reader verifies the real DOM even when no content observer starts', async () => {
  const { w, removed } = worker({ contentMessages: false });
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const injections = [];
  w.context.chrome.scripting = { executeScript: async spec => {
    injections.push(spec);
    const context = vm.createContext({ URL, location: new URL('https://chatgpt.com/settings/billing'),
      document: { querySelectorAll: () => [card(), card({ name: 'ChatGPT Plus', invoice: true })] } });
    let result;
    for (const file of spec.files) result = vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'), context);
    return [{ frameId: 0, documentId: 'billing-document', result }];
  } };
  await w.context.ensureSecurity();
  const settings = structuredClone(w.local.settings);
  await w.send({ type: 'REFRESH_CHAT_ACCOUNT' }, w.sender('popup'));
  assert.equal(Counter.view(w.local).plan, 'pro100');
  assert.equal(w.local.chatCounters[w.local.chatAccount.key].planCheck.status, 'confirmed');
  assert.deepEqual(removed, [90]);
  assert.equal(w.tabs.length, 1);
  assert.ok(injections.length > 0);
  assert.ok(injections.every(spec => spec.target.tabId === 90 && spec.world === 'ISOLATED'));
  assert.deepEqual(w.local.settings, settings);
});


test('failed injection and delayed current-card rendering retry in the same owned tab', async () => {
  const { w, removed } = worker({ contentMessages: false }); let calls = 0;
  w.context.chrome.scripting = { executeScript: async () => {
    if (++calls === 1) throw new Error('Frame not ready');
    return [{ frameId: 0, documentId: 'ready-document', result: calls === 2 ? { status: 'card-pending' } :
      { status: 'read', url: 'https://chatgpt.com/settings/billing', heading: 'ChatGPT Pro 100', modern: true } }];
  } };
  await w.context.ensureSecurity();
  await w.send({ type: 'REFRESH_CHAT_ACCOUNT' }, w.sender('popup'));
  assert.equal(Counter.view(w.local).plan, 'pro100');
  assert.equal(calls, 3);
  assert.equal(w.tabs.length, 1);
  assert.deepEqual(removed, [90]);
});

test('missing current card stays unverified with a bounded reason and closes its tab', async () => {
  const { w, removed } = worker({ contentMessages: false }); let calls = 0;
  w.context.chrome.scripting = { executeScript: async () => {
    calls++; return [{ frameId: 0, documentId: 'empty-document', result: { status: 'card-pending' } }];
  } };
  await w.context.ensureSecurity();
  await w.send({ type: 'REFRESH_CHAT_ACCOUNT' }, w.sender('popup'));
  const view = Counter.view(w.local);
  assert.equal(view.plan, 'plus');
  assert.notEqual(view.planSource, 'verified');
  assert.equal(view.planCheck.status, 'timeout');
  assert.equal(view.planCheck.readerStatus, 'card-pending');
  assert.equal(calls, 23);
  assert.deepEqual(removed, [90]);
});

test('late billing read after the deadline cannot change the plan or schedule another read', async () => {
  const { w, removed } = worker({ contentMessages: false }); let release, calls = 0;
  w.context.chrome.scripting = { executeScript: () => { calls++; return new Promise(resolve => { release = resolve; }); } };
  await w.context.ensureSecurity();
  await w.send({ type: 'REFRESH_CHAT_ACCOUNT' }, w.sender('popup'));
  release([{ frameId: 0, documentId: 'late-document', result:
    { status: 'read', url: 'https://chatgpt.com/settings/billing', heading: 'ChatGPT Pro 100', modern: true } }]);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(Counter.view(w.local).plan, 'plus');
  assert.equal(calls, 1);
  assert.deepEqual(removed, [90]);
});

test('a read returned from a conversation or child frame cannot become subscription evidence', async () => {
  for (const variant of [{ frameId: 3 }, { url: 'https://chatgpt.com/c/fake-plan' }]) {
    const { w, removed } = worker({ contentMessages: false });
    w.context.chrome.scripting = { executeScript: async () => [{ frameId: variant.frameId || 0, documentId: 'wrong-document', result:
      { status: 'read', url: variant.url || 'https://chatgpt.com/settings/billing', heading: 'ChatGPT Pro 100', modern: true } }] };
    await w.context.ensureSecurity();
    await w.send({ type: 'REFRESH_CHAT_ACCOUNT' }, w.sender('popup'));
    assert.equal(Counter.view(w.local).plan, 'plus');
    assert.notEqual(Counter.view(w.local).planSource, 'verified');
    assert.deepEqual(removed, [90]);
  }
});


test('explicit automatic selection rechecks billing even when the old family is Plus', async () => {
  const { w, removed } = worker(); await w.context.ensureSecurity(); await w.context.refreshChatAccount({ force: true });
  const key = w.local.chatAccount.key;
  w.local.chatCounters[key].planChoice = { plan: 'plus', at: Date.now() };
  const reply = await w.send({ type: 'SET_CHAT_PLAN_CHOICE', plan: 'auto', accountKey: key }, w.sender('popup'));
  assert.equal(reply.ok, true);
  assert.equal(Counter.view(w.local).plan, 'pro100');
  assert.deepEqual(removed, [90]);
});
