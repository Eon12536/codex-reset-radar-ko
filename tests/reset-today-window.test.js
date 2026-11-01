const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker } = require('./helpers/worker');
// User wording; synthetic IDs and publication times for deterministic QA.
const post = (text = 'Not enough resets. But today is a reset.', at = '2026-10-26T03:00:00Z') => ({
  id: '9920001', author: 'thsottiaux', url: 'https://x.com/thsottiaux/status/9920001',
  text, createdAt: at, source: { id: 'codex-lead' } });

test('the exact plural/sentence-separated screenshot wording is a forecast with an estimated source-day boundary', () => {
  const { context: c } = makeWorker(); c.RadarI18n.setLocale('ko-KR');
  for (const text of ['Not enough resets. But today is a reset.', 'Not enough reset. But today is a reset.',
    'Not enough rest. But today is a reset.', 'Day 21/ Not enough resets. But today is a reset.']) {
    const item = post(text);
    assert.equal(c.RadarSignals.classify(item, { now: Date.parse(item.createdAt) }).actionable, true, text);
    assert.equal(c.RadarDailyNews.statusKind({ item }), 'forecast', text);
    const value = c.RadarNews.schedule(item);
    assert.equal(value.deadlineAt, Date.parse('2026-10-26T07:00:00Z'), text);
    assert.equal(value.instant, undefined);
    assert.equal(value.estimatedWindow, true);
    assert.equal(value.assumedZone, true);
    assert.match(value.text, /한국.*10\/26.*오후 4:00.*추정/);
    assert.match(value.text, /미 서부.*가정/);
  }
});

test('publication source calendar, DST transitions and year boundaries determine the range, not the scan date', () => {
  const { context: c } = makeWorker();
  for (const [at, end] of [
    ['2026-10-26T03:00:00Z', '2026-10-26T07:00:00Z'],
    ['2026-10-26T09:00:00Z', '2026-10-27T07:00:00Z'],
    ['2026-03-08T09:00:00Z', '2026-03-09T07:00:00Z'],
    ['2026-11-01T08:00:00Z', '2026-11-02T08:00:00Z'],
    ['2027-01-01T02:00:00Z', '2027-01-01T08:00:00Z']]) {
    assert.equal(c.RadarNews.schedule(post('Today is a reset.', at)).deadlineAt, Date.parse(end), at);
  }
  assert.equal(c.RadarNews.schedule(post('Today is a reset PST.')).deadlineAt, Date.parse('2026-10-26T08:00:00Z'));
});

test('every selected country receives the same absolute estimated boundary and clearly estimated wording', () => {
  const { context: c } = makeWorker();
  for (const country of c.RadarI18n.COUNTRIES) {
    c.RadarI18n.setLocale(country.locale);
    const value = c.RadarNews.schedule(post());
    assert.equal(value.deadlineAt, Date.parse('2026-10-26T07:00:00Z'), country.code);
    assert.ok(value.text.includes(country.timeLabel), country.code);
    assert.match(value.text, /추정|estimated|estimate|\best\./i, country.code);
    const summary = c.RadarDailyNews.summary([{ item: post(), timingSchedule: value }]);
    assert.equal(summary.times[0].kind, 'window');
    assert.match(c.RadarDailyNews.headline(summary), /추정|estimated/i, country.code);
  }
});

test('unrelated today words, uncertainty, cancellation, completed reports and untrusted identities do not gain a day window', () => {
  const { context: c } = makeWorker();
  for (const text of ['Reset is coming tomorrow. Today we shipped a debugger.', 'Please reset today.',
    'Is today a reset?', 'Maybe today is a reset.', 'Today is not a reset.',
    'Today is a reset. Reset cancelled.', 'Today we reset the database.', 'Today is a reset for Claude.']) {
    assert.notEqual(c.RadarNews.schedule(post(text)).estimatedWindow, true, text);
  }
  for (const patch of [{ truncated: true }, { author: 'reach_vb', url: 'https://x.com/reach_vb/status/9920001' },
    { url: 'https://x.com.evil.test/thsottiaux/status/9920001' }, { createdAt: 'bad date' },
    { assessment: { report: 'completed-reset' } }])
    assert.notEqual(c.RadarNews.schedule({ ...post('Today is a reset.'), ...patch }).estimatedWindow, true, JSON.stringify(patch));
});

test('an explicit exact-time reply takes priority over an estimated today boundary without changing its country conversion', () => {
  const { context: c } = makeWorker();
  c.Date = class extends Date { static now() { return Date.parse('2026-10-26T04:00:00Z'); } };
  const parent = post('Today is a reset.'), child = { ...parent, id: '9920002',
    url: 'https://x.com/thsottiaux/status/9920002', text: 'Landing today before 10pm PST', createdAt: '2026-10-26T03:01:00Z',
    replyContext: { ...parent, relation: 'conversation-before', targetId: '9920002' } };
  const saved = c.RadarNews.timingReplies([parent, child]);
  const rows = c.RadarNews.list({ activeSignals: [{ ...parent, assessment: c.RadarSignals.classify(parent) }], timingReplies: saved },
    { items: [] }, { monitorSignals: true, monitorLeadSource: true, resetOnly: true });
  const row = rows.find(row => row.item.id === parent.id);
  assert.equal(row.timingSchedule.deadlineAt, Date.parse('2026-10-26T06:00:00Z'));
  assert.notEqual(row.timingSchedule.estimatedWindow, true);
  assert.equal(row.timingSourceKey, 'codex-lead:9920002');
});
