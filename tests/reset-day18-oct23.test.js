const test = require('node:test');
const assert = require('node:assert/strict');
global.RadarTime = require('../src/core/time');
global.RadarSignals = require('../src/core/signals');
const Direct = require('../src/core/direct-x');
const News = require('../src/core/news');
const { makeWorker, json } = require('./helpers/worker');
const { posts } = require('./fixtures/tibo-day18-oct23.json');
const NOW = Date.parse('2026-10-23T09:00:00Z');
const pair = () => { const rows = Direct.normalize(posts, NOW); return [rows[0], Direct.conversationContext(rows[1], { targetId: rows[1].id, rows: posts }, NOW)]; };

test('observed mixed Day18 announcement supplies verified reset subject to its deadline reply', () => {
  const [parent, reply] = pair();
  assert.equal(RadarSignals.resetAnchor(parent), true);
  assert.equal(reply.replyContext.id, parent.id);
  const assessment = RadarSignals.classify(reply, { now: NOW });
  assert.equal(assessment.actionable, true);
  assert.equal(assessment.confidence, 'high');
  assert.equal(assessment.eventAt, null, 'before is a deadline, not an execution instant');
  assert.equal(News.schedule(reply).deadlineAt, Date.parse('2026-10-23T18:00:00Z'));
  assert.match(News.schedule(reply).text, /10\/24.*3:00.*이전/);
  assert.match(News.schedule(reply).text, /게시일 기준/);
  const by = News.schedule({ ...reply, text: 'Landing tomorrow by 10am PST together with a small ship.' });
  assert.match(by.text, /까지 · 기한/);
  assert.equal(by.deadlineType, 'by');
});

test('a release aside cannot admit a contradictory time, cancellation or unrelated parent', () => {
  const [, reply] = pair();
  for (const suffix of [' together with a small ship at 11am PDT.', ' but not tomorrow.',
    ' after 11am PST.', ' together with a small ship, reset cancelled.'])
    assert.equal(RadarSignals.classify({ ...reply, text: 'Landing tomorrow before 10am PST' + suffix }, { now: NOW }).actionable, false, suffix);
  for (const patch of [{ text: 'Day 18/ A new product ships tomorrow.' }, { relation: 'adjacent-unverified' },
    { text: 'Day 18/ Router firmware shipped. But yes… that’s a reset!' },
    { author: 'someone' }, { createdAt: reply.createdAt }, { targetId: '99' }, { url: 'https://evil.invalid' }, { truncated: true }])
    assert.equal(RadarSignals.classify({ ...reply, replyContext: { ...reply.replyContext, ...patch } }, { now: NOW }).actionable, false, JSON.stringify(patch));
});

test('all selected countries share the same literal-PST deadline and convert it across their own calendar boundary', () => {
  const { context } = makeWorker();
  for (const country of context.RadarI18n.COUNTRIES) {
    context.RadarI18n.setLocale(country.locale);
    const schedule = context.RadarNews.schedule(pair()[1]);
    assert.equal(schedule.deadlineAt, Date.parse('2026-10-23T18:00:00Z'), country.code);
    assert.ok(schedule.text.includes(country.timeLabel), country.code);
    assert.match(schedule.detail, /deadline|마감 기한/);
    assert.equal(schedule.assumedZone, false);
  }
});

test('worker detects the actual reply without waiting for AI and keeps its exact country deadline', async () => {
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false, semanticEnabled: false, quietHoursEnabled: false } }, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: pair(), diagnostics: { posts: 2,
    timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai'].map(author => ({ kind, author, ok: true, stopReason: 'seven-days' }))) } }) };
  await w.context.refreshSignals();
  assert.equal(w.local.signalSnapshot.activeSignals.some(item => item.id === posts[1].id), true);
  const news = w.context.RadarNews.list(w.local.signalSnapshot, w.local.hintSnapshot, w.local.settings).find(entry => entry.item.id === posts[1].id);
  assert.match(news.timing, /10\/24.*3:00.*이전/);
});

