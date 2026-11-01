const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json } = require('./helpers/worker');
const NOW = Date.parse('2026-10-26T04:00Z');
const post = (text, id = '9910001') => ({ id, text, author: 'thsottiaux',
  source: { id: 'codex-lead' }, createdAt: '2026-10-26T03:00:00Z', url: `https://x.com/thsottiaux/status/${id}` });
const positive = ['Not enough reset, but today is a reset', 'Not enough rest, but today is a reset',
  'Day 21/ Not enough rest, but today is a reset.', 'Today is a reset.',
  'Day 17/ Bet you thought we forgot, but no, it’s reset day today.'];

test('the real standalone reset scarcity reply is inferred, while unrelated and negated posts remain excluded', () => {
  const { context: c } = makeWorker();
  const item = post('Not enough resets', '2114599388454481930');
  const hint = c.RadarSignals.classifyHint(item, { now: NOW });
  assert.equal(hint.candidate, true);
  assert.equal(hint.rule, 'reset-scarcity');
  assert.equal(c.RadarSignals.classify(item, { now: NOW }).actionable, false);
  assert.equal(c.RadarDailyNews.statusKind({ item: { ...item, assessment: hint } }), 'inferred');
  for (const text of ['Not enough password resets', 'Not enough resets for Claude', 'Not enough resets?', 'Not enough resets, do not reset', 'No reset today'])
    assert.notEqual(c.RadarSignals.classifyHint(post(text), { now: NOW }).rule, 'reset-scarcity', text);
  assert.notEqual(c.RadarSignals.classifyHint({ ...item, url: 'https://example.com/invalid' }, { now: NOW }).rule, 'reset-scarcity');
});

