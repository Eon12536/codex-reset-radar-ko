const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Counter = require('../src/core/chat-counter.js');
require('../src/core/time.js');
const History = require('../src/core/chat-history.js');
const fs = require('node:fs');
const vm = require('node:vm');
const { makeWorker, json } = require('./helpers/worker.js');
const NOW = 1800000000000;
const DAY = 86400000;
const hash = async value => crypto.createHash('sha256').update(value).digest('hex');
const answer = (id = 'answer-001', model = 'gpt-6-pro', at = NOW - 1000) => ({ id, author: { role: 'assistant' },
  create_time: at / 1000, status: 'finished_successfully', end_turn: true, metadata: { model_slug: model },
  content: { parts: ['PRIVATE_BODY_DO_NOT_STORE'] } });

test('history timestamps and period boundaries are independent of the computer timezone', () => {
  for (const offset of ['+09:00', '-08:00', '+00:00']) {
    class HostDate extends Date {
      static parse(value) { return Date.parse(typeof value === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+$/.test(value) ? value + offset : value); }
    }
    const context = vm.createContext({ Date: HostDate, Intl, URL });
    for (const file of ['time', 'chat-counter', 'chat-history']) vm.runInContext(fs.readFileSync(require.resolve('../src/core/' + file), 'utf8'), context);
    for (const age of [1000, 30 * DAY - 1000, 30 * DAY + 1000]) {
      const at = NOW - age, iso = new Date(at).toISOString();
      for (const value of [at, at / 1000, iso, iso.slice(0, -1)]) {
        const result = context.RadarChatHistory.project({ messages: [{ ...answer(), create_time: value }] }, NOW);
        assert.equal(result.entries.length, age < 30 * DAY ? 1 : 0, `${offset}: ${value}`);
        if (result.entries.length) assert.equal(result.entries[0].at, at, `${offset}: ${value}`);
      }
    }
  }
});

test('the timestamp interpretation upgrade revisits version-2 history without losing or duplicating counts', async () => {
  const at = NOW - 3600000;
  const fixture = readFixture({ messages: [{ ...answer(), create_time: new Date(at).toISOString().slice(0, -1) }] });
  const key = await hash('answer-001');
  const previous = { historyClassificationVersion: 2,
    historyCache: { [await hash('conversation:conversation-001')]: { updatedAt: NOW, unknown: 0 } },
    historyEvents: [{ key, model: 'astra', at: at - 9 * 3600000 }],
    events: [{ key, model: 'astra', at }] };
  const result = await History.collect({ ...fixture, hash, previous, now: NOW });
  assert.equal(result.history.scanned, 1); assert.equal(result.history.reused, 0);
  assert.equal(result.historyClassificationVersion, 3);
  assert.equal(result.historyEvents.length, 1); assert.equal(result.historyEvents[0].at, at);
  assert.equal(Counter.summary({ ...previous, ...result }, 'pro100', NOW).used, 1);
  const again = await History.collect({ ...fixture, hash, previous: result, now: NOW });
  assert.equal(again.history.reused, 1); assert.equal(again.historyEvents.length, 1);
});
const list = (ids = ['conversation-001']) => ({ items: ids.map(id => ({ id, update_time: NOW / 1000, title: 'PRIVATE_TITLE' })), total: ids.length });
function readFixture(detail, { ids, fail } = {}) {
  const calls = [];
  const read = async url => {
    calls.push(url);
    assert.equal(History.allowedUrl(url), true);
    if (fail) throw Object.assign(new Error('PRIVATE_ERROR'), { status: fail });
    if (url.includes('is_archived=true')) return list([]);
    if (url.includes('is_archived=false')) return list(ids);
    return typeof detail === 'function' ? detail(url) : detail;
  };
  return { read, calls };
}

test('projects successful final model metadata, keeping ordinary Sol separate from Pro', () => {
  const a = answer(), sol = answer('answer-sol', 'gpt-5-6-pro');
  const result = History.project({ messages: [a, a, sol, answer('normal-001', 'gpt-5-6-thinking'),
    { ...answer('think-001'), channel: 'analysis' }, { ...answer('tool-0001'), recipient: 'python' },
    { ...answer('pending-1'), status: 'in_progress' }, { ...answer('failed-01'), status: 'failed' },
    answer('old-00001', 'gpt-6-pro', NOW - 31 * DAY), answer('future-01', 'gpt-6-pro', NOW + DAY),
    answer('unclear-1', 'gpt-5-6'), { ...answer('no-date01'), create_time: null }] }, NOW);
  assert.equal(result.entries.length, 4);
  assert.equal(result.unknown, 1);
  assert.deepEqual(result.entries.map(e => e.model), ['astra', 'sol', 'solStandard', 'solStandard']);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|content|parts/);
});

test('legacy mapping counts separate final response branches once', () => {
  const projected = History.project({ mapping: { a: { message: answer() }, b: { message: answer('answer-002') },
    c: { message: answer() }, d: { message: { ...answer('user-0001'), author: { role: 'user' } } } }, current_node: 'b' }, NOW);
  assert.equal(projected.entries.length, 2);
});

