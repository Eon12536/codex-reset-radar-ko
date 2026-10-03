const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Counter = require('../src/core/chat-counter');
const Settings = require('../src/core/settings');
const source = fs.readFileSync(require.resolve('../src/popup/popup.js'), 'utf8');
const tail = source.slice(source.indexOf('chrome.storage.onChanged.addListener(render);'));
const settle = () => new Promise(resolve => setImmediate(resolve));

async function popup({ enabled = true } = {}) {
  let now = Date.now(), tick;
  const handlers = {}, messages = [], views = [], status = { textContent: '' };
  const storage = { settings: { monitorChat: enabled, monitorAccount: false, monitorSignals: false },
    chatAccount: { key: 'account', family: 'pro', status: 'connected', checkedAt: now },
    chatCounters: { account: { plan: 'pro100', planAt: now,
      events: [{ key: 'a'.repeat(64), model: 'astra', at: now - 60000 }] } } };
  const state = { Date: class extends Date { static now() { return now; } }, RadarSettings: Settings,
    $: () => status, document: { visibilityState: 'visible', addEventListener: (name, fn) => { handlers[name] = fn; } },
    setInterval: fn => { tick = fn; },
    render: async () => views.push(Counter.view(storage, now)),
    chrome: { storage: { onChanged: { addListener() {} }, local: { get: async () => structuredClone(storage) } },
      runtime: { sendMessage: async message => {
        messages.push(message.type);
        await state.read?.();
        if (storage.settings.monitorChat) storage.chatAccount = { ...storage.chatAccount, checkedAt: now };
        return { ok: true };
      } } } };
  vm.runInNewContext(tail, state); await settle();
  messages.length = 0; views.length = 0;
  return { storage, handlers, messages, views, state, status,
    advance: minutes => { now += minutes * 60000; }, tick: async () => { await tick(); await settle(); } };
}

test('an open popup keeps a verified Chat meter through thirty minutes without billing or history fetches', async () => {
  const p = await popup(), before = structuredClone(p.storage.chatCounters);
  for (let i = 0; i < 60; i++) {
    p.advance(0.5); await p.tick();
    assert.equal(p.views.at(-1).connected, true);
    assert.equal(p.views.at(-1).meters[0].percent, 98);
  }
  assert.ok(p.messages.length > 0 && p.messages.length <= 8);
  assert.deepEqual([...new Set(p.messages)], ['REFRESH_CHAT_ACCOUNT']);
  assert.deepEqual(p.storage.chatCounters, before);
});

test('fresh or disabled Chat monitoring does not start periodic account queries', async () => {
  for (const enabled of [false, true]) {
    const p = await popup({ enabled });
    p.advance(enabled ? 3.5 : 30); await p.tick();
    assert.equal(p.messages.length, 0);
  }
});

test('hidden popup defers account queries and rechecks its identity when visible again', async () => {
  const p = await popup();
  p.state.document.visibilityState = 'hidden'; p.advance(6); await p.tick();
  assert.equal(p.messages.length, 0);
  p.state.document.visibilityState = 'visible';
  p.handlers.visibilitychange?.(); await settle();
  assert.deepEqual(p.messages, ['REFRESH_CHAT_ACCOUNT']);
  assert.equal(p.views.at(-1).connected, true);
});

test('overlapping popup ticks share one account read and failed verification cannot revive a stale card', async () => {
  const p = await popup(); p.advance(6);
  let release;
  p.state.read = () => new Promise(resolve => { release = resolve; });
  const first = p.tick(), second = p.tick(); await settle();
  assert.deepEqual(p.messages, ['REFRESH_CHAT_ACCOUNT']);
  release(); await Promise.all([first, second]);
  assert.equal(p.views.at(-1).connected, true);
  p.advance(6); p.state.read = () => { throw Error('Session unavailable'); };
  await p.tick();
  assert.equal(p.views.at(-1).connected, false);
  assert.equal(p.views.at(-1).meters.length, 0);
  assert.match(p.status.textContent, /확인하지 못했어요/);
  assert.equal(p.storage.chatCounters.account.events.length, 1);
});
