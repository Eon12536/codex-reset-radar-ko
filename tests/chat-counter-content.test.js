const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const settle = () => new Promise(resolve => setImmediate(resolve));

function page({ billing = false, heading = null, deliver = null } = {}) {
  const listeners = {}, messages = [], timers = new Map();
  let nodes = [], enabled = true, observe, nextTimer = 0, attached = false, syncFailure = null;
  let scope = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', reason = 'off', recordReply = { ok: true }, now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const intervals = new Map();
  class Element { closest(selector) { return selector === '[data-testid="send-button"]' ? this : null; } }
  const context = vm.createContext({ URL, Date: Clock, Element, location: { href: 'https://chatgpt.com/', pathname: '/', hash: billing ? '#settings/Billing' : '' },
    document: { documentElement: {}, querySelectorAll: () => nodes,
      querySelector: selector => { assert.equal(selector, '[role="tabpanel"][id$="-content-Billing"]:not([hidden])'); return heading ? { querySelectorAll: () => (Array.isArray(heading) ? heading : [heading]).map(textContent => ({ textContent })) } : null; },
      addEventListener: (type, fn) => { listeners[type] = fn; } },
    MutationObserver: class { constructor(fn) { observe = fn; } observe() { attached = true; } disconnect() { attached = false; } },
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
    setInterval: fn => { intervals.set(1, fn); return 1; }, clearInterval: id => intervals.delete(id),
    chrome: { runtime: { sendMessage: async message => {
      messages.push(message);
      if (deliver) return deliver(message);
      if (message.type === 'CHAT_COUNT_STATUS' && syncFailure) throw syncFailure;
      if (message.type === 'CHAT_COUNT_RECORD') { if (recordReply instanceof Error) throw recordReply; return recordReply; }
      return { ok: true, enabled, scope, reason };
    }, onMessage: { addListener: fn => { listeners.sync = fn; } } } }
  });
  for (const file of ['core/chat-counter.js', 'chat-counter.js']) vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8'), context);
  return {
    messages, attached: () => attached,
    failSync: error => { syncFailure = error; },
    replyRecord: reply => { recordReply = reply; },
    changeScope: value => { scope = value; },
    advance: milliseconds => { now += milliseconds; },
    periodicSync: async () => { await intervals.get(1)?.(); await settle(); },
    polling: () => intervals.size > 0,
    setEnabled: (value, why = 'off') => { enabled = value; reason = why; listeners.sync({ type: 'CHAT_COUNT_SYNC' }); },
    setRows: rows => { nodes = rows.map(([id, role, slug]) => ({
      get textContent() { throw new Error('Must not read message text'); },
      getAttribute: key => ({ 'data-message-id': id, 'data-message-author-role': role, 'data-message-model-slug': slug }[key])
    })); },
    send: trusted => listeners.click({ type: 'click', target: new Element(), isTrusted: trusted }),
    mutation: () => { observe(); for (const [id, fn] of timers) { timers.delete(id); fn(); } }
  };
}

test('content observer records only metadata after a real local send; duplicate DOM mutations do not count', async () => {
  const p = page(); await settle();
  p.setRows([['history-u', 'user', ''], ['history-a', 'assistant', 'gpt-6-pro']]); p.mutation();
  p.send(false); p.setRows([['untrusted-u', 'user', ''], ['untrusted-a', 'assistant', 'gpt-6-pro']]); p.mutation();
  assert.equal(p.messages.filter(m => m.type === 'CHAT_COUNT_RECORD').length, 0);
  p.send(true);
  p.setRows([['new-user', 'user', ''], ['new-answer', 'assistant', 'gpt-6-pro']]);
  p.mutation(); p.mutation();
  const records = p.messages.filter(m => m.type === 'CHAT_COUNT_RECORD');
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'new-answer');
  assert.deepEqual(Object.keys(records[0]).sort(), ['id', 'model', 'scope', 'type']);
});

test('one transient worker connection failure recovers on the next periodic sync without counting old responses', async () => {
  const p = page(); await settle();
  p.failSync(new Error('The message port closed before a response was received.'));
  await p.periodicSync();
  assert.equal(p.attached(), false);
  p.failSync(null);
  p.setRows([['offline-u', 'user', ''], ['offline-a', 'assistant', 'gpt-6-pro']]);
  await p.periodicSync();
  assert.equal(p.attached(), true);
  p.mutation();
  assert.equal(p.messages.filter(m => m.type === 'CHAT_COUNT_RECORD').length, 0);
  p.send(true); p.setRows([['resumed-u', 'user', ''], ['resumed-a', 'assistant', 'gpt-6-pro']]);
  p.mutation(); p.mutation();
  assert.equal(p.messages.filter(m => m.type === 'CHAT_COUNT_RECORD').length, 1);
});