test('history URLs are canonical, read-only and bounded to specific ChatGPT paths', () => {
  assert.equal(History.allowedUrl('https://chatgpt.com/backend-api/conversations?offset=0&limit=50&order=updated&is_archived=false'), true);
  for (const value of [
    'https://evil.example/backend-api/conversations', 'https://chatgpt.com/api/auth/session',
    'https://chatgpt.com/backend-api/conversation/../../account',
    'https://chatgpt.com/backend-api/conversation/conversation-001?secret=x',
    'https://chatgpt.com/backend-api/conversations?offset=500&limit=50&order=updated&is_archived=false',
    'https://user@chatgpt.com/backend-api/conversation/conversation-001',
    'https://chatgpt.com/backend-api/conversation/conversation-001#private'
  ]) assert.equal(History.allowedUrl(value), false, value);
});

test('incremental synchronization hashes metadata, reuses unchanged records, and deduplicates local sends', async () => {
  const fixture = readFixture({ messages: [answer()] });
  const first = await History.collect({ ...fixture, hash, now: NOW });
  assert.equal(first.history.status, 'synced');
  assert.equal(first.historyEvents.length, 1);
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE|answer-001|conversation-001|model_slug|content/);
  const second = await History.collect({ ...fixture, hash, previous: first, now: NOW + 1000 });
  assert.equal(second.history.reused, 1);
  assert.equal(second.historyEvents.length, 1);
  const profile = Counter.record(first, { key: await hash('answer-001'), model: 'astra' }, NOW);
  assert.equal(Counter.summary(profile, 'pro100', NOW).used, 1);
  assert.equal(Counter.summary(profile, 'pro100', NOW + 7 * DAY - 500).used, 0); // server timestamp wins
});

test('modern older pages and legacy fallback work without preserving response bodies', async () => {
  const fixture = readFixture(url => url.includes('/messages?') ? { messages: [answer('answer-002', 'gpt-5.6-pro')], page_info: { has_previous_page: false } } :
    { messages: [answer()], page_info: { has_previous_page: true, start_cursor: 'cursor-001' } });
  const result = await History.collect({ ...fixture, hash, now: NOW });
  assert.equal(result.historyEvents.length, 2);
  assert.equal(result.history.status, 'synced');
  const legacy = readFixture(url => {
    if (url.includes('/conversations/')) throw Object.assign(new Error(), { status: 404 });
    return { mapping: { one: { message: answer() } } };
  });
  assert.equal((await History.collect({ ...legacy, hash, now: NOW })).historyEvents.length, 1);
});

test('pagination loops, missing schema and scan bounds remain partial; failures retain previous counts', async () => {
  const fixture = readFixture({ messages: [answer()], page_info: { has_previous_page: true, start_cursor: 'cursor-001' } });
  const partial = await History.collect({ ...fixture, hash, now: NOW });
  assert.equal(partial.history.status, 'partial');
  assert.equal(partial.historyEvents.length, 1);
  assert.equal(Object.keys(partial.historyCache).length, 0);
  const many = readFixture({ messages: [] }, { ids: Array.from({ length: 21 }, (_, i) => 'conversation-' + String(i).padStart(3, '0')) });
  const bounded = await History.collect({ ...many, hash, now: NOW });
  assert.equal(bounded.history.scanned, 20);
  assert.equal(bounded.history.pending, 1);
  assert.equal(bounded.history.status, 'partial');
  for (const fail of [401, 429, 500]) {
    const failed = await History.collect({ ...readFixture(null, { fail }), hash, previous: partial, now: NOW });
    assert.equal(failed.history.status, 'error');
    assert.equal(failed.historyEvents.length, 1);
    assert.doesNotMatch(JSON.stringify(failed), /PRIVATE/);
  }
  const schema = await History.collect({ ...readFixture({ unsupported: true }), hash, now: NOW });
  assert.equal(schema.history.code, 'schema');
});

test('account imports respect the existing explicit local Codex reset boundary', async () => {
  const fixture = readFixture({ messages: [answer(), answer('answer-new', 'gpt-5.6-pro', NOW + 2000)] });
  const result = await History.collect({ ...fixture, hash, now: NOW + 3000 });
  const profile = { ...result, codexReset: { effectiveAt: NOW } };
  assert.equal(Counter.summary(profile, 'pro100', NOW + 3000).used, 1);
  assert.equal(profile.historyEvents.length, 2); // history is retained, local cycle excludes older entries
});

