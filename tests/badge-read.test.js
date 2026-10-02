const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json } = require('./helpers/worker');
const START = Date.parse('2026-10-02T07:00:00Z');
const DAY = 86400000;
const KEY = 'a'.repeat(64);
function worker(stored = {}, storageHook) {
  let now = START;
  const item = { id: '2105843926221660999', text: 'Resets all propagated.', author: 'thsottiaux',
    createdAt: new Date(START - 3600000).toISOString(), url: 'https://x.com/thsottiaux/status/2105843926221660999', source: { id: 'codex-lead', weight: 1 } };
  const w = makeWorker({ stored: { settings: { monitorAccount: true, monitorSignals: true, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false, quietHoursEnabled: false },
    accountSnapshot: { accountKey: KEY, credits: { availableCount: 3 }, usage: { windows: [{ kind: 'weekly', remainingPercent: 40 }] } },
    creditGrantState: { accountKey: KEY, observedAt: START, count: 3, sequence: 1, seenIds: ['b'.repeat(64)], identitiesReady: true,
      events: [{ id: 'banked:account:1', accountKey: KEY, observedAt: START - 60000, added: 1, availableCount: 3, notify: true }] },
    signalSnapshot: { reports: [item], checkedAt: START },
    publicAlertState: { entries: { [item.id]: { observedAt: START - 60000, expiresAt: START - 60000 + DAY, publishedAt: START - 3600000 } } },
    ...stored }, storageHook, fetcher: async () => json({ items: [{ external_id: item.id, content: item.text,
      published_at: item.createdAt, metadata: { author_user_name: item.author } }] }) });
  w.context.Date = class extends Date { static now() { return now; } };
  const labels = [];
  w.context.chrome.action.setBadgeText = async ({ text }) => labels.push(text);
  return { ...w, item, labels, clock(value) { now = value; },
    view() { return w.context.RadarBadge.view(w.local, w.context.RadarSettings.sanitize(w.local.settings)); },
    ack(receipt) { return w.send({ type: 'ACK_VISIBLE_BADGES', receipt }, w.sender('popup')); } };
}

test('opening the credit details acknowledges the rendered public and Banked markers together', async () => {
  const w = worker();
  await w.context.ensureSecurity();
  await w.context.updateBadge(w.local.accountSnapshot, null, null);
  assert.equal(w.labels.at(-1), '40%!');
  const receipt = w.view().receipt;
  assert.equal(receipt.public.length, 1); assert.equal(receipt.banked.length, 1);
  const inventory = structuredClone(w.local.creditGrantState.seenIds);
  const history = JSON.stringify(w.local.notificationHistory);
  const requests = w.requests.length;
  assert.equal((await w.ack(receipt)).ok, true);
  assert.equal(w.labels.at(-1), '40%');
  assert.equal(w.view().publicItems.length, 0); assert.equal(w.view().bankedItems.length, 0);
  assert.equal(w.local.creditGrantState.count, 3);
  assert.deepEqual(w.local.creditGrantState.seenIds, inventory);
  assert.equal(JSON.stringify(w.local.notificationHistory), history);
  assert.equal(w.requests.length, requests); // A read acknowledgement never redeems or fetches.
  assert.equal(w.local.signalSnapshot.reports.length, 1);
  assert.equal(w.context.RadarCreditGrants.latest(w.local.creditGrantState, w.local.accountSnapshot).added, 1);
});

test('merely viewing the popup state does not acknowledge or consume an arrival', () => {
  const w = worker();
  const before = JSON.stringify(w.local);
  for (let i = 0; i < 3; i++) assert.equal(w.view().bankedItems.length, 1);
  assert.equal(JSON.stringify(w.local), before);
});

test('read markers stay cleared after repeated scans, popup reopening and worker restart', async () => {
  const w = worker(); await w.context.ensureSecurity();
  const receipt = w.view().receipt;
  await w.ack(receipt);
  await w.context.refreshSignals();
  assert.equal(w.labels.at(-1), '40%');
  const restarted = worker(structuredClone(w.local));
  await restarted.context.ensureSecurity();
  await restarted.context.updateBadge(restarted.local.accountSnapshot, null, null);
  assert.equal(restarted.labels.at(-1), '40%');
  assert.equal(restarted.view().receipt.banked.length, 0);
  assert.equal((await restarted.ack(receipt)).ok, true);
  assert.equal(restarted.labels.at(-1), '40%');
});

test('a later server inventory increase restores the marker and preserves the previous read event', async () => {
  const w = worker(); await w.context.ensureSecurity();
  await w.ack(w.view().receipt);
  w.clock(START + 60000);
  w.local.creditGrantState = w.context.RadarCreditGrants.advance(w.local.creditGrantState,
    { count: 4, ids: ['b'.repeat(64), 'd'.repeat(64)] }, KEY, { now: START + 60000 });
  await w.context.updateBadge(w.local.accountSnapshot, null, null);
  assert.equal(w.labels.at(-1), '40%!');
  assert.equal(w.local.creditGrantState.count, 4);
  assert.equal(w.local.creditGrantState.events[0].badgeReadAt, START);
  assert.equal(w.view().bankedItems.length, 1);
  assert.equal(w.view().bankedItems[0].added, 1);
});