test('a permanently invalidated extension context stops polling and cannot record new responses', async () => {
  const p = page(); await settle();
  p.failSync(new Error('Extension context invalidated.'));
  await p.periodicSync();
  assert.equal(p.polling(), false);
  assert.equal(p.attached(), false);
  p.send(true); p.setRows([['u', 'user', ''], ['a', 'assistant', 'gpt-6-pro']]); p.mutation();
  assert.equal(p.messages.filter(m => m.type === 'CHAT_COUNT_RECORD').length, 0);
});

test('turning counter OFF disconnects observation and ignores new sends', async () => {
  const p = page(); await settle(); assert.equal(p.attached(), true);
  p.setEnabled(false); await settle(); assert.equal(p.attached(), false);
  p.send(true); p.setRows([['new-u', 'user', ''], ['new-a', 'assistant', 'gpt-6-pro']]); p.mutation();
  assert.equal(p.messages.filter(m => m.type === 'CHAT_COUNT_RECORD').length, 0);
  p.setEnabled(true); await settle();
  p.send(true); p.setRows([['resumed-u', 'user', ''], ['resumed-a', 'assistant', 'gpt-6-pro']]); p.mutation();
  assert.equal(p.messages.filter(m => m.type === 'CHAT_COUNT_RECORD').length, 1);
});

test('plan observation reads only the current Billing heading, never an upgrade offer or generic Pro', async () => {
  const p = page({ billing: true, heading: 'ChatGPT Pro 5x' }); await settle();
  assert.equal(p.messages.find(message => message.type === 'CHAT_PLAN_OBSERVED').heading, 'ChatGPT Pro 5x');
  for (const options of [{ billing: false, heading: 'ChatGPT Pro 5x' }, { billing: true, heading: 'ChatGPT Pro' }, { billing: true, heading: 'Upgrade to Pro 20x' }, { billing: true, heading: ['ChatGPT Pro 5x', 'ChatGPT Pro 20x'] }]) {
    const other = page(options); await settle();
    assert.equal(other.messages.some(message => message.type === 'CHAT_PLAN_OBSERVED'), false);
  }
});

test('a new local response is retried after a closed record port or a refused record, without replaying the DOM', async () => {
  for (const failure of [new Error('The message port closed before a response was received.'), { ok: false }]) {
    const p = page(); await settle();
    p.replyRecord(failure);
    p.send(true); p.setRows([['new-u', 'user', ''], ['new-a', 'assistant', 'gpt-6-pro']]); p.mutation(); await settle();
    p.mutation(); await settle();
    assert.equal(p.messages.filter(m => m.type === 'CHAT_COUNT_RECORD').length, 1, 'DOM mutations must not spin retries');
    p.replyRecord({ ok: true }); await p.periodicSync();
    const records = p.messages.filter(m => m.type === 'CHAT_COUNT_RECORD');
    assert.equal(records.length, 2);
    assert.deepEqual(records[1], records[0]);
    await p.periodicSync(); assert.equal(p.messages.filter(m => m.type === 'CHAT_COUNT_RECORD').length, 2);
  }
});

