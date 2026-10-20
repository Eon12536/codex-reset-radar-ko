const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
const Direct = require('../src/core/direct-x');
const NOW = Date.parse('2026-10-18T12:00:00Z');
const row = (id, text, createdAt, author = 'thsottiaux') => ({ id, text, createdAt, author, url: `https://x.com/${author}/status/${id}` });
const RAW_A = row('2111492673890824348', 'Day 13/ Le limit reset', '2026-10-17T16:20:57Z');
const RAW_DONE = row('2111566005684289735', 'Done', '2026-10-17T21:12:21Z');
const pair = () => Direct.normalize([RAW_A, RAW_DONE], NOW);
const reportsOf = (rows, now = NOW) => Signals.reports(rows, { now });
const doneIn = (rows, now) => reportsOf(rows, now).find(item => item.id === RAW_DONE.id);
const timelines = () => ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai']
  .map(author => ({ author, kind, ok: true, stopReason: 'seven-days' })));
const settings = { monitorAccount: false, quietHoursEnabled: false, monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false };
function worker(stored, now, rows) {
  const w = makeWorker({ stored, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return now; } };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: rows(), contextCache: {}, diagnostics: { posts: rows().length, timelines: timelines() } }) };
  return w;
}

test('headline-only reset promise plus standalone Done becomes inferred medium completion', () => {
  const [a, done] = pair();
  const report = doneIn([a, done]);
  assert.ok(report);
  assert.deepEqual([report.assessment.report, report.assessment.completionLink, report.assessment.confidence], ['completed-reset', 'inferred', 'medium']);
  assert.equal(report.replyContext.id, RAW_A.id);
  assert.equal(doneIn([report])?.id, RAW_DONE.id, 'report retained on its own');
  assert.equal(doneIn([done]), undefined);
});

test('context-only cached headline yields the completion only, not a duplicate headline report', () => {
  const [a, done] = pair();
  const list = Signals.reports([done], { now: NOW, context: [a] });
  assert.deepEqual(list.map(item => item.id), [RAW_DONE.id]);
  assert.equal(list[0].assessment.completionLink, 'inferred');
  const edited = { ...a, text: 'A product is coming tomorrow.' };
  const fresh = Signals.reports([edited, done], { now: NOW, context: [a] });
  assert.equal(fresh.find(item => item.id === RAW_DONE.id), undefined, 'fresh edited A overrides stale cached A');
});

test('headline-based inference rejects unsafe variants', () => {
  const [a, done] = pair();
  const later = NOW + 3 * 86400000;
  for (const [patch, now] of [
    [{ author: 'reach_vb', url: `https://x.com/reach_vb/status/${done.id}` }, NOW],
    [{ truncated: true }, NOW], [{ text: 'Done?' }, NOW], [{ text: 'Not done' }, NOW],
    [{ source: { id: 'github-community' } }, NOW],
    [{ createdAt: '2026-10-19T21:12:21Z' }, later]
  ]) assert.equal(doneIn([a, { ...done, ...patch }], now), undefined, JSON.stringify(patch));
  assert.equal(doneIn([done]), undefined, 'no parent');
  const ind = { ...done, id: '700', text: 'Shipping a new dashboard today', url: 'https://x.com/thsottiaux/status/700', createdAt: '2026-10-17T18:00:00Z' };
  const other = { ...done, id: '701', text: 'Day 14/ Limit reset', url: 'https://x.com/thsottiaux/status/701', createdAt: '2026-10-17T19:00:00Z' };
  assert.equal(doneIn([a, other, done]), undefined, 'ambiguous competing reset headlines');
  for (const text of ['The reset was cancelled.', 'No reset today.', 'GPT-6 will launch tonight.']) {
    const mid = { ...ind, text };
    assert.equal(doneIn([a, mid, done]), undefined, text);
  }
});

test('edited headline supersedes cached old headline', () => {
  const [a, done] = pair();
  const report = doneIn([a, done]);
  const edited = { ...a, text: 'A product is coming tomorrow.' };
  assert.equal(doneIn([report, edited]), undefined);
  assert.equal(doneIn([edited, done]), undefined);
});

test('already-seen but unclassified Done is classified once a headline hint appears', async () => {
  const [a, done] = pair();
  const key = 'report:' + RAW_DONE.id;
  const first = worker({ settings }, NOW, () => [done]);
  await first.events.startup(); await finishPublicResume(first);
  assert.equal(first.notifications[key], undefined);
  assert.ok((first.local.seenSignalIds || []).includes(RAW_DONE.id));
  assert.ok(JSON.stringify(first.local).includes(RAW_DONE.url), 'raw public receipt retained');
  const next = worker({ ...first.local, hintSnapshot: { items: [a] } }, NOW + 60000, () => [done]);
  await next.events.startup(); await finishPublicResume(next);
  assert.ok(next.notifications[key]);
  const history = JSON.stringify(next.local.notificationHistory);
  await next.events.startup(); await finishPublicResume(next);
  assert.equal(JSON.stringify(next.local.notificationHistory), history);
});

test('worker with stored headline hint and direct Done notifies once across restarts', async () => {
  const [a, done] = pair();
  const key = 'report:' + RAW_DONE.id;
  const w = worker({ settings, hintSnapshot: { items: [a] } }, NOW, () => [done]);
  await w.events.startup(); await finishPublicResume(w);
  assert.ok(w.notifications[key]);
  assert.match(w.notifications[key].title, /추정/);
  const history = JSON.stringify(w.local.notificationHistory);
  await w.events.startup(); await finishPublicResume(w);
  assert.equal(JSON.stringify(w.local.notificationHistory), history);
  const next = worker(w.local, NOW + 120000, () => [done]);
  await next.events.startup(); await finishPublicResume(next);
  assert.equal(next.notifications[key], undefined);
  assert.ok(next.local.signalSnapshot.reports.some(item => item.id === RAW_DONE.id));
});
