const test = require('node:test');
const assert = require('node:assert/strict');
global.RadarTime = require('../src/core/time');
global.RadarSignals = require('../src/core/signals');
const Signals = global.RadarSignals;
const Direct = require('../src/core/direct-x');
const News = require('../src/core/news');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
const { posts: raw } = require('./fixtures/tibo-day17-oct22.json');
const NOW = Date.parse('2026-10-22T10:00:00Z');
const clone = x => JSON.parse(JSON.stringify(x));
function pair() {
  const [parent, child] = Direct.normalize(raw, NOW);
  return [parent, Direct.conversationContext(child, { targetId: child.id, rows: raw }, NOW)];
}

test('actual Day17 survives collection normalization and verified conversation enrichment', () => {
  const rows = pair();
  assert.equal(rows[1].replyContext?.id, rows[0].id);
  assert.equal(rows[1].replyContext?.relation, 'conversation-before');
  for (const item of rows) {
    const assessment = Signals.classify(item, { now: NOW });
    assert.equal(assessment.actionable, true, item.text);
    assert.equal(assessment.confidence, 'high');
    assert.equal(assessment.eventAt, null, 'deadline is not an execution timestamp');
    assert.equal(Signals.resetKind(item), 'unknown');
  }
  assert.ok(Signals.reports(rows, { now: NOW }).every(x => x.assessment.report !== 'completed-reset'));
});

test('literal PST deadline uses publication calendar, converts country time, and stays a deadline', () => {
  const schedule = News.schedule(raw[1]);
  assert.equal(schedule.deadlineAt, Date.parse('2026-10-22T18:00:00Z'));
  assert.equal(schedule.instant, undefined);
  assert.match(schedule.text, /10\/23.*3:00/);
  assert.match(schedule.text, /이전.*기한/);
  assert.match(schedule.detail, /실행 시각이 아니라/);
  assert.equal(News.schedule({ ...raw[1], text: 'Lands tomorrow before 10am PST and 11am PDT.' }).deadlineAt, undefined);
  assert.equal(News.schedule({ ...raw[1], text: 'Lands tomorrow before 10am IST.' }).deadlineAt, undefined);
});

test('rhetorical exception never exempts real negation, rumors, questions, unrelated or untrusted text', () => {
  const base = pair()[0];
  for (const text of ["No, it's not reset day today.", "Maybe it's reset day today.",
    "It's reset day today?", "He said it's reset day today.", "It's reset day today, but reset is cancelled.",
    "Router reset day today.", "Password reset day today.", "Yesterday was reset day.",
    "It's reset day today.\n\nUpdate: no reset today."]) {
    assert.equal(Signals.classify({ ...base, text }, { now: NOW }).actionable, false, text);
  }
  for (const extra of [{ truncated: true }, { author: 'someone' }, { url: 'https://evil.test/post' }]) {
    assert.equal(Signals.classify({ ...base, ...extra }, { now: NOW }).actionable, false);
  }
});

test('timing reply requires a verified same-author preceding parent', () => {
  const parent = pair()[0], child = raw[1];
  for (const context of [undefined, { ...child.replyContext, author: 'someone' },
    { ...child.replyContext, relation: 'adjacent-unverified' }, { ...child.replyContext, targetId: parent.id },
    { ...child.replyContext, createdAt: '2026-10-22T07:00:00Z' },
    { ...child.replyContext, text: 'Day 17/ New product ships today.' }]) {
    assert.equal(Signals.classify({ ...child, replyContext: context }, { now: NOW }).actionable, false);
  }
  const old = { ...child, text: 'Landing sometime today by EOD PST',
    replyContext: { ...child.replyContext, text: 'Day 13/ Le limit reset' } };
  assert.equal(Signals.classify(old, { now: NOW }).actionable, true, 'existing EOD self-reply preserved');
});

test('startup collects the actual pair before issuing Windows notification API calls, without duplicates', async () => {
  const settings = { monitorAccount: false, monitorSignals: true, monitorLeadSource: true,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false,
    notifyOfficialReset: true, quietHoursEnabled: false };
  const timelines = ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai']
    .map(author => ({ author, kind, ok: true, stopReason: 'seven-days' })));
  function worker(stored) {
    const w = makeWorker({ stored, fetcher: async () => json({ items: [] }) });
    w.context.Date = class extends Date { static now() { return NOW; } };
    w.order = [];
    w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => {
      w.order.push('read'); return { items: pair(), contextCache: {}, diagnostics: { posts: 2, timelines } };
    } };
    const create = w.context.chrome.notifications.create;
    w.context.chrome.notifications.create = async (id, options) => {
      w.order.push(id); return create(id, options);
    };
    return w;
  }
  const run = async w => { await w.events.startup(); await finishPublicResume(w); };
  const w = worker({ settings }); await run(w);
  const keys = raw.map(x => 'signal:' + x.id);
  for (const key of keys) {
    assert.ok(w.notifications[key], key);
    assert.ok(w.order.indexOf('read') < w.order.indexOf(key));
  }
  await run(w);
  for (const key of keys) assert.equal(w.order.filter(x => x === key).length, 1);
  const restarted = worker(clone(w.local)); await run(restarted);
  assert.ok(keys.every(key => !restarted.order.includes(key)));
});