test('pending metadata survives a temporary unverified account or failed status check, but not OFF or a different scope', async () => {
  for (const mode of ['unverified', 'port', 'off', 'account-changed', 'scope']) {
    const p = page(); await settle(); p.replyRecord({ ok: false });
    p.send(true); p.setRows([['u', 'user', ''], ['a', 'assistant', 'gpt-6-pro']]); p.mutation(); await settle();
    if (mode === 'port') { p.failSync(new Error('port closed')); await p.periodicSync(); p.failSync(null); }
    else if (mode === 'scope') p.changeScope('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    else { p.setEnabled(false, mode); await settle(); }
    p.replyRecord({ ok: true }); p.setEnabled(true); await settle();
    assert.equal(p.messages.filter(m => m.type === 'CHAT_COUNT_RECORD').length, ['unverified', 'port'].includes(mode) ? 2 : 1, mode);
  }
});

test('expired records are discarded and a broken extension context also stops record delivery', async () => {
  const p = page(); await settle(); p.replyRecord({ ok: false });
  p.send(true); p.setRows([['u', 'user', ''], ['a', 'assistant', 'gpt-6-pro']]); p.mutation(); await settle();
  p.advance(15 * 60000 + 1); p.replyRecord({ ok: true }); await p.periodicSync();
  assert.equal(p.messages.filter(m => m.type === 'CHAT_COUNT_RECORD').length, 1);
  p.replyRecord(new Error('Extension context invalidated.'));
  p.send(true); p.setRows([['u2', 'user', ''], ['a2', 'assistant', 'gpt-6-pro']]); p.mutation(); await settle();
  assert.equal(p.polling(), false); assert.equal(p.attached(), false);
  p.setEnabled(true); await settle(); assert.equal(p.attached(), false);
});

test('failed delivery remains bounded to 200 records and does not block later local sends', async () => {
  const p = page(); await settle(); p.replyRecord({ ok: false });
  for (let i = 0; i < 205; i++) {
    p.send(true); p.setRows([['u' + i, 'user', ''], ['a' + i, 'assistant', 'gpt-6-pro']]); p.mutation(); await settle();
  }
  assert.equal(p.messages.filter(m => m.type === 'CHAT_COUNT_RECORD').length, 205);
  p.replyRecord({ ok: true }); await p.periodicSync();
  const retried = p.messages.filter(m => m.type === 'CHAT_COUNT_RECORD').slice(205);
  assert.equal(retried.length, 200); assert.equal(retried[0].id, 'a5'); assert.equal(retried.at(-1).id, 'a204');
});

test('an accepted record whose reply was lost is retried across a worker restart without counting twice', async () => {
  const { makeWorker, json } = require('./helpers/worker');
  const Counter = require('../src/core/chat-counter');
  const token = 'test.' + Buffer.from(JSON.stringify({ sub: 'retry-user', 'https://api.openai.com/auth': {
    chatgpt_user_id: 'retry-user', chatgpt_account_id: 'retry-account', chatgpt_plan_type: 'pro'
  } })).toString('base64url') + '.signature';
  function worker(stored) {
    const w = makeWorker({ stored: stored || { chatCounterSchema: 2, settings: {
      monitorChat: true, syncChatHistory: false, monitorSignals: false, monitorAccount: false
    } }, fetcher: async () => json({ accessToken: token }) });
    w.context.chrome.permissions.contains = async () => true;
    w.context.chrome.scripting = { getRegisteredContentScripts: async () => [{ id: 'radar-chat-counter' }] };
    w.context.chrome.tabs.query = async () => [];
    return w;
  }
  let w = worker(), loseReply = true;
  const sender = () => ({ id: w.runtime.id, url: 'https://chatgpt.com/', frameId: 0,
    documentId: 'retry-document', documentLifecycle: 'active', tab: { id: 4 } });
  const p = page({ deliver: async message => {
    const result = await w.send(message, sender());
    if (message.type === 'CHAT_COUNT_RECORD' && loseReply) { loseReply = false; throw new Error('message port closed'); }
    return result;
  } });
  async function until(predicate) {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
    assert.ok(predicate(), 'content/worker did not finish');
  }
  await until(p.attached);
  p.send(true); p.setRows([['retry-u', 'user', ''], ['retry-a', 'assistant', 'gpt-6-pro']]); p.mutation();
  await until(() => !loseReply); await settle();
  const key = w.local.chatAccount.key;
  assert.equal(w.local.chatCounters[key].events.length, 1);
  const session = structuredClone(w.session); w = worker(w.local); Object.assign(w.session, session);
  await p.periodicSync();
  assert.equal(p.messages.filter(m => m.type === 'CHAT_COUNT_RECORD').length, 2);
  assert.equal(w.local.chatCounters[key].events.length, 1);
  assert.equal(Counter.summary(w.local.chatCounters[key], 'pro100').remaining, 49);
  assert.doesNotMatch(JSON.stringify(w.local), /retry-a|retry-u|retry-user|retry-account/);
  assert.ok(w.requests.every(r => r.url.endsWith('/auth/session')), 'no history collection or billing needed');
});

test('a late acknowledgement from an old scope does not block a new-scope pending response', async () => {
  let scope = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', release;
  const p = page({ deliver: async message => {
    if (message.type === 'CHAT_COUNT_STATUS') return { enabled: true, scope };
    if (message.type === 'CHAT_COUNT_RECORD' && message.scope.startsWith('a')) return new Promise(resolve => { release = resolve; });
    return { ok: true };
  } });
  await settle(); p.send(true); p.setRows([['u', 'user', ''], ['a', 'assistant', 'gpt-6-pro']]); p.mutation(); await settle();
  scope = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; await p.periodicSync();
  p.setRows([]); p.send(true); p.setRows([['u-new', 'user', ''], ['a-new', 'assistant', 'gpt-6-pro']]); p.mutation();
  release({ ok: true }); await settle();
  const records = p.messages.filter(m => m.type === 'CHAT_COUNT_RECORD');
  assert.equal(records.length, 2); assert.equal(records[1].scope, scope);
  await p.periodicSync(); assert.equal(p.messages.filter(m => m.type === 'CHAT_COUNT_RECORD').length, 2);
});

test('a slow record retry never blocks a status change that turns counting OFF', async () => {
  let enabled = true, attempts = 0, release;
  const p = page({ deliver: async message => {
    if (message.type === 'CHAT_COUNT_STATUS') return { enabled, reason: 'off', scope: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    if (message.type === 'CHAT_COUNT_RECORD' && ++attempts > 1) return new Promise(resolve => { release = resolve; });
    return { ok: false };
  } });
  await settle(); p.send(true); p.setRows([['u', 'user', ''], ['a', 'assistant', 'gpt-6-pro']]); p.mutation(); await settle();
  p.setEnabled(true); await settle(); assert.equal(attempts, 2);
  enabled = false; p.setEnabled(false); await settle();
  assert.equal(p.attached(), false, 'OFF must disconnect before a slow retry returns');
  release({ ok: true }); await settle();
  enabled = true; await p.periodicSync(); assert.equal(attempts, 2, 'cleared records cannot be replayed after OFF');
});
