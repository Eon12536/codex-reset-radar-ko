const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json } = require('./helpers/worker');
const DAY = 86400000, NOW = Date.parse('2026-10-24T08:00:00Z');
const post = (id, at, text = 'We will reset Codex usage limits tomorrow.') => ({ id, text, author: 'thsottiaux',
  createdAt: new Date(at).toISOString(), url: `https://x.com/thsottiaux/status/${id}`, source: { id: 'codex-lead', kind: 'x-page', weight: 1 } });

test('old detected reset remains in display history without becoming an active or repeated alert', async () => {
  let now = NOW, rows = [post('1001', NOW - 60000)];
  const w = makeWorker({ individualPublicAlerts: false, stored: { settings: { monitorAccount: false, semanticEnabled: false,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false, quietHoursEnabled: false } }, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return now; } };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: rows, diagnostics: { posts: rows.length,
    timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai'].map(author => ({ kind, author, ok: true, stopReason: 'seven-days' }))) } }) };
  await w.context.refreshSignals();
  assert.ok(w.local.resetHistory.items.some(item => item.id === '1001'));
  const priorReceipt = w.local.notificationHistory?.['signal:1001'];
  now += 9 * DAY; rows = [post('1002', now - 60000)];
  await w.context.refreshSignals();
  const display = w.context.RadarDailyNews.displayEntries(w.local, w.local.settings);
  assert.ok(display.some(row => row.item.id === '1001' && row.historical));
  assert.ok(display.some(row => row.item.id === '1002'));
  assert.ok(!w.context.RadarDailyNews.entries(w.local, w.local.settings).some(row => row.item.id === '1001'));
  assert.equal((await w.send({ type: 'OPEN_NEWS', id: 'codex-lead:1001' }, w.sender('popup'))).ok, true);
  assert.equal(w.tabs.at(-1).url, 'https://x.com/thsottiaux/status/1001');
  assert.equal(w.local.notificationHistory?.['signal:1001'], priorReceipt);
});

test('history rejects untrusted links and keeps adding beyond the former item limit', () => {
  const w = makeWorker(), history = w.context.RadarResetHistory;
  const safe = post('9999', Date.now()); safe.assessment = { actionable: true };
  const bad = { ...safe, url: 'https://x.com.evil.test/thsottiaux/status/9999' };
  assert.equal(history.merge({}, [{ item: bad }]).items.length, 0);
  const existing = { items: Array.from({ length: 1000 }, (_, i) => ({ id: String(i + 100000) })), full: true };
  const result = history.merge(existing, [{ item: safe }]);
  assert.equal(result.items.length, 1001);
  assert.equal(result.full, false);
  assert.equal(result.items[0].id, '100000');
});

test('monthly groups include only selected local calendar month and preserve all records', () => {
  const w = makeWorker(), history = w.context.RadarResetHistory;
  const old = post('1001', Date.parse('2026-09-15T03:00:00Z'));
  const current = post('1002', Date.parse('2026-10-15T03:00:00Z'));
  old.assessment = current.assessment = { actionable: true };
  const state = { resetHistory: history.merge({}, [{ item: old }, { item: current }]) };
  const settings = { monitorSignals: true, monitorLeadSource: true, resetOnly: true };
  const sept = w.context.RadarDailyNews.groups(state, settings, '2026-09');
  const oct = w.context.RadarDailyNews.groups(state, settings, '2026-10');
  assert.deepEqual(Array.from(sept, g => g.items[0].item.id), ['1001']);
  assert.deepEqual(Array.from(oct, g => g.items[0].item.id), ['1002']);
  assert.equal(state.resetHistory.items.length, 2);
});

test('default month range follows the selected country and handles year boundaries', () => {
  const w = makeWorker(), daily = w.context.RadarDailyNews;
  w.context.RadarI18n.setLocale('ko-KR');
  assert.deepEqual(Array.from(daily.recentMonths(Date.parse('2026-10-31T15:30:00Z'))), ['2026-11', '2026-10']);
  assert.deepEqual(Array.from(daily.recentMonths(Date.parse('2026-12-31T15:30:00Z'))), ['2027-01', '2026-12']);
  w.context.RadarI18n.setLocale('en-US');
  assert.deepEqual(Array.from(daily.recentMonths(Date.parse('2026-10-31T15:30:00Z'))), ['2026-10', '2026-09']);
});

test('default range includes current and previous months while explicit month shows only that month', () => {
  const w = makeWorker(), history = w.context.RadarResetHistory, daily = w.context.RadarDailyNews;
  const dates = ['2026-09-15', '2026-10-15', '2026-11-01'];
  const items = dates.map((date, i) => ({ ...post(String(1100 + i), Date.parse(date + 'T03:00:00Z')), assessment: { actionable: true } }));
  const state = { resetHistory: history.merge({}, items.map(item => ({ item }))) };
  const settings = { monitorSignals: true, monitorLeadSource: true, resetOnly: true };
  const recent = daily.groups(state, settings, ['2026-11', '2026-10']);
  const selected = daily.groups(state, settings, '2026-09');
  assert.deepEqual(Array.from(recent, group => group.items[0].item.id), ['1102', '1101']);
  assert.deepEqual(Array.from(selected, group => group.items[0].item.id), ['1100']);
  assert.equal(state.resetHistory.items.length, 3);
});

test('archived entries stay hidden when public monitoring is disabled', () => {
  const w = makeWorker(), history = w.context.RadarResetHistory;
  const item = post('1001', Date.now()); item.assessment = { actionable: true };
  const archive = history.merge({}, [{ item }]);
  assert.equal(history.rows({ resetHistory: archive }, { monitorSignals: false, monitorLeadSource: true }).length, 0);
});

test('history storage failure does not block live collection or alerts', async () => {
  const w = makeWorker({ stored: { settings: { monitorAccount: false, semanticEnabled: false, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false, quietHoursEnabled: false } },
    storageHook: async (area, action, data) => { if (area === 'local' && action === 'set' && data.resetHistory) throw new Error('quota'); },
    fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: [post('1003', NOW - 60000)],
    diagnostics: { posts: 1, timelines: [] } }) };
  await w.context.refreshSignals();
  assert.ok(w.local.signalSnapshot.activeSignals.some(item => item.id === '1003'));
  assert.equal(w.local.resetHistoryStorageError, true);
  assert.ok(w.notifications['signal:1003']);
});

