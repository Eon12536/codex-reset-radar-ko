const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { makeWorker } = require('./helpers/worker');
const NOW = Date.parse('2026-10-02T08:30:00Z');
const KEY = 'a'.repeat(64);
const POST = '2105843926221660585';
const popup = fs.readFileSync(require.resolve('../src/popup/popup.js'), 'utf8');
const renderSource = popup.slice(popup.indexOf('function renderBankedArrival('), popup.indexOf('function renderAdvice('));
function page({ creditGrantState, credits = { availableCount: 3 }, monitorAccount = true, read = false } = {}) {
  const w = makeWorker({ stored: { settings: { monitorAccount, monitorSignals: true, monitorLeadSource: true, quietHoursEnabled: false },
    accountSnapshot: { accountKey: KEY, updatedAt: NOW - 60000, credits, usage: { windows: [{ kind: 'weekly', remainingPercent: 40 }] } },
    signalSnapshot: { activeSignals: [], reports: [{ id: POST, author: 'thsottiaux', text: 'Resets all propagated.',
      createdAt: new Date(NOW - 3600000).toISOString(), url: `https://x.com/thsottiaux/status/${POST}`, source: { id: 'codex-lead', weight: 1 } }] },
    publicAlertState: { entries: { [POST]: { observedAt: NOW - 60000, expiresAt: NOW - 60000 + 86400000,
      ...(read ? { badgeReadAt: NOW } : {}) } } }, creditGrantState } });
  w.context.Date = class extends Date { static now() { return NOW; } };
  const elements = Object.fromEntries(['weeklyUnread', 'newsUnread', 'creditsUnread', 'bankedArrivalUnread',
    'bankedArrival', 'bankedArrivalTitle', 'bankedArrivalMeta', 'viewBankedCredits'].map(id => [id,
      { hidden: true, textContent: '', dataset: {}, setAttribute(name, value) { this[name] = value; } }]));
  w.context.document = { getElementById: id => elements[id] };
  vm.runInContext("(function(){ const $ = id => document.getElementById(id); const msg = (...args) => RadarI18n.t(...args); let displayedBadgeReceipt = null;" + renderSource + "globalThis.BadgeUi = { renderBankedArrival, renderUnreadBadges }; })();", w.context);
  const labels = [];
  w.context.chrome.action.setBadgeText = async ({ text }) => labels.push(text);
  return { ...w, elements, labels,
    view() { return w.context.RadarBadge.view(w.local, w.context.RadarSettings.sanitize(w.local.settings)); },
    render() { const unread = this.view(); w.context.BadgeUi.renderBankedArrival(unread); w.context.BadgeUi.renderUnreadBadges(unread); return unread; },
    ack() { return w.send({ type: 'ACK_VISIBLE_BADGES', receipt: this.view().receipt }, w.sender('popup')); } };
}
function markers(p, visible) {
  for (const id of ['weeklyUnread', 'newsUnread', 'creditsUnread', 'bankedArrivalUnread'])
    assert.equal(p.elements[id].hidden, !visible, id);
}

test('public news with an account baseline shows the same unread marker beside credit status and the toolbar', async () => {
  const p = page({ creditGrantState: { accountKey: KEY, count: 3, observedAt: NOW, events: [] } });
  await p.context.ensureSecurity();
  await p.context.updateBadge(p.local.accountSnapshot, null, null);
  assert.equal(p.labels.at(-1), '40%!');
  const unread = p.render(); markers(p, true);
  assert.equal(unread.notice.kind, 'inventory');
  assert.equal(unread.bankedItems.length, 0);
  assert.equal(p.elements.bankedArrival.hidden, false);
  assert.doesNotMatch(p.elements.bankedArrivalTitle.textContent, /\+|지급/);
  assert.ok(p.elements.bankedArrivalMeta.textContent.includes(p.context.RadarTime.formatDateTime(NOW - 60000, 'Asia/Seoul')));
  assert.equal((await p.ack()).ok, true);
  p.render(); markers(p, false);
  assert.equal(p.labels.at(-1), '40%');
  assert.equal(p.elements.bankedArrival.dataset.kind, 'inventory');
  assert.equal(p.local.creditGrantState.count, 3);
});

test('without a verified credit inventory the acknowledgement banner describes public news, never a Banked grant', () => {
  const p = page({ credits: null });
  const unread = p.render(); markers(p, true);
  assert.equal(unread.notice.kind, 'public');
  assert.equal(p.elements.bankedArrival.dataset.kind, 'public');
  assert.doesNotMatch(p.elements.bankedArrivalTitle.textContent, /Banked|\+/);
  assert.equal(unread.receipt.banked.length, 0);
});

test('upgrade caches lacking credit-grant events still show known inventory without inventing an arrival', () => {
  const p = page();
  const unread = p.render(); markers(p, true);
  assert.equal(unread.notice.count, 3);
  assert.equal(unread.notice.kind, 'inventory');
  assert.equal(unread.bankedItems.length, 0);
  assert.equal(p.local.creditGrantState, undefined);
});

test('owned inventory without unread news has a green inventory banner and no exclamation marks', () => {
  const p = page({ read: true });
  p.render(); markers(p, false);
  assert.equal(p.elements.bankedArrival.hidden, false);
  assert.equal(p.elements.bankedArrival.dataset.kind, 'inventory');
});

test('a verified new Banked grant retains its real amount after the combined acknowledgement', async () => {
  const p = page({ creditGrantState: { accountKey: KEY, count: 3, observedAt: NOW, events: [{
    id: 'banked:account:1', accountKey: KEY, observedAt: NOW - 60000, added: 1, notify: true }] } });
  await p.context.ensureSecurity();
  assert.equal(p.render().notice.kind, 'grant'); markers(p, true);
  assert.match(p.elements.bankedArrivalTitle.textContent, /\+1/);
  await p.ack(); p.render(); markers(p, false);
  assert.equal(p.elements.bankedArrival.dataset.kind, 'grant');
  assert.match(p.elements.bankedArrivalTitle.textContent, /\+1/);
});

test('account monitoring opt-out cannot expose a cached Banked amount but public news remains reviewable', () => {
  const p = page({ monitorAccount: false });
  assert.equal(p.render().notice.kind, 'public'); markers(p, true);
  assert.doesNotMatch(p.elements.bankedArrivalTitle.textContent, /Banked|3/);
});

test('a 24-hour-old grant becomes ordinary inventory and never a new arrival during upgrade', () => {
  const p = page({ read: true, creditGrantState: { accountKey: KEY, count: 3, events: [{
    id: 'banked:old:1', accountKey: KEY, observedAt: NOW - 86400000, added: 1, notify: true }] } });
  assert.equal(p.render().notice.kind, 'inventory'); markers(p, false);
  assert.doesNotMatch(p.elements.bankedArrivalTitle.textContent, /\+|지급/);
});

test('a previously reviewed Banked grant does not hide a later public unread marker beside status', () => {
  const p = page({ creditGrantState: { accountKey: KEY, count: 3, events: [{
    id: 'banked:read:1', accountKey: KEY, observedAt: NOW - 60000, added: 1, badgeReadAt: NOW }] } });
  const unread = p.render();
  assert.equal(unread.bankedItems.length, 0);
  assert.equal(unread.publicItems.length, 1);
  assert.equal(unread.notice.kind, 'grant');
  assert.equal(p.elements.creditsUnread.hidden, false);
  assert.equal(p.elements.weeklyUnread.hidden, false);
  assert.equal(p.elements.bankedArrivalUnread.hidden, true);
});
