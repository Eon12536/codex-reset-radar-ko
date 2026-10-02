const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { makeWorker } = require('./helpers/worker');

function badgeControls({ open = true, fail = false } = {}) {
  const source = fs.readFileSync(require.resolve('../src/popup/popup.js'), 'utf8');
  const start = source.indexOf('async function acknowledgeDisplayedBadges()');
  // Run the actual event handlers, including the pre-fix implementation.
  const controls = source.slice(start < 0 ? source.indexOf('$("moreDetails").addEventListener') : start, source.indexOf('RadarTheme.subscribe'));
  const handlers = {}, messages = [];
  const receipt = { public: [{ id: 'first' }], banked: [] };
  const elements = {
    moreDetails: { open, addEventListener(type, fn) { handlers[type] = fn; }, querySelector() { return { focus() {} }; }, scrollIntoView() {} },
    viewBankedCredits: { addEventListener(type, fn) { handlers[type] = fn; } },
    refreshStatus: { textContent: '' }
  };
  const state = { $: id => elements[id], msg: () => 'save failed', displayedBadgeReceipt: receipt,
    chrome: { runtime: { async sendMessage(message) { messages.push(message); return { ok: !state.fail }; } } },
    async render() { state.displayedBadgeReceipt = { public: [], banked: [] }; }, fail };
  vm.runInNewContext(controls, state);
  return { state, elements, messages, handlers };
}

test('credit banner acknowledges new unread news when credit details are already open', async () => {
  const p = badgeControls();
  await p.handlers.click();
  assert.equal(p.messages.length, 1);
  assert.equal(p.messages[0].type, 'ACK_VISIBLE_BADGES');
  assert.equal(p.messages[0].receipt.public[0].id, 'first');
  assert.equal(p.state.displayedBadgeReceipt.public.length, 0);
});

test('credit banner retries a failed acknowledgement without requiring details to close', async () => {
  const p = badgeControls({ fail: true });
  await p.handlers.click();
  assert.equal(p.elements.refreshStatus.textContent, 'save failed');
  assert.equal(p.state.displayedBadgeReceipt.public.length, 1);
  p.state.fail = false;
  await p.handlers.click();
  assert.equal(p.messages.length, 2);
  assert.equal(p.elements.refreshStatus.textContent, '');
});

test('opening the credit banner defers acknowledgement to its one toggle event', async () => {
  const p = badgeControls({ open: false });
  await p.handlers.click();
  assert.equal(p.elements.moreDetails.open, true);
  assert.equal(p.messages.length, 0);
  await p.handlers.toggle();
  assert.equal(p.messages.length, 1);
  p.elements.moreDetails.open = false;
  await p.handlers.toggle();
  assert.equal(p.messages.length, 1);
});

test('an older popup read completing after a newer refresh cannot restore stale news or unread badges', async () => {
  const w = makeWorker();
  w.context.RadarAccount = require('../src/core/account');
  const reads = [], painted = [], receipts = [];
  w.context.chrome.storage.local.get = () => new Promise(resolve => reads.push(resolve));
  const elements = new Map();
  w.context.$ = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, textContent: '', dataset: {} });
    return elements.get(id);
  };
  w.context.msg = (...args) => w.context.RadarI18n.t(...args);
  w.context.renderNews = data => painted.push(data.lastCheckedAt);
  w.context.renderUnreadBadges = view => receipts.push(view.receipt);
  for (const name of ['renderChat', 'renderSchedule', 'renderForecast', 'renderWindow', 'renderCredits', 'renderBankedArrival', 'renderAdvice'])
    w.context[name] = () => {};
  const source = fs.readFileSync(require.resolve('../src/popup/popup.js'), 'utf8');
  const render = source.slice(source.indexOf('async function render()'), source.indexOf('$("openSettings").addEventListener'));
  vm.runInContext('let renderRevision = 0; ' + render, w.context);
  const now = Date.now();
  const old = { settings: { monitorSignals: false }, lastCheckedAt: now - 60000 };
  const current = { settings: { monitorSignals: false }, lastCheckedAt: now };
  const first = w.context.render();
  const second = w.context.render();
  assert.equal(reads.length, 2);
  reads[1](current); await second;
  reads[0](old); await first;
  assert.deepEqual(painted, [now]);
  assert.equal(receipts.length, 1);
  assert.ok(elements.get('lastChecked').textContent.includes(w.context.RadarTime.formatTime(now, 'Asia/Seoul')));
});
