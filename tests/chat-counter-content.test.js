const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const settle = () => new Promise(resolve => setImmediate(resolve));

function page({ billing = false, heading = null } = {}) {
  const listeners = {}, messages = [], timers = new Map();
  let nodes = [], enabled = true, observe, nextTimer = 0, attached = false;
  class Element { closest(selector) { return selector === '[data-testid="send-button"]' ? this : null; } }
  const context = vm.createContext({ URL, Date, Element, location: { href: 'https://chatgpt.com/', pathname: '/', hash: billing ? '#settings/Billing' : '' },
    document: { documentElement: {}, querySelectorAll: () => nodes,
      querySelector: selector => { assert.equal(selector, '[role="tabpanel"][id$="-content-Billing"]:not([hidden])'); return heading ? { querySelectorAll: () => (Array.isArray(heading) ? heading : [heading]).map(textContent => ({ textContent })) } : null; },
      addEventListener: (type, fn) => { listeners[type] = fn; } },
    MutationObserver: class { constructor(fn) { observe = fn; } observe() { attached = true; } disconnect() { attached = false; } },
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
    setInterval: () => 1, clearInterval: () => {},
    chrome: { runtime: { sendMessage: async message => { messages.push(message); return { ok: true, enabled, scope: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }; }, onMessage: { addListener: fn => { listeners.sync = fn; } } } }
  });
  for (const file of ['core/chat-counter.js', 'chat-counter.js']) vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8'), context);
  return {
    messages, attached: () => attached,
    setEnabled: value => { enabled = value; listeners.sync({ type: 'CHAT_COUNT_SYNC' }); },
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
