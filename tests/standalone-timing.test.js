const test = require('node:test');
const assert = require('node:assert/strict');
global.RadarTime = require('../src/core/time');
global.RadarSignals = require('../src/core/signals');
global.RadarNews = require('../src/core/news');
const Direct = require('../src/core/direct-x');
const Scope = require('../src/core/reset-scope');
const NOW = Date.parse('2026-10-25T13:00Z');
// News presentation applies a seven-day age limit using Date.now(). Freeze
// the fixture clock so this historical regression remains meaningful later.
test.mock.timers.enable({ apis: ['Date'], now: NOW });
const raw = () => Direct.normalize(require('./fixtures/tibo-day18-oct23.json').posts, NOW);
const archived = rows => RadarNews.timingReplies(rows, NOW);

test('the observed standalone Day18 clock follows the unique reset announcement without claiming a verified reply', () => {
  const [parent, child] = raw();
  const saved = archived([parent, child]);
  assert.equal(saved.length, 1);
  const inferred = saved[0];
  assert.equal(inferred.replyContext.id, parent.id);
  assert.equal(inferred.replyContext.relation, 'previous-reset-announcement');
  assert.equal(inferred.assessment.confidence, 'medium');
  assert.equal(inferred.assessment.actionable, false);
  assert.equal(RadarSignals.classify(inferred, { now: NOW }).actionable, false);
  assert.equal(Scope.allows(inferred, { resetOnly: true }), true);
  assert.equal(RadarNews.schedule(inferred).deadlineAt, Date.parse('2026-10-23T18:00Z'));
  assert.match(RadarNews.schedule(inferred).text, /10\/24.*3:00.*이전.*후속 글 기준/);
  assert.equal(archived(saved).length, 1, 'bounded saved evidence survives a worker restart');
});

test('inferred timing reaches the original reset banner and keeps both original links', () => {
  const [parent, child] = raw();
  const timingReplies = archived([parent, child]);
  const rows = RadarNews.list({ timingReplies }, { items: [parent] }, { monitorSignals: true, monitorLeadSource: true, resetOnly: true });
  assert.equal(rows.length, 2);
  const banner = rows.find(row => row.item.id === parent.id);
  assert.equal(banner.timingSchedule.deadlineAt, Date.parse('2026-10-23T18:00Z'));
  assert.equal(banner.timingSchedule.association, 'inferred');
  assert.match(banner.timing, /후속 글 기준/);
  assert.match(banner.timingDetail, /직접 답글 관계는 미확인/);
  assert.equal(new Set(rows.map(row => row.item.url)).size, 2);
});

test('Day17 and Day18 announcements and validated deadline promises count as forecasts', () => {
  const Daily = require('../src/core/daily-news');
  for (const fixture of ['tibo-day17-oct22.json', 'tibo-day18-oct23.json']) {
    const [parent, child] = Direct.normalize(require('./fixtures/' + fixture).posts.map(({ replyContext, ...post }) => post), NOW);
    const timingReplies = archived([parent, child]);
    const assessment = RadarSignals.classify(parent, { now: NOW });
    const activeSignals = assessment.actionable ? [{ ...parent, assessment }] : [];
    const rows = RadarNews.list({ activeSignals, timingReplies }, { items: [parent] }, { monitorSignals: true, monitorLeadSource: true, resetOnly: true });
    assert.equal(rows.length, 2, fixture);
    assert.deepEqual(Daily.resetCounts(rows), { forecast: 2, completed: 0, inferred: 0, grant: 0 }, fixture);
    for (const row of rows) assert.equal(Daily.status(row), '리셋 예고', fixture);
    assert.equal(timingReplies[0].assessment.actionable, false, 'presentation must not manufacture a high-confidence signal');
    assert.match(rows.find(row => row.item.id === parent.id).timing, /후속 글 기준/);
    assert.equal(Daily.summary(rows).counts.forecast, 2, 'native summary uses the same category');
    assert.equal(Daily.summary(rows).counts.inferred, 0);
  }
});

