const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
const Direct = require('../src/core/direct-x');
const NOW = Date.parse('2026-10-18T12:00:00Z');
const DAY = 86400000;
const row = (id, text, createdAt, author = 'thsottiaux') => ({ id, text, createdAt, author, url: `https://x.com/${author}/status/${id}` });
const RAW_A = row('2111492673890824348', 'Day 13/ Le limit reset', '2026-10-17T16:20:57Z');
const RAW_DONE = row('2111566005684289735', 'Done', '2026-10-17T21:12:21Z');
const KEY = 'report:' + RAW_DONE.id;
const pair = () => Direct.normalize([RAW_A, RAW_DONE], NOW);
const doneIn = rows => Signals.reports(rows, { now: NOW }).find(item => item.id === RAW_DONE.id);
const timelines = () => ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai']
  .map(author => ({ author, kind, ok: true, stopReason: 'seven-days' })));
const settings = { monitorAccount: false, quietHoursEnabled: false, monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false };
function worker(stored, now, rows) {
  const w = makeWorker({ stored, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return now; } };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: rows(), contextCache: {}, diagnostics: { posts: rows().length, timelines: timelines() } }) };
  return w;
}
const run = async w => { await w.events.startup(); await finishPublicResume(w); return w; };
const clone = v => JSON.parse(JSON.stringify(v));
const classifiedAt = local => (JSON.stringify(local).match(/"classifiedAt":\s*("[^"]*"|\d+)/) || [])[1];
async function baseline(extra = {}) {
  const [a, done] = pair();
  const first = await run(worker({ settings: { ...settings, ...extra } }, NOW, () => [done]));
  assert.equal(first.notifications[KEY], undefined, 'no toast without headline');
  assert.ok((first.local.seenSignalIds || []).includes(RAW_DONE.id), 'raw seen stored');
  return { a, done, first };
}
const late = (b, now = NOW + 2 * DAY, patch = {}) =>
  run(worker({ ...clone(b.first.local), hintSnapshot: { items: [b.a] }, ...patch }, now, () => [b.done]));

test('late headline hint 2 days after Done notifies once and persists classification', async () => {
  const b = await baseline();
  const w2 = await late(b);
  assert.ok(w2.notifications[KEY], 'report toast');
  const history = JSON.stringify(w2.local.notificationHistory);
  const stamp = classifiedAt(w2.local);
  assert.ok(stamp, 'classifiedAt stored');
  await run(w2);
  assert.equal(JSON.stringify(w2.local.notificationHistory), history, 'no replay on restart');
  const w3 = await run(worker(clone(w2.local), NOW + 2 * DAY + 60000, () => [b.done]));
  assert.equal(w3.notifications[KEY], undefined, 'no second toast in new worker');
  assert.equal(classifiedAt(w3.local), stamp, 'classifiedAt persists');
});

test('late notification negatives: history replay, disabled setting, >7 days, legacy expiry', async () => {
  const b = await baseline();
  const w2 = await late(b);
  const replay = await run(worker({ ...clone(w2.local), seenSignalIds: [] }, NOW + 3 * DAY, () => [b.done]));
  assert.equal(replay.notifications[KEY], undefined, 'already-notified history must not replay');
  const off = await baseline({ notifyOfficialReset: false });
  assert.equal((await late(off)).notifications[KEY], undefined, 'notifyOfficialReset:false');
  assert.equal((await late(b, NOW + 8 * DAY)).notifications[KEY], undefined, '>7 days excluded');
  const legacy = clone(b.first.local);
  const zero = o => { if (o && typeof o === 'object') for (const k of Object.keys(o)) k === 'expiresAt' ? (o[k] = 0) : zero(o[k]); };
  zero(legacy);
  assert.equal((await late({ ...b, first: { local: legacy } })).notifications[KEY], undefined, 'legacy expiresAt 0 not renewed');
});

test('headline variants linked to Done: only exact Le title yields report for Done id', () => {
  const [a, done] = pair();
  assert.equal(doneIn([a, done])?.id, RAW_DONE.id, 'exact Le title positive');
  for (const text of ['Day 13/ No limit reset', 'Day 13/ Le limit reset cancelled', 'Day 13/ Recap of the limit reset', 'Yesterday we did a limit reset']) {
    assert.equal(doneIn([{ ...a, text }, done]), undefined, text);
  }
});
