const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
const Direct = require('../src/core/direct-x');
const News = require('../src/core/news');
const Settings = require('../src/core/settings');
const Forecast = require('../src/core/forecast');
const Schedule = require('../src/core/schedule');
const { makeWorker, json } = require('./helpers/worker');
const fixture = require('./fixtures/tibo-product-time-conversation.json');
const post = (text, extra = {}) => ({ id: '123456', author: 'thsottiaux', text,
  url: 'https://x.com/thsottiaux/status/123456', createdAt: new Date().toISOString(),
  source: { id: 'codex-lead', weight: 1 }, ...extra });

test('the supplied time reply is a weak candidate without hardcoding a live post', () => {
  const now = Date.parse('2026-09-22T00:00:00Z');
  const item = Direct.normalize(fixture.rows, now)[0];
  const plain = { ...item, replyContext: undefined };
  assert.equal(Signals.classifyHint(plain, { now }).rule, 'schedule-time');
  const enriched = Direct.conversationContext(item, fixture, now);
  assert.equal(enriched.replyContext.id, fixture.rows[0].id);
  const assessment = Signals.classifyHint(enriched, { now });
  assert.equal(assessment.rule, 'product-time');
  assert.match(assessment.reason, /회고/);
  assert.equal(assessment.actionable, false);
  assert.equal(assessment.eventAt, null);
  assert.equal(Signals.classify(enriched, { now }).actionable, false);
  assert.equal(Forecast.build({ signals: [{ ...enriched, assessment }], timeZone: 'Asia/Seoul', now }).basis, 'baseline');
  for (const file of ['../src/core/signals', '../src/core/direct-x', '../src/background'])
    assert.doesNotMatch(fs.readFileSync(require.resolve(file), 'utf8'), /2101920928070562029/);
});

test('varied launch times and short schedule replies qualify, but unrelated or past statements do not', () => {
  for (const text of ['3am on a tuesday', 'Wednesday at 06:30 PM PT', 'Tomorrow at 23:15 UTC',
    'We are launching GPT-7 at 10am PT.', 'Codex goes live on Friday at 11:00.', 'New ChatGPT release at 9 a.m.']) {
    const result = Signals.classifyHint(post(text));
    assert.equal(result.candidate, true, text);
    assert.equal(result.eventAt, null, text);
  }
  for (const text of ['Tuesday', '3am', 'Lunch on Tuesday at 3pm', 'Codex meeting Tuesday at 3pm',
    'Codex launched yesterday at 3am', 'We will not release Codex at 3am Tuesday',
    'ChatGPT release delayed until Tuesday at 3am', 'Swag drops Tuesday at 3am', 'Claude launches Tuesday at 3am',
    'Tomorrow 25:00', 'Tuesday at 13am', 'My flight was Tuesday at 3am'])
    assert.equal(Signals.classifyHint(post(text)).candidate, false, text);
  for (const extra of [{ author: 'someone' }, { source: { id: 'github-community' } },
    { createdAt: new Date(Date.now() - 8 * 86400000).toISOString() }])
    assert.equal(Signals.classifyHint(post('Tuesday at 3am', extra)).candidate, false);
});

test('a clock-only reply needs the exact preceding product conversation; later comments do not qualify', () => {
  const item = post('10am');
  const parent = { ...fixture.rows[0], createdAt: new Date(Date.now() - 60000).toISOString(), text: 'When does the new ChatGPT release arrive?' };
  const result = { targetId: item.id, rows: [parent, item] };
  assert.equal(Signals.classifyHint(Direct.conversationContext(item, result)).rule, 'product-time');
  assert.equal(Signals.classifyHint(Direct.conversationContext(item, { ...result, rows: [item, parent] })).candidate, false);
  assert.equal(Signals.classifyHint(Direct.conversationContext(item, { ...result, targetId: '999' })).candidate, false);
});

test('popup shows a labelled regional assumption and Korean conversion without confirming a reset', () => {
  const news = News.select(null, { items: [post('3am on a tuesday')] }, Settings.sanitize());
  assert.equal(news.label, '후보');
  assert.match(news.timing, /미 서부 .*오전 3:00\n한국 .*오후 [78]:00 · 추정/);
  assert.match(news.timingDetail, /샌프란시스코/);
  assert.match(news.caption, /출시·리셋 여부 미확인/);
  assert.equal(News.timing('Wednesday at 06:30 PM PDT'), '수요일 · 오후 6:30 PDT');
  assert.equal(News.timing('Tomorrow at 23:15 UTC'), '내일 · 오후 11:15 UTC');
  assert.equal(News.timing('tomorrow at 00:00 KST'), '내일 · 오전 12:00 KST');
});

test('feed collection shows timed candidates and uses the existing opt-in one-time notification', async () => {
  for (const notifyHints of [false, true]) {
    const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorStatusSource: false,
      monitorHistorySource: false, monitorCommunitySource: false, quietHoursEnabled: false, notifyHints } },
      fetcher: async () => json({ items: [{ external_id: '123456', content: '3am on a tuesday',
        published_at: new Date().toISOString(), metadata: { author_user_name: 'thsottiaux' } }] }) });
    await w.context.refreshSignals();
    assert.equal(w.local.hintSnapshot.items[0].assessment.rule, 'schedule-time');
    assert.equal(w.local.signalSnapshot.activeSignals.length, 0);
    assert.equal(Boolean(w.notifications['hint:123456']), notifyHints);
    if (notifyHints) {
      assert.equal(w.notifications['hint:123456'].title, 'Tibo 일정 후보 · 리셋 미확인');
      assert.match(w.notifications['hint:123456'].message, /미 서부 .* → 한국 .* · 추정/);
    }
    await w.context.refreshSignals();
    assert.equal(Object.keys(w.notifications).filter(id => id === 'hint:123456').length, notifyHints ? 1 : 0);
  }
});

test('a later delay cannot turn a product/time clue into a reset schedule change', () => {
  const original = post('Tuesday at 3am', { createdAt: new Date(Date.now() - 3600000).toISOString() });
  const delayed = post('Delayed until Wednesday', { id: '123457', inReplyToId: original.id });
  const state = Schedule.reconcile(undefined, [original, delayed]);
  assert.equal(Schedule.changes(state).length, 0);
});
