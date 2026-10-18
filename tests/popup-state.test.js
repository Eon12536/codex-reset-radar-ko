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
  const collection = source.slice(source.indexOf('function collectionCheck('), source.indexOf('function renderNews('));
  vm.runInContext('let renderRevision = 0; ' + collection + render, w.context);
  const now = Date.now();
  const settings = { monitorSignals: false, timezoneMode: 'manual', timezoneOverride: 'Asia/Seoul' };
  const old = { settings, lastCheckedAt: now - 60000, signalSnapshot: { checkedAt: now - 60000 } };
  const current = { settings, lastCheckedAt: now, signalSnapshot: { checkedAt: now } };
  const first = w.context.render();
  const second = w.context.render();
  assert.equal(reads.length, 2);
  reads[1](current); await second;
  reads[0](old); await first;
  assert.deepEqual(painted, [now]);
  assert.equal(receipts.length, 1);
  assert.ok(elements.get('lastChecked').textContent.includes(w.context.RadarTime.formatTime(now, 'Asia/Seoul')));
});

test('news scan time never advances from an account-only check and latest collection errors override cached news', () => {
  const source = fs.readFileSync(require.resolve('../src/popup/popup.js'), 'utf8');
  const context = {};
  vm.runInNewContext(source.slice(source.indexOf('function collectionCheck('), source.indexOf('function renderNews(')), context);
  const settings = { monitorSignals: true, monitorLeadSource: true };
  const state = { signalSnapshot: { checkedAt: 1000, leadStatus: { directOk: true } }, lastCheckedAt: 9000 };
  assert.equal(context.collectionCheck(state, settings).checkedAt, 1000);
  assert.equal(context.collectionCheck({ lastCheckedAt: 9000 }, settings).checkedAt, 0);
  state.collectorHealth = { checkedAt: 2000, error: 'tab-blocked', lastSuccessAt: 1000 };
  assert.equal(context.collectionCheck(state, settings).checkedAt, 2000);
  assert.equal(context.collectionCheck(state, settings).error, 'tab-blocked');
  state.signalSnapshot.checkedAt = 3000;
  assert.equal(context.collectionCheck(state, settings).error, null);
  state.signalError = { at: 4000 };
  assert.equal(context.collectionCheck(state, settings).checkedAt, 4000);
  assert.equal(context.collectionCheck(state, settings).error, 'sources');
  assert.equal(context.collectionCheck(state, { ...settings, monitorLeadSource: false }).error, 'sources');
  assert.equal(context.collectionCheck({ ...state, signalError: null }, { ...settings, monitorLeadSource: false }).error, null);
  assert.equal(context.collectionCheck(state, { monitorSignals: false }).error, null);
});


test('partial collection names the failed author, timeline and stage without hiding the diagnostic reason', () => {
  const source = fs.readFileSync(require.resolve('../src/popup/popup.js'), 'utf8');
  const context = { msg: key => ({ collectorPosts: '원글', collectorReplies: '답글', collectorStageReading: '본문 읽기', collectorStageLoading: '페이지 로딩', 'collectorReason_timeout': '시간 초과', 'collectorReason_no-posts': '본문 미검출' })[key] || key,
    RadarSignals: { authorName: item => ({ thsottiaux: 'Tibo', reach_vb: 'VB', openai: 'OpenAI' })[item.author] } };
  vm.runInNewContext(source.slice(source.indexOf('function collectionFailures('), source.indexOf('function renderNews(')), context);
  const details = context.collectionFailures({ timelines: [
    { author: 'thsottiaux', kind: 'posts', ok: false, stage: 'reading', error: 'no-posts' },
    { author: 'reach_vb', kind: 'replies', ok: false, stage: 'loading', error: 'timeout' },
    { author: 'openai', kind: 'posts', ok: true } ] });
  assert.match(details, /Tibo 원글 \/ 본문 읽기: 본문 미검출/);
  assert.match(details, /VB 답글 \/ 페이지 로딩: 시간 초과/);
  assert.ok(!details.includes('OpenAI'));
  assert.equal(context.collectionFailures(null), '');
});
