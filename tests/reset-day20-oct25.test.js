const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json } = require('./helpers/worker');
// Text from the user's screenshot; IDs and reply timestamp are synthetic.
// The fixture verifies conversion, not the real reply's publication time.
const NOW = Date.parse('2026-10-26T05:00Z');
function pair() {
  const parent = { id: '9900001', author: 'thsottiaux', text: 'Day 20/ Rest and reset',
    createdAt: '2026-10-25T03:39:00Z', url: 'https://x.com/thsottiaux/status/9900001', source: { id: 'codex-lead' } };
  const reply = { ...parent, id: '9900002', text: 'By midnight PST', createdAt: '2026-10-25T03:40:00Z',
    url: 'https://x.com/thsottiaux/status/9900002', replyContext: { ...parent, relation: 'conversation-before', targetId: '9900002' } };
  return [parent, reply];
}
function runtime() {
  const w = makeWorker();
  w.context.Date = class extends Date { static now() { return NOW; } };
  return w;
}

test('Day20 verified reply survives classification and historical timing retention', () => {
  const { context: c } = runtime(), [parent, reply] = pair();
  assert.equal(c.RadarSignals.resetAnchor(parent), true);
  assert.equal(c.RadarSignals.classify(reply, { now: Date.parse(reply.createdAt) }).actionable, true);
  const saved = c.RadarNews.timingReplies([parent, reply], NOW);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].replyContext.relation, 'conversation-before');
  assert.equal(c.RadarNews.timingReplies(saved, NOW).length, 1, 'persisted evidence survives a worker restart');
  assert.equal(c.RadarNews.schedule(saved[0]).deadlineAt, Date.parse('2026-10-25T08:00Z'));
});

test('a unique bounded standalone midnight promise enriches parent and counts as a forecast', () => {
  const { context: c } = runtime(), [parent, verified] = pair();
  const { replyContext, ...reply } = verified;
  const saved = c.RadarNews.timingReplies([parent, reply], NOW);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].replyContext.relation, 'previous-reset-announcement');
  const state = { signalSnapshot: { timingReplies: saved }, hintSnapshot: { items: [parent] } };
  const settings = { monitorSignals: true, monitorLeadSource: true, resetOnly: true };
  const rows = c.RadarDailyNews.entries(state, settings);
  assert.equal(rows.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(c.RadarDailyNews.resetCounts(rows))), { forecast: 2, completed: 0, inferred: 0, grant: 0 });
  const root = rows.find(row => row.item.id === parent.id);
  assert.equal(root.timingSchedule.deadlineAt, Date.parse('2026-10-25T08:00Z'));
  assert.match(root.timing, /한국.*10\/25.*오후 5:00.*기한.*후속 글 기준/);
});

test('midnight anchors to publication source day, preserves literal PST, and supports country conversion', () => {
  const { context: c } = runtime(), [, reply] = pair();
  for (const country of c.RadarI18n.COUNTRIES) {
    c.RadarI18n.setLocale(country.locale);
    const value = c.RadarNews.schedule(reply);
    assert.equal(value.deadlineAt, Date.parse('2026-10-25T08:00Z'), country.code);
    assert.equal(value.instant, undefined);
    assert.ok(value.text.includes(country.timeLabel), country.code);
  }
  c.RadarI18n.setLocale('ko-KR');
  assert.equal(c.RadarNews.schedule({ ...reply, text: 'By midnight PT' }).deadlineAt, Date.parse('2026-10-25T07:00Z'));
  assert.equal(c.RadarNews.schedule({ ...reply, text: 'Tomorrow by midnight PST' }).deadlineAt, Date.parse('2026-10-26T08:00Z'));
  assert.equal(c.RadarNews.schedule({ ...reply, createdAt: '2026-10-25T09:00Z' }).deadlineAt, Date.parse('2026-10-26T08:00Z'));
});

test('foreign, ambiguous, edited, unlinked and contradictory midnight evidence is rejected', () => {
  const { context: c } = runtime(), [parent, verified] = pair();
  const { replyContext, ...reply } = verified;
  assert.equal(c.RadarResetScope.allows(verified, { resetOnly: true }), true);
  for (const item of [reply, { ...verified, url: 'https://x.com.evil.test/thsottiaux/status/9900002' },
    { ...verified, author: 'reach_vb', url: 'https://x.com/reach_vb/status/9900002' },
    { ...verified, replyContext: { ...replyContext, text: 'Lunch tomorrow.' } }])
    assert.equal(c.RadarResetScope.allows(item, { resetOnly: true }), false, JSON.stringify(item));
  for (const rows of [[reply], [{ ...parent, text: 'Day 20/ Reset the database' }, reply],
    [parent, { ...reply, author: 'reach_vb', url: 'https://x.com/reach_vb/status/9900002' }],
    [parent, { ...reply, createdAt: '2026-10-25T04:00Z' }],
    [parent, { ...parent, id: '9900003', url: 'https://x.com/thsottiaux/status/9900003' }, reply]])
    assert.equal(c.RadarNews.timingReplies(rows, NOW).length, 0, JSON.stringify(rows));
  for (const text of ['Not by midnight PST', 'By midnight PST?', 'By midnight PST and 10am PDT', 'By midnight PST, reset cancelled']) {
    assert.equal(c.RadarNews.timingReplies([{ ...verified, text }], NOW).length, 0, text);
    assert.equal(c.RadarNews.schedule({ ...verified, text }).deadlineAt, undefined, text);
  }
  assert.equal(c.RadarNews.timingReplies([verified, { ...parent, text: 'Lunch tomorrow.' }], NOW).length, 0);
});

test('new display rule depends on reset wording and intent, with completed reports preserved', () => {
  const { context: c } = runtime(), [base] = pair();
  const kind = (text, assessment = {}) => c.RadarDailyNews.statusKind({ item: { ...base, text, assessment } });
  for (const text of ['Day 20/ Rest and reset', 'Day 13/ Le limit reset', 'We will reset Codex usage limits tomorrow.'])
    assert.equal(kind(text, { actionable: true }), 'forecast', text);
  for (const text of ['By midnight PST', 'Time to refuel Codex soon.', 'Please reset Codex limits.', 'Will you reset Codex limits?',
    'We should reset Codex limits.', 'We will not reset Codex limits.', 'Codex will reset the database.'])
    assert.equal(kind(text, { actionable: true }), 'inferred', text);
  assert.equal(kind('Done', { report: 'completed-reset' }), 'completed');
  assert.equal(kind('Done', { report: 'completed-reset', completionLink: 'inferred' }), 'inferred');
});

test('worker publishes retained midnight timing into the daily banner and keeps one daily toast', async () => {
  const w = makeWorker({ individualPublicAlerts: false, stored: { settings: { monitorAccount: false,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false, semanticEnabled: false, quietHoursEnabled: false } },
    fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return Date.parse('2026-10-25T05:00Z'); } };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: pair(), diagnostics: { posts: 2,
    timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai'].map(author => ({ kind, author, ok: true, stopReason: 'seven-days' }))) } }) };
  await w.context.refreshSignals();
  await w.context.refreshSignals();
  assert.equal(w.local.signalSnapshot.timingReplies.length, 1);
  const groups = w.context.RadarDailyNews.groups(w.local, w.local.settings);
  assert.equal(groups[0].times[0].at, Date.parse('2026-10-25T08:00Z'));
  assert.match(groups[0].times[0].text, /10\/25.*오후 5:00/);
  assert.equal(Object.keys(w.notifications).filter(id => id.startsWith('daily-reset:')).length, 1);
});