test('the worker persists a standalone deadline for the daily banner without promoting it to a confirmed reset signal', async () => {
  const { makeWorker, json } = require('./helpers/worker');
  const [parent, child] = raw();
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false, semanticEnabled: false, quietHoursEnabled: false } }, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async (_signal, options) => {
    await options.onCheckpoint({ posts: [parent, child], contextCache: {}, timingReplies: archived([parent, child]) });
    return { items: [parent, child], diagnostics: { posts: 2,
      timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai'].map(author => ({ kind, author, ok: true, stopReason: 'seven-days' }))) } };
  } };
  await w.context.refreshSignals();
  assert.ok(w.local.signalSnapshot.timingReplies.some(item => item.id === child.id && item.assessment.timingLink === 'inferred'));
  assert.ok(!w.local.signalSnapshot.activeSignals.some(item => item.id === child.id));
  const rows = w.context.RadarNews.list(w.local.signalSnapshot, w.local.hintSnapshot, w.local.settings);
  assert.match(rows.find(row => row.item.id === parent.id).timing, /10\/24.*3:00.*이전.*후속 글 기준/);
  await w.context.revalidateCachedSignals(0);
  const restored = w.context.RadarNews.list(w.local.signalSnapshot, w.local.hintSnapshot, w.local.settings);
  assert.match(restored.find(row => row.item.id === parent.id).timing, /후속 글 기준/);
});

test('both observed Day17 and Day18 sequences retain their own deadlines rather than borrowing the next day', () => {
  const day17 = require('./fixtures/tibo-day17-oct22.json').posts.map(({ replyContext, ...post }) => post);
  const posts = Direct.normalize([...day17, ...require('./fixtures/tibo-day18-oct23.json').posts], NOW);
  const replies = archived(posts);
  assert.equal(replies.length, 2);
  for (const reply of replies) assert.ok(Date.parse(reply.createdAt) - Date.parse(reply.replyContext.createdAt) <= 15 * 60000);
  assert.equal(replies.find(post => post.id === '2113492502355562875').replyContext.id, '2113492187770175603');
  assert.equal(replies.find(post => post.id === '2113162413008884099').replyContext.id, '2113162277688070445');
});

test('unrelated, edited, delayed, contradictory, ambiguous and explicitly different reply targets never infer a schedule', () => {
  const [parent, child] = raw();
  const second = { ...parent, id: '999', url: 'https://x.com/thsottiaux/status/999',
    createdAt: new Date(Date.parse(parent.createdAt) + 10000).toISOString() };
  const cases = [
    [{ ...parent, text: 'Day 18/ A new product ships.' }, child],
    [parent, { ...child, author: 'reach_vb', url: `https://x.com/reach_vb/status/${child.id}` }],
    [parent, { ...child, createdAt: new Date(Date.parse(parent.createdAt) + 15 * 60000 + 1).toISOString() }],
    [parent, { ...child, inReplyToId: '1234' }],
    [parent, { ...child, truncated: true }],
    [{ ...parent, truncated: true }, child],
    [parent, { ...child, url: 'https://x.com.evil.test/' }],
    [parent, second, child],
    [parent, { ...second, text: 'Lunch tomorrow at 11am PST.' }, child],
    [parent, { ...child, text: 'Landing tomorrow before 10am PST?' }],
    [parent, { ...child, text: 'Landing tomorrow before 10am PST but reset cancelled.' }],
    [parent, { ...child, text: 'Landing tomorrow before 10am PST and 11am PDT.' }],
    [parent, { ...child, text: 'Landing tomorrow before 10am PST. A product release.' }],
  ];
  for (const rows of cases) assert.equal(archived(rows).length, 0, JSON.stringify(rows));
  const explicit = archived([parent, { ...child, replyContext: { ...second, relation: 'conversation-before', targetId: child.id } }]);
  assert.equal(explicit[0].replyContext.id, second.id, 'a real different parent must never be overwritten by an inferred root');
  assert.equal(explicit[0].replyContext.relation, 'conversation-before');
  const saved = archived([parent, child]);
  assert.equal(archived([...saved, { ...parent, text: 'Lunch tomorrow.' }]).length, 0);
  assert.equal(RadarNews.timingReplies(saved, NOW + 8 * 86400000).length, 0);
});
