const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
const Direct = require('../src/core/direct-x');
const NOW = Date.parse('2026-10-20T16:00:00Z');
const DAY = 86400000;
const RAW = { id: '2112432076767289678', author: 'thsottiaux', createdAt: '2026-10-20T06:33:48Z',
  url: 'https://x.com/thsottiaux/status/2112432076767289678', text: "Day 15/ Nevermind, we're still cooking... and reset. Enjoy." };
const KEY = 'report:' + RAW.id;
const post = () => Direct.normalize([RAW], NOW)[0];
const timelines = () => ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai']
  .map(author => ({ author, kind, ok: true, stopReason: 'seven-days' })));
const settings = { monitorAccount: false, quietHoursEnabled: false, monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false };
const clone = v => JSON.parse(JSON.stringify(v));
const toasts = w => w.log.filter(e => e[0] === 'toast' && e[1] === KEY).length;
function worker(stored, now, { legacy = false } = {}) {
  const w = makeWorker({ stored, fetcher: async () => json({ items: [] }) });
  w.log = [];
  w.context.Date = class extends Date { static now() { return now; } };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => {
    w.log.push(['read']);
    return { items: [post()], contextCache: {}, diagnostics: { posts: 1, timelines: timelines() } };
  } };
  if (legacy) w.context.RadarSignals = { ...w.context.RadarSignals, reports: () => [] };
  const create = w.context.chrome.notifications.create;
  w.context.chrome.notifications.create = async (id, o) => { w.log.push(['toast', id]); return create(id, o); };
  return w;
}
const run = async w => { await w.events.startup(); await finishPublicResume(w); return w; };

test('Signals.reports classifies the Day 15 post as completed-reset day-series without link/eventAt', () => {
  const item = Signals.reports([post()], { now: NOW }).find(r => r.id === RAW.id);
  assert.ok(item, 'report produced');
  const s = JSON.stringify(item);
  for (const word of ['completed-reset', 'medium', 'day-series']) assert.ok(s.includes(word), word);
  assert.equal(item.completionLink, undefined);
  assert.equal(item.eventAt, undefined);
  assert.equal(Signals.reports([{ ...post(), text: 'Day 15/ still cooking, no reset yet' }], { now: NOW })
    .some(r => r.id === RAW.id && JSON.stringify(r).includes('completed-reset')), false, 'no reset wording');
});

test('startup reads fresh direct-X before the single report toast; restarts/rescans do not repeat', async () => {
  const w = await run(worker({ settings }, NOW));
  assert.ok(w.notifications[KEY], 'report toast');
  const firstRead = w.log.findIndex(e => e[0] === 'read');
  const firstToast = w.log.findIndex(e => e[0] === 'toast' && e[1] === KEY);
  assert.ok(firstRead >= 0 && firstRead < firstToast, 'direct-X read precedes toast');
  assert.equal(toasts(w), 1);
  await run(w); await run(w);
  assert.equal(toasts(w), 1, 'repeated scans in same worker');
  const w2 = await run(worker(clone(w.local), NOW + 60000));
  await run(w2);
  assert.ok(w2.log.some(e => e[0] === 'read'), 'restart re-reads direct-X');
  assert.equal(toasts(w2), 0, 'no toast after worker restart');
});

async function legacyBaseline(extra = {}) {
  const first = await run(worker({ settings: { ...settings, ...extra } }, NOW, { legacy: true }));
  assert.equal(toasts(first), 0, 'v92 raw-only: no toast');
  assert.ok((first.local.seenSignalIds || []).includes(RAW.id), 'raw observation stored');
  return first;
}
const late = (first, now) => run(worker(clone(first.local), now));

test('v92 raw-only observation is reclassified >24h later and alerts exactly once', async () => {
  const first = await legacyBaseline();
  const w2 = await late(first, NOW + 2 * DAY);
  assert.equal(toasts(w2), 1, 'first alert within 7 days');
  await run(w2);
  const w3 = await late(w2, NOW + 2 * DAY + 60000);
  assert.equal(toasts(w2) + toasts(w3), 1, 'no repeated grant');
});

test('negatives: notifyOfficialReset disabled, and >7 days stale', async () => {
  const off = await legacyBaseline({ notifyOfficialReset: false });
  assert.equal(toasts(await late(off, NOW + 2 * DAY)), 0, 'disabled');
  const offFresh = await run(worker({ settings: { ...settings, notifyOfficialReset: false } }, NOW));
  assert.equal(toasts(offFresh), 0, 'disabled fresh');
  const stale = await legacyBaseline();
  const w = await late(stale, NOW + 8 * DAY);
  assert.equal(toasts(w), 0, '>7 days stale');
  assert.equal(w.notifications[KEY], undefined);
});