test('a failed storage write keeps notices unread and a subsequent retry can acknowledge them', async () => {
  let rejectWrite = false;
  const w = worker({}, (area, operation, data) => {
    if (rejectWrite && area === 'local' && operation === 'set' && data.publicAlertState) throw new Error('Storage unavailable');
  });
  await w.context.ensureSecurity();
  await w.context.updateBadge(w.local.accountSnapshot, null, null);
  const receipt = w.view().receipt;
  rejectWrite = true;
  assert.equal((await w.ack(receipt)).ok, false);
  assert.equal(w.labels.at(-1), '40%!');
  assert.equal(w.view().publicItems.length, 1);
  assert.equal(w.view().bankedItems.length, 1);
  rejectWrite = false;
  assert.equal((await w.ack(receipt)).ok, true);
  assert.equal(w.labels.at(-1), '40%');
});

test('an arrival while acknowledgement is queued stays unread until separately reviewed', async () => {
  const w = worker(); await w.context.ensureSecurity();
  const receipt = w.view().receipt;
  w.clock(START + 1000);
  w.local.creditGrantState.events.push({ id: 'banked:account:2', accountKey: KEY, observedAt: START + 1000, added: 1, notify: true });
  assert.equal((await w.ack(receipt)).ok, true);
  assert.equal(w.labels.at(-1), '40%!');
  assert.equal(w.view().bankedItems.length, 1);
  assert.equal(w.view().bankedItems[0].id, 'banked:account:2');
  assert.equal((await w.ack(w.view().receipt)).ok, true);
  assert.equal(w.labels.at(-1), '40%');
});

test('acknowledgement from a previous account cannot mark the current account grant as read', async () => {
  const w = worker(); await w.context.ensureSecurity();
  const receipt = w.view().receipt;
  const other = 'c'.repeat(64);
  w.local.accountSnapshot.accountKey = other;
  w.local.creditGrantState.accountKey = other;
  w.local.creditGrantState.events = [{ id: 'banked:account:1', accountKey: other, observedAt: START - 60000, added: 1, notify: true }];
  await w.ack(receipt);
  assert.equal(w.view().bankedItems.length, 1);
  assert.equal(w.labels.at(-1), '40%!');
  assert.equal(w.local.creditGrantState.events[0].badgeReadAt, undefined);
});

test('a newer observation with the same public ID is not acknowledged by an old receipt', async () => {
  const w = worker(); await w.context.ensureSecurity();
  const receipt = w.view().receipt;
  w.clock(START + 1000);
  w.local.publicAlertState.entries[w.item.id] = { observedAt: START + 1000, expiresAt: START + 1000 + DAY, publishedAt: START };
  await w.ack(receipt);
  assert.equal(w.view().publicItems.length, 1);
  assert.equal(w.labels.at(-1), '40%!');
});

test('unread markers still expire at their original 24-hour boundary without acknowledgement', async () => {
  const w = worker(); await w.context.ensureSecurity();
  w.clock(START - 60000 + DAY - 1);
  await w.context.updateBadge(w.local.accountSnapshot, null, null);
  assert.equal(w.labels.at(-1), '40%!');
  w.clock(START - 60000 + DAY);
  await w.events.alarm({ name: 'codex-reset-radar-badge-expiry' });
  assert.equal(w.labels.at(-1), '40%');
  assert.equal(w.view().bankedItems.length, 0);
});

test('reading an arrival preserves pending Windows notifications and their separate delivery policy', async () => {
  const w = worker(); await w.context.ensureSecurity();
  w.local.pendingNotifications = [{ id: 'banked:account:1', createdAt: START, options: { title: 'Banked reset +1' } }];
  const before = JSON.stringify(w.local.pendingNotifications);
  await w.ack(w.view().receipt);
  assert.equal(JSON.stringify(w.local.pendingNotifications), before);
  assert.equal(w.local.creditGrantState.events[0].notify, true);
});

test('legacy recent news can be read without reviving it on the next scan', async () => {
  const w = worker(); await w.context.ensureSecurity();
  delete w.local.publicAlertState;
  const receipt = w.view().receipt;
  assert.equal(receipt.public.length, 1);
  await w.ack(receipt);
  assert.equal(w.labels.at(-1), '40%');
  await w.context.refreshSignals();
  assert.equal(w.labels.at(-1), '40%');
});

test('only the trusted popup can submit a bounded, exact badge receipt', async () => {
  const w = worker(); await w.context.ensureSecurity();
  const receipt = w.view().receipt;
  const before = JSON.stringify(w.local);
  for (const sender of [{ ...w.sender('popup'), url: 'https://chatgpt.com/' },
    w.sender('options'), { ...w.sender('popup'), frameId: 1 }, { ...w.sender('popup'), id: 'another-extension' }])
    assert.equal((await w.send({ type: 'ACK_VISIBLE_BADGES', receipt }, sender)).ok, false);
  for (const bad of [{ ...receipt, public: new Array(501).fill(receipt.public[0]) },
    { ...receipt, extra: true }, { ...receipt, accountKey: 'wrong' },
    { ...receipt, banked: [{ id: '__proto__', detectedAt: START }] },
    { ...receipt, public: [{ id: w.item.id, detectedAt: 'now' }] }]) assert.equal((await w.ack(bad)).ok, false);
  assert.equal(JSON.stringify(w.local), before);
});