test('late detection groups a reset by its publication date in the configured country', async () => {
  const w = makeWorker({ individualPublicAlerts: false, stored: { settings: { monitorAccount: false,
    semanticEnabled: false, monitorStatusSource: false, monitorHistorySource: false,
    monitorCommunitySource: false, quietHoursEnabled: false } }, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW + 86400000; } };
  const item = post('Not enough resets', '2114599388454481930');
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: [item], diagnostics: { posts: 1,
    timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai'].map(author => ({ kind, author, ok: true, stopReason: 'seven-days' }))) } }) };
  await w.context.refreshSignals();
  const groups = w.context.RadarDailyNews.groups(w.local, w.local.settings);
  assert.equal(groups.find(g => g.items.some(row => row.item.id === item.id))?.day, '2026-10-26');
});

test('affirmative today-reset clause survives an unrelated opening complaint and exposes only an estimated day boundary', () => {
  const { context: c } = makeWorker();
  for (const text of positive) {
    const item = post(text), assessment = c.RadarSignals.classify(item, { now: NOW });
    assert.equal(assessment.actionable, true, text);
    assert.equal(c.RadarDailyNews.statusKind({ item: { ...item, assessment } }), 'forecast', text);
    const time = c.RadarNews.schedule(item);
    assert.equal(time.instant, undefined, text);
    assert.equal(time.deadlineAt, Date.parse('2026-10-26T07:00:00Z'), text);
    assert.equal(time.estimatedWindow, true, text);
  }
});

test('questions, guesses, real negation, cancellation and non-reset context stay outside explicit forecasts', () => {
  const { context: c } = makeWorker();
  for (const text of ['Today is not a reset.', 'Maybe today is a reset.', 'Is today a reset?',
    'Please make today a reset.', 'I heard today is a reset.', 'Someone said today is a reset.',
    'Not enough reset, but today is not a reset.', 'Not enough rest, but today is a reset? ',
    'Today is a password reset.', 'Today is a reset of the database.', 'Today is a reset for Claude.',
    'Not enough rest, but today is a reset. Reset cancelled.',
    'Not enough rest, but today is a reset.\n\nWe will not reset Codex limits.']) {
    const item = post(text);
    assert.equal(c.RadarSignals.isResetForecast(item), false, text);
    assert.equal(c.RadarSignals.classify(item, { now: NOW }).actionable, false, text);
  }
  for (const patch of [{ author: 'someone' }, { url: 'https://x.com.evil.test/thsottiaux/status/9910001' }, { truncated: true }]) {
    const item = { ...post(positive[0]), ...patch };
    assert.equal(c.RadarSignals.classify(item, { now: NOW }).actionable, false, JSON.stringify(patch));
  }
});

test('an unrelated later paragraph does not negate a validated reset announcement, but a reset cancellation does', () => {
  const { context: c } = makeWorker();
  const text = 'Not enough rest, but today is a reset.\n\nYou do not want to set up security in the middle of an incident.';
  assert.equal(c.RadarSignals.classify(post(text), { now: NOW }).actionable, true);
  assert.equal(c.RadarSignals.isResetForecast(post(text)), true);
  assert.equal(c.RadarSignals.isResetForecast(post(text + '\n\nThe reset is cancelled.')), false);
});

test('identified same-author midnight reply is an explicit schedule forecast without its own reset word', () => {
  const { context: c } = makeWorker();
  const parent = post('Day 20/ Rest and reset');
  const reply = { ...post('By midnight PST', '9910002'), createdAt: '2026-10-26T03:01:00Z',
    replyContext: { ...parent, relation: 'conversation-before', targetId: '9910002' } };
  assert.equal(c.RadarSignals.isResetForecast(reply), true);
  assert.equal(c.RadarDailyNews.statusKind({ item: reply }), 'forecast');
  const { replyContext, ...standalone } = reply;
  assert.equal(c.RadarSignals.isResetForecast(standalone), false);
  assert.equal(c.RadarSignals.isResetForecast({ ...reply, replyContext: { ...replyContext, author: 'reach_vb' } }), false);
  assert.equal(c.RadarSignals.isResetForecast({ ...reply, text: 'By midnight PST?' }), false);
  const linked = c.RadarSignals.linkTimingFollowUps([parent, standalone]).find(item => item.id === reply.id);
  assert.equal(c.RadarSignals.isResetForecast(linked), true, 'bounded subject inference does not erase an explicit deadline promise');
  assert.match(c.RadarNews.schedule(linked).text, /후속 글 기준/);
});

test('completed and inferred-completion reports preserve their separate meaning', () => {
  const { context: c } = makeWorker();
  assert.equal(c.RadarDailyNews.statusKind({ item: { ...post('Done'), assessment: { report: 'completed-reset' } } }), 'completed');
  assert.equal(c.RadarDailyNews.statusKind({ item: { ...post('Done'), assessment: { report: 'completed-reset', completionLink: 'inferred' } } }), 'inferred');
});

test('worker detects today-reset announcement without AI and publishes a forecast daily summary once', async () => {
  const w = makeWorker({ individualPublicAlerts: false, stored: { settings: { monitorAccount: false,
    semanticEnabled: false, monitorStatusSource: false, monitorHistorySource: false,
    monitorCommunitySource: false, quietHoursEnabled: false } }, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: [post(positive[0])], diagnostics: { posts: 1,
    timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai'].map(author => ({ kind, author, ok: true, stopReason: 'seven-days' }))) } }) };
  await w.context.refreshSignals(); await w.context.refreshSignals();
  assert.ok(w.local.signalSnapshot.activeSignals.some(item => item.text === positive[0]));
  const groups = w.context.RadarDailyNews.groups(w.local, w.local.settings);
  assert.equal(groups[0].counts.forecast, 1);
  assert.equal(Object.keys(w.notifications).filter(id => id.startsWith('daily-reset:')).length, 1);
  assert.match(Object.values(w.notifications)[0].message, /리셋 예고/);
  assert.match(Object.values(w.notifications)[0].title, /범위 추정/);
  assert.match(Object.values(w.notifications)[0].title, /미 서부 시간 가정/);
  assert.doesNotMatch(Object.values(w.notifications)[0].title, /리셋 예정 기한/);
});
