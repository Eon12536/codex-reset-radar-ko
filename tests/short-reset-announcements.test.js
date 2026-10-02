const test = require('node:test');
const assert = require('node:assert/strict');
global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
const News = require('../src/core/news');
const Settings = require('../src/core/settings');
const Forecast = require('../src/core/forecast');
const { makeWorker, json } = require('./helpers/worker');
// Public post and preceding reply read from X on 2026-09-29. Never a production ID rule.
const example = { id: '2103963215885701493', author: 'thsottiaux', text: 'Sorry Gia. More resets coming next week',
  createdAt: '2026-09-26T21:41:35.000Z', url: 'https://x.com/thsottiaux/status/2103963215885701493',
  isReply: true, source: { id: 'codex-lead', weight: 1 } };
const now = Date.parse('2026-09-29T00:00:00Z');

test('the supplied terse reset announcement is explicit even without a quota keyword or parent', () => {
  const assessment = Signals.classify(example, { now });
  assert.equal(assessment.actionable, true);
  assert.equal(assessment.eventAt, null);
  assert.equal(Signals.isActive({ ...example, assessment }, { now }), true);
  assert.equal(Signals.classifyHint(example, { now }).candidate, false);
  assert.equal(Signals.resetKind(example), 'unknown');
  assert.equal(Forecast.build({ signal: { ...example, assessment }, signals: [{ ...example, assessment }], timeZone: 'Asia/Seoul', now }).basis, 'baseline');
});

test('short forthcoming reset variants work across monitored authors without guessed hours', () => {
  for (const author of ['thsottiaux', 'reach_vb', 'OpenAI']) for (const text of [
    'More resets coming next week', 'More resets are coming tomorrow.',
    'Another reset is coming soon.', 'Resets are on the way this week.',
    'More resets planned for Tuesday.', 'A reset is scheduled for Friday.',
    'Resets will be coming next week.'
  ]) {
    const result = Signals.classify({ ...example, author, text }, { now });
    assert.equal(result.actionable, true, author + ': ' + text);
    assert.equal(result.eventAt, null, text);
  }
});

test('short announcement context cannot promote speculation, hearsay, completed or unrelated resets', () => {
  for (const text of ['Are more resets coming next week?', 'Maybe more resets are coming next week.',
    'No more resets coming next week.', 'More resets are not coming next week.', 'More resets were coming last week.',
    'I heard more resets coming next week.', 'Gia said more resets are coming tomorrow.',
    'More password resets coming next week.', 'Git resets coming tomorrow.',
    'More banked resets coming next week.', 'More reset credits coming next week.',
    'More resets are coming next week, but postponed.', 'More resets are coming next week, if we can.',
    'More resets. A new product is coming next week.', 'Resets completed. DevDay next week.'])
    assert.equal(Signals.classify({ ...example, text }, { now }).actionable, false, text);
  assert.equal(Signals.classify({ ...example, author: 'someone' }, { now }).actionable, false);
  assert.equal(Signals.classify({ ...example, source: { id: 'github-community' } }, { now }).actionable, false);
});

test('collection surfaces old missed announcements without sending a late toast', async () => {
  const old = { ...example, createdAt: new Date(Date.now() - 2 * 86400000).toISOString() };
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorSignals: true, monitorLeadSource: true,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false,
    notifyOfficialReset: true, notifyHints: true, quietHoursEnabled: false } },
    fetcher: async () => json({ items: [{ external_id: old.id, content: old.text, published_at: old.createdAt,
      metadata: { author_user_name: old.author, is_reply: true } }] }) });
  await w.context.refreshSignals();
  const [news] = News.list(w.local.signalSnapshot, w.local.hintSnapshot, Settings.sanitize());
  assert.equal(news.item.id, old.id);
  assert.equal(news.label, 'reset');
  assert.equal(news.timing, '다음 주');
  assert.equal(news.kindLabel, '리셋 종류 미확인');
  assert.equal(Object.keys(w.notifications).length, 0);
  await w.context.refreshSignals();
  assert.equal(Object.keys(w.notifications).length, 0);
});

test('a fresh terse announcement alerts once under existing explicit-reset settings', async () => {
  const item = { ...example, id: '123888', createdAt: new Date().toISOString(), url: 'https://x.com/thsottiaux/status/123888' };
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorSignals: true, monitorLeadSource: true,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false,
    notifyOfficialReset: true, quietHoursEnabled: false } }, fetcher: async () => json({ items: [{ external_id: item.id,
      content: item.text, published_at: item.createdAt, metadata: { author_user_name: item.author, is_reply: true } }] }) });
  await w.context.refreshSignals();
  assert.ok(w.notifications['signal:' + item.id]);
  const time = w.local.notificationHistory['signal:' + item.id];
  await w.context.refreshSignals();
  assert.equal(w.local.notificationHistory['signal:' + item.id], time);
});
