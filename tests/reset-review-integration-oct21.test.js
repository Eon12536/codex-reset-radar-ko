const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
global.RadarTime = require('../src/core/time');
global.RadarTranslations = require('../src/core/translations');
global.RadarI18n = require('../src/core/i18n');
const Signals = require('../src/core/signals');
const Direct = require('../src/core/direct-x');
const News = require('../src/core/news');
const NOW = Date.now();
const RAW = { id: '2112500000000000011', author: 'thsottiaux', createdAt: new Date(NOW - 3600000).toISOString(),
  url: 'https://x.com/thsottiaux/status/2112500000000000011', text: 'Fresh reset for everyone. Enjoy!' };
const KEY = 'hint:' + RAW.id;
const row = () => Direct.normalize([RAW], NOW)[0];
const timelines = () => ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai']
  .map(author => ({ author, kind, ok: true, stopReason: 'seven-days' })));
const settings = { monitorAccount: false, quietHoursEnabled: false, monitorStatusSource: false, monitorHistorySource: false,
  monitorCommunitySource: false, monitorSignals: true, monitorLeadSource: true, notifyHints: true };
const clone = v => JSON.parse(JSON.stringify(v));
const toasts = w => w.log.filter(e => e[0] === 'toast' && e[1] === KEY).length;

test('classifyHint marks clause-level reset wording as review, never action/report', () => {
  for (const text of ['Codex limits reset for everyone. New code review feature is live.',
    'Usage limits reset for everyone. No action needed.', 'Limits reset for all accounts. You should see it in the app.',
    "Reset for everyone. Don't forget the new model.", 'We are resetting Codex limits for everyone.',
    'New code ready? Fresh reset for everyone.']) {
    const r = Signals.classifyHint({ ...row(), text }, { now: NOW });
    assert.equal(r.rule, 'reset-review', text);
    assert.equal(r.actionable, false, text);
    assert.equal(Signals.reports([{ ...row(), text }], { now: NOW }).length, 0, text);
  }
  for (const text of ['Day 13 / Limit reset?', 'Codex now auto-resets the terminal session after each task.'])
    assert.notEqual(Signals.classifyHint({ ...row(), text }, { now: NOW })?.rule, 'reset-review', text);
});

test('News.select renders a localized non-explicit review candidate', () => {
  for (const [locale, label] of [['ko-KR', '검토 후보'], ['en-US', 'Review candidate']]) {
    RadarI18n.setLocale(locale);
    const items = Signals.hintCandidates([row()], { now: NOW });
    const out = News.select(null, { items }, settings);
    const item = out;
    assert.ok(item, locale);
    assert.equal(item.label, label);
    assert.equal(item.explicit, false);
    assert.equal(item.caption, RadarI18n.t('newsResetReviewContext'));
    assert.ok(!String(item.caption).includes('newsResetReviewContext'), 'caption is not a raw key');
    assert.equal(item.publishedAt, Date.parse(RAW.createdAt));
  }
});

function worker(stored, now) {
  const w = makeWorker({ stored, fetcher: async () => json({ items: [] }) });
  w.log = [];
  w.context.Date = class extends Date { static now() { return now; } };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => {
    w.log.push(['read']);
    return { items: [row()], contextCache: {}, diagnostics: { posts: 1, timelines: timelines() } };
  } };
  const create = w.context.chrome.notifications.create;
  w.context.chrome.notifications.create = async (id, o) => { w.log.push(['toast', id]); return create(id, o); };
  return w;
}
const run = async w => { await w.events.startup(); await finishPublicResume(w); return w; };

test('startup reads direct-X, then one review toast; no repeats in same/new worker', async () => {
  const w = await run(worker({ settings }, NOW));
  const n = w.notifications[KEY];
  assert.ok(n, 'review toast created');
  const read = w.log.findIndex(e => e[0] === 'read');
  assert.ok(read >= 0 && read < w.log.findIndex(e => e[1] === KEY), 'read precedes toast');
  assert.match(n.title, /검토|미확인|review|unconfirmed/i);
  assert.ok(!JSON.stringify(n).includes('$1'), 'no placeholder leak');
  assert.ok(!/resetReviewNotificationTitle/.test(n.title), 'no raw key');
  await run(w); await run(w);
  assert.equal(toasts(w), 1);
  const w2 = await run(worker(clone(w.local), NOW + 60000));
  await run(w2);
  assert.ok(w2.log.some(e => e[0] === 'read'), 'restart re-reads');
  assert.equal(toasts(w2), 0, 'no toast after restart');
});

test('notifyHints:false and monitorSignals:false prevent the review toast', async () => {
  for (const extra of [{ notifyHints: false }, { monitorSignals: false }]) {
    const w = await run(worker({ settings: { ...settings, ...extra } }, NOW));
    assert.equal(toasts(w), 0, JSON.stringify(extra));
    assert.equal(w.notifications[KEY], undefined);
  }
});