test('a verified timing reply remains attached to its parent in old display history', async () => {
  let now = NOW;
  const w = makeWorker({ stored: { settings: { monitorAccount: false, semanticEnabled: false, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false, quietHoursEnabled: false } }, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return now; } };
  const raw = require('./fixtures/tibo-day18-oct23.json').posts;
  const [parent, child] = w.context.RadarDirectX.normalize(raw, NOW);
  const reply = w.context.RadarDirectX.conversationContext(child, { targetId: child.id, rows: raw }, NOW);
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: [parent, reply], diagnostics: { posts: 2, timelines: [] } }) };
  await w.context.refreshSignals();
  now += 9 * DAY;
  const old = w.context.RadarDailyNews.displayEntries(w.local, w.local.settings).find(row => row.item.id === parent.id);
  assert.equal(old.historical, true);
  assert.equal(old.timingSchedule.deadlineAt, Date.parse('2026-10-23T18:00:00Z'));
});

test('upgrade recovers a still-retained older raw reset without generating an alert', async () => {
  const item = post('1004', NOW - 3 * DAY);
  const w = makeWorker({ stored: { settings: { monitorAccount: false, semanticEnabled: false, monitorSignals: true,
    monitorLeadSource: true, quietHoursEnabled: false }, directXPendingPosts: [item] } });
  w.context.Date = class extends Date { static now() { return NOW; } };
  await w.context.ensureSecurity();
  assert.ok(w.local.resetHistory.items.some(entry => entry.id === item.id));
  assert.ok(w.context.RadarDailyNews.displayEntries(w.local, w.local.settings).some(row => row.item.id === item.id));
  assert.equal(Object.keys(w.notifications).filter(id => id.includes(item.id)).length, 0);
});