test('an unavailable archive list does not discard readable active conversation history', async () => {
  for (const failure of ['network', 'schema']) {
    const result = await History.collect({ hash, now: NOW, read: async url => {
      if (url.includes('is_archived=true')) {
        if (failure === 'schema') return { unsupported: true };
        throw Object.assign(new Error('PRIVATE_ARCHIVE_ERROR'), { status: 500 });
      }
      if (url.includes('is_archived=false')) return list();
      return { messages: [answer()] };
    } });
    assert.equal(result.historyEvents.length, 1);
    assert.equal(result.history.status, 'error');
    assert.equal(result.history.code, failure);
    assert.equal(result.history.scanned, 1);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
});

test('an unavailable active list still imports readable archives, but authorization failures stop requests', async () => {
  const read = async url => {
    if (url.includes('is_archived=false')) throw Object.assign(new Error('network'), { status: 500 });
    if (url.includes('is_archived=true')) return list();
    return { messages: [answer()] };
  };
  const result = await History.collect({ read, hash, now: NOW });
  assert.equal(result.historyEvents.length, 1);
  assert.equal(result.history.code, 'network');
  for (const status of [401, 403, 429]) {
    const calls = [];
    const failed = await History.collect({ hash, now: NOW, read: async url => {
      calls.push(url); throw Object.assign(new Error('unavailable'), { status });
    } });
    assert.equal(calls.length, 1);
    assert.equal(failed.historyEvents.length, 0);
    assert.equal(failed.history.code, status === 429 ? 'rate' : 'auth');
  }
});

const token = user => 'test.' + Buffer.from(JSON.stringify({ sub: user, 'https://api.openai.com/auth': {
  chatgpt_user_id: user, chatgpt_account_id: 'account-' + user, chatgpt_plan_type: 'pro'
} })).toString('base64url') + '.signature';
function worker(options = {}) {
  let user = 'A';
  const w = makeWorker({ stored: { chatCounterSchema: 2, settings: { monitorChat: true,
    syncChatHistory: true, monitorAccount: false, monitorSignals: false, ...options.settings } },
    async fetcher(url, request) {
      if (url.endsWith('/auth/session')) return json({ accessToken: token(user) });
      if (options.fetcher) return options.fetcher(url, request, w, next => { user = next; });
      if (url.includes('is_archived=true')) return json(list([]));
      if (url.includes('is_archived=false')) return json(list());
      return json({ messages: [answer()] });
    }
  });
  w.context.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } };
  w.context.setTimeout = callback => setTimeout(callback, 0);
  w.context.chrome.permissions.contains = async () => true;
  w.context.chrome.scripting = { getRegisteredContentScripts: async () => [{ id: 'radar-chat-counter' }],
    unregisterContentScripts: async () => {}, executeScript: async () => [] };
  w.context.chrome.tabs.query = async () => [];
  return w;
}

test('worker requests are GET, scoped to session account; private fields and token never persist', async () => {
  const w = worker();
  const result = await w.send({ type: 'SYNC_CHAT_HISTORY' }, w.sender('popup'));
  assert.equal(result.ok, true);
  const profile = w.local.chatCounters[w.local.chatAccount.key];
  assert.equal(profile.historyEvents.length, 1);
  for (const request of w.requests.filter(r => !r.url.endsWith('/auth/session'))) {
    assert.equal(request.options.method, 'GET');
    assert.equal(request.options.redirect, 'error');
    assert.equal(request.options.headers['ChatGPT-Account-ID'], 'account-A');
  }
  assert.doesNotMatch(JSON.stringify([w.local, w.session]), /PRIVATE|answer-001|conversation-001|account-A|signature/);
  const before = w.requests.length;
  await w.send({ type: 'SYNC_CHAT_HISTORY' }, { ...w.sender('popup'), url: 'https://chatgpt.com/' });
  assert.equal(w.requests.length, before);
});

test('opt-in is off by default; disabling sync erases imported records but preserves local counts', async () => {
  const off = worker({ settings: { syncChatHistory: false } });
  await off.send({ type: 'SYNC_CHAT_HISTORY' }, off.sender('popup'));
  assert.equal(off.requests.length, 0);
  const w = worker(); await w.send({ type: 'SYNC_CHAT_HISTORY' }, w.sender('popup'));
  const key = w.local.chatAccount.key;
  w.local.chatCounters[key].events = [{ key: 'f'.repeat(64), model: 'sol', at: NOW }];
  await w.context.saveSettings({ ...w.local.settings, syncChatHistory: false });
  assert.equal(w.local.chatCounters[key].historyEvents, undefined);
  assert.equal(w.local.chatCounters[key].historyCache, undefined);
  assert.equal(w.local.chatCounters[key].events.length, 1);
});

test('account switch or disabling during a request discards in-flight private results', async () => {
  for (const mode of ['account', 'off']) {
    let triggered = false;
    const w = worker({ async fetcher(url, request, ctx, switchUser) {
      if (url.includes('is_archived=true')) return json(list([]));
      if (url.includes('is_archived=false')) return json(list());
      if (!triggered) {
        triggered = true;
        if (mode === 'account') switchUser('B');
        else await ctx.context.saveSettings({ ...ctx.local.settings, syncChatHistory: false });
      }
      return json({ messages: [answer()] });
    } });
    await w.send({ type: 'SYNC_CHAT_HISTORY' }, w.sender('popup'));
    for (const profile of Object.values(w.local.chatCounters)) assert.equal(profile.historyEvents, undefined);
    assert.doesNotMatch(JSON.stringify(w.local), /PRIVATE/);
  }
});
