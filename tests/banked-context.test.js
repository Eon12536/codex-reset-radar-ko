const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker } = require('./helpers/worker');
const NOW = Date.parse('2026-10-31T12:00:00Z');
const id = '2116405493014954275';
const observed = 'Day 26/ You can now easily switch between multiple accounts on mobile, and coming soon to desktop too. Next two days will be resets… banked… do with this what you may 👀.';
function post(text = observed) {
  return { id, text, author: 'thsottiaux', createdAt: new Date(NOW).toISOString(),
    url: `https://x.com/thsottiaux/status/${id}`, source: { id: 'codex-lead', kind: 'x-page', weight: 1 } };
}

test('observed separated reset and banked announcement is a forecast, not a completed personal grant', () => {
  const c = makeWorker().context, item = post();
  const [report] = c.RadarSignals.reports([item], { now: NOW });
  assert.equal(report.assessment.report, 'credit-grant');
  assert.equal(report.assessment.grantStage, 'forecast');
  assert.equal(report.assessment.actionable, false);
  assert.equal(c.RadarDailyNews.status({ item: report }), '리셋권 예고');
  assert.equal(c.RadarDailyNews.resetCounts([{ item: report }]).grant, 1);
});

test('unrelated, negated and unverified text cannot become a banked announcement', () => {
  const c = makeWorker().context;
  for (const text of ['Next two days will not be resets… banked…', 'Maybe the next days will be resets… banked…',
    'The password will be resets… banked…', 'Our banked accounts will be closed.', 'The next two days will be resets.']) {
    assert.equal(c.RadarSignals.bankedForecast(post(text)), false, text);
  }
  assert.equal(c.RadarSignals.bankedForecast({ ...post(), url: 'https://evil.example/status/' + id }), false);
});

test('previously archived inferred observation displays in banked category without a new notification', () => {
  const w = makeWorker(), c = w.context, item = { ...post(), assessment: { candidate: true } };
  const state = { resetHistory: c.RadarResetHistory.merge({}, [{ item }]) };
  const settings = { monitorSignals: true, monitorLeadSource: true, resetOnly: true };
  const rows = c.RadarDailyNews.displayEntries(state, settings);
  assert.equal(rows.length, 1);
  assert.equal(c.RadarDailyNews.status(rows[0]), '리셋권 예고');
  assert.equal(c.RadarDailyNews.resetCounts(rows).grant, 1);
  assert.equal(Object.keys(w.notifications).length, 0);
});

test('three October 31 excerpts count banked forecast separately from the other two inferred posts', () => {
  const c = makeWorker().context;
  const inferred = text => ({ item: { ...post(text), assessment: { candidate: true } } });
  const rows = [inferred('Also, RESETS incoming!'), inferred(observed), inferred('Better announce 28 days of reset')];
  assert.equal(c.RadarDailyNews.status(rows[1]), '리셋권 예고');
  assert.equal(c.RadarDailyNews.resetCounts(rows).grant, 1);
  assert.equal(c.RadarDailyNews.resetCounts(rows).inferred, 2);
});

test('short VB and numbered Tibo announcements are public credit reports', () => {
  const c = makeWorker().context;
  for (const [author, text] of [['reach_vb', 'banked reset for y’all – enjoy!'], ['thsottiaux', 'Day 28/ Banked 2/2']]) {
    const item = { ...post(text), author, url: `https://x.com/${author}/status/${id}` };
    assert.equal(c.RadarSignals.bankedGrant(item), true, text);
    const [report] = c.RadarSignals.reports([item], { now: NOW });
    assert.equal(report?.assessment.report, 'credit-grant', text);
    assert.equal(c.RadarResetScope.allows(report, { resetOnly: true }), true, text);
    assert.equal(c.RadarDailyNews.resetCounts([{ item: report }]).grant, 1, text);
  }
});

test('banked demands, questions, negations, finance and untrusted authors do not become short credit reports', () => {
  const c = makeWorker().context;
  for (const text of ['I demand a banked reset', 'no banked reset for y’all – enjoy!', 'banked reset for y’all – enjoy?',
    'Day 28/ Banked 2/2?', 'banked account 2/2', 'maybe banked reset for y’all – enjoy!', 'Next two days will be resets… banked…']) {
    assert.equal(c.RadarSignals.bankedGrant(post(text)), false, text);
  }
  assert.equal(c.RadarSignals.bankedGrant({ ...post('Day 28/ Banked 2/2'), author: 'reach_vb', url: `https://x.com/reach_vb/status/${id}` }), false);
  assert.equal(c.RadarSignals.bankedGrant({ ...post('Day 28/ Banked 2/2'), url: 'https://evil.example/status/' + id }), false);
});

test('a previously stored inferred VB announcement displays as credit without a replayed notification', () => {
  const w = makeWorker(), c = w.context;
  const item = { ...post('banked reset for y’all – enjoy!'), author: 'reach_vb',
    url: `https://x.com/reach_vb/status/${id}`, assessment: { candidate: true } };
  const state = { resetHistory: c.RadarResetHistory.merge({}, [{ item }]) };
  const rows = c.RadarDailyNews.displayEntries(state, { monitorSignals: true, monitorLeadSource: true, resetOnly: true });
  assert.equal(rows.length, 1);
  assert.equal(c.RadarDailyNews.resetCounts(rows).grant, 1);
  assert.equal(Object.keys(w.notifications).length, 0);
});

test('both freshly collected short announcements survive classification and the reset-only popup filter', async () => {
  const { json } = require('./helpers/worker');
  const w = makeWorker({ individualPublicAlerts: false, stored: { settings: { monitorSignals: true, monitorLeadSource: true,
    monitorDirectX: true, resetOnly: true, monitorAccount: false, semanticEnabled: false, quietHoursEnabled: false,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false } }, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  const vb = { ...post('banked reset for y’all – enjoy!'), author: 'reach_vb', url: `https://x.com/reach_vb/status/${id}` };
  const tiboId = '2116405493014954276';
  const tibo = { ...post('Day 28/ Banked 2/2'), id: tiboId, url: `https://x.com/thsottiaux/status/${tiboId}` };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: [vb, tibo], diagnostics: { posts: 2,
    timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai'].map(author => ({ author, kind, ok: true, stopReason: 'seven-days' }))) } }) };
  await w.context.refreshSignals();
  assert.equal(w.local.signalSnapshot.reports.filter(item => item.assessment.report === 'credit-grant').length, 2);
  const rows = w.context.RadarDailyNews.displayEntries(w.local, w.local.settings);
  assert.equal(w.context.RadarDailyNews.resetCounts(rows).grant, 2);
  assert.ok(rows.some(row => row.item.id === tiboId));
});
