const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
const Direct = require('../src/core/direct-x');
global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
const DAY = 86400000;
const NOW = Date.parse('2026-10-18T02:00:00Z');
const raw = [
  { id: '2111492673890824348', author: 'thsottiaux', text: 'Day 13/ Le limit reset', createdAt: '2026-10-17T16:20:57Z' },
  { id: '2111492738025959922', author: 'thsottiaux', text: 'Landing sometime today by EOD PST', createdAt: '2026-10-17T16:21:13Z' }
].map(item => ({ ...item, url: `https://x.com/${item.author}/status/${item.id}` }));
function chain(rows = raw, now = NOW) {
  const [headline, reply] = Direct.normalize(rows, now);
  return [headline, Direct.conversationContext(reply, { targetId: reply.id, rows }, now)];
}

test('observed reset headline stays a hint; its verified timing reply becomes a promise with an EOD deadline', () => {
  const [headline, reply] = chain();
  assert.equal(Signals.classifyHint(headline, { now: NOW }).rule, 'reset-short');
  assert.equal(Signals.classify(headline, { now: NOW }).actionable, false);
  assert.equal(reply.replyContext?.id, headline.id);
  const assessment = Signals.classify(reply, { now: NOW });
  assert.equal(assessment.actionable, true);
  assert.equal(assessment.confidence, 'high');
  assert.equal(assessment.eventAt, null);
  assert.equal(assessment.untimedPromise, true);
  assert.equal(Signals.classifyHint(reply, { now: NOW }).candidate, false);
  assert.equal(Signals.reports([headline, reply], { now: NOW }).length, 0);
  const { context } = makeWorker();
  context.Date = class extends Date { static now() { return NOW; } };
  assert.equal(context.RadarNews.schedule(reply).deadlineAt, Date.parse('2026-10-18T08:00:00Z'));
  const visible = context.RadarNews.list({ activeSignals: [{ ...reply, assessment }] }, { items: [headline] },
    { monitorSignals: true, monitorLeadSource: true });
  assert.equal(visible.find(news => news.item.id === reply.id).label, 'reset');
});

test('the rule handles other day numbers and monitored authors rather than particular IDs', () => {
  for (const author of ['thsottiaux', 'reach_vb', 'OpenAI']) for (const title of [
    'Day 2 / Limit reset', 'Day 28 — Le limit reset!', 'Day 9: Usage limit reset', 'Day 11 / Global reset'
  ]) {
    const rows = raw.map((row, index) => ({ ...row, id: String(index + 101), author,
      url: `https://x.com/${author}/status/${index + 101}`, ...(index ? {} : { text: title }) }));
    const [headline, reply] = chain(rows);
    assert.equal(Signals.classifyHint(headline, { now: NOW }).candidate, true, title);
    assert.equal(Signals.classify(reply, { now: NOW }).actionable, true, author + ': ' + title);
  }
});

test('standalone, adjacent, stale, truncated and forged contexts cannot establish a reset promise', () => {
  const [headline, reply] = chain();
  const { replyContext, ...standalone } = reply;
  assert.equal(Signals.classify(standalone, { now: NOW }).actionable, false);
  for (const patch of [
    { relation: 'adjacent-unverified' }, { relation: 'quoted-post' }, { targetId: '999' },
    { author: 'someone', url: `https://x.com/someone/status/${headline.id}` },
    { author: 'reach_vb', url: `https://x.com/reach_vb/status/${headline.id}` },
    { url: `https://x.com/other/status/${headline.id}` }, { url: 'https://x.com.evil.test/post' },
    { id: reply.id }, { createdAt: reply.createdAt }, { createdAt: '2026-10-01T00:00:00Z' },
    { createdAt: 'invalid' }, { truncated: true }, { text: 'Day 13 / Password reset' },
    { text: 'Day 13 / Database reset' }, { text: 'Day 13 / No limit reset' },
    { text: 'Day 13 / Limit reset?' }, { text: 'Day 13 / Limit reset cancelled' }
  ]) assert.equal(Signals.classify({ ...reply, replyContext: { ...replyContext, ...patch } }, { now: NOW }).actionable, false, JSON.stringify(patch));
  assert.equal(Signals.classify({ ...reply, truncated: true }, { now: NOW }).actionable, false);
  assert.equal(Signals.classify({ ...reply, source: { id: 'github-community' } }, { now: NOW }).actionable, false);
  for (const text of ['Done', 'Maybe landing today by EOD PST', 'Landing today by EOD PST?',
    'Not landing today by EOD PST', 'New model landing today by EOD PST', 'Landing today by EOD PST if we can']) {
    const item = { ...reply, text };
    assert.equal(Signals.classify(item, { now: NOW }).actionable, false, text);
    if (text === 'Done') {
      assert.equal(Signals.reports([item], { now: NOW })[0].assessment.completionLink, 'verified');
      assert.equal(Signals.reports([{ ...item, replyContext: undefined }], { now: NOW }).length, 0);
    }
  }
  const adjacent = Direct.normalize(raw, NOW)[1];
  assert.equal(Signals.classify(adjacent, { now: NOW }).actionable, false);
  const truncated = chain([{ ...raw[0], truncated: true }, raw[1]])[1];
  assert.equal(truncated.replyContext, undefined);
  assert.equal(Signals.classify(truncated, { now: NOW }).actionable, false);
});

function worker(now, rows, stored = {}) {
  const w = makeWorker({ stored: { ...stored, settings: { ...stored.settings, monitorAccount: false,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false,
    quietHoursEnabled: false, notifyHints: false, notifyResetHints: true } }, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return now; } };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: chain(rows, now), diagnostics: {
    posts: rows.length, timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai']
      .map(author => ({ author, kind, ok: true, stopReason: 'seven-days' }))) } }) };
  return w;
}

test('startup queues the recovered promise, deduplicates it, and a restarted worker detects a new chain days later', async () => {
  const first = worker(NOW, raw);
  await first.events.startup();
  assert.ok(first.local.signalSnapshot.activeSignals.some(item => item.id === raw[1].id));
  assert.equal(Object.keys(first.notifications).length, 0);
  await finishPublicResume(first);
  assert.ok(first.notifications['signal:' + raw[1].id]);
  assert.ok(first.notifications['hint:' + raw[0].id]);
  const history = JSON.stringify(first.local.notificationHistory);
  await first.context.refreshSignals();
  assert.equal(JSON.stringify(first.local.notificationHistory), history);
  const later = raw.map((item, index) => ({ ...item, id: String(index + 201),
    url: `https://x.com/${item.author}/status/${index + 201}`,
    createdAt: new Date(Date.parse(item.createdAt) + 3 * DAY).toISOString(),
    text: index ? item.text : 'Day 16 / Limit reset' }));
  const second = worker(NOW + 3 * DAY, later, first.local);
  await second.events.startup();
  await finishPublicResume(second);
  assert.ok(second.notifications['signal:202']);
  assert.ok(second.notifications['hint:201']);
  assert.equal(second.notifications['signal:' + raw[1].id], undefined);
  const laterHistory = JSON.stringify(second.local.notificationHistory);
  await second.events.startup(); await finishPublicResume(second);
  assert.equal(JSON.stringify(second.local.notificationHistory), laterHistory);
});