test('historical timing retention revalidates canonical identity, parent relation, edits, age and competing deadline semantics', () => {
  const [parent, reply] = pair();
  assert.equal(News.timingReplies([reply], NOW).length, 1);
  for (const patch of [{ url: 'https://evil.invalid/' }, { id: '55' }, { author: 'someone' }, { truncated: true },
    { createdAt: parent.createdAt }, { text: 'Landing tomorrow before 10am PST but not tomorrow.' },
    { replyContext: { ...reply.replyContext, relation: 'adjacent-unverified' } },
    { replyContext: { ...reply.replyContext, targetId: '99' } },
    { replyContext: { ...reply.replyContext, text: 'Lunch tomorrow.' } }])
    assert.equal(News.timingReplies([{ ...reply, ...patch }], NOW).length, 0, JSON.stringify(patch));
  assert.equal(News.timingReplies([reply], NOW + 8 * 86400000).length, 0);
  assert.equal(News.timingReplies([reply, { ...reply, text: 'Reset cancelled.' }], NOW).length, 0, 'newer edits replace saved evidence');
  assert.equal(News.timingReplies([reply, parent], NOW).length, 1);
  assert.equal(News.timingReplies([reply, { ...parent, createdAt: parent.createdAt.replace('.000Z', '+00:00') }], NOW).length, 1);
  assert.equal(News.timingReplies([reply, { ...parent, text: 'Lunch tomorrow.' }], NOW).length, 0, 'a newly read parent edit invalidates an old copied context');
});

test('worker sends the cached visible reset to the permalink-first collection route before new timeline results arrive', async () => {
  const [parent, reply] = pair();
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false, semanticEnabled: false, quietHoursEnabled: false },
    hintSnapshot: { items: [{ ...parent, createdAt: parent.createdAt.replace('.000Z', '+00:00') }] } }, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  let targets;
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async (_signal, options) => {
    targets = options.resetTargets;
    return { items: [parent, reply], diagnostics: { posts: 2, resetFollowUps: [{ id: parent.id, author: parent.author, state: 'verified', verified: 1 }],
      timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai'].map(author => ({kind,author,ok:true,stopReason:'seven-days'}))) } };
  } };
  await w.context.refreshSignals();
  assert.ok(targets.some(item => item.id === parent.id));
  const news = w.context.RadarNews.list(w.local.signalSnapshot, w.local.hintSnapshot, w.local.settings).find(row => row.item.id === parent.id);
  assert.match(news.timing, /10\/24.*3:00.*이전/);
  assert.equal(w.local.signalSnapshot.leadStatus.directScan.resetFollowUps[0].state, 'verified');
});

test('permalink failure details remain visible when public feed results succeed but direct collection fails', async () => {
  const [parent] = pair();
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false, semanticEnabled: false, quietHoursEnabled: false },
    hintSnapshot: { items: [parent] } }, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => {
    throw Object.assign(new Error('X_TIMEOUT'), { diagnostics: { posts: 0, timelines: [],
      resetFollowUps: [{ id: parent.id, author: parent.author, state: 'failed', error: 'timeout' }] } });
  } };
  await w.context.refreshSignals();
  assert.equal(w.local.signalSnapshot.leadStatus.directOk, false);
  assert.equal(w.local.signalSnapshot.leadStatus.directScan.resetFollowUps[0].error, 'timeout');
});

test('verified timing reaches the visible parent while bulk collection is still running and does not swallow the final alert', async () => {
  const [parent, reply] = pair();
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false, semanticEnabled: false, quietHoursEnabled: false },
    hintSnapshot: { items: [{ ...parent, createdAt: parent.createdAt.replace('.000Z', '+00:00') }] } }, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  let checkpointReady, finishScan;
  const checkpoint = new Promise(resolve => { checkpointReady = resolve; });
  const bulkDone = new Promise(resolve => { finishScan = resolve; });
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async (_signal, options) => {
    await options.onCheckpoint({ posts: [], contextCache: {}, timingReplies: [reply] });
    checkpointReady(); await bulkDone;
    return { items: [parent, reply], diagnostics: { posts: 2,
      timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai'].map(author => ({kind,author,ok:true,stopReason:'seven-days'}))) } };
  } };
  const refresh = w.context.refreshSignals();
  await checkpoint;
  const visible = w.context.RadarNews.list(w.local.signalSnapshot, w.local.hintSnapshot, w.local.settings).find(row => row.item.id === parent.id);
  assert.match(visible.timing, /10\/24.*3:00.*이전/);
  assert.ok(!w.local.signalSnapshot.activeSignals?.some(item => item.id === reply.id));
  assert.equal(w.local.notificationHistory?.['signal:' + reply.id], undefined);
  finishScan(); await refresh;
  assert.ok(w.notifications['signal:' + reply.id], 'publishing display evidence early must preserve its later native notification');
});
