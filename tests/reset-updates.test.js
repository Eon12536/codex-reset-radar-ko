const test = require('node:test');
const assert = require('node:assert/strict');
global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
const Direct = require('../src/core/direct-x');
const News = require('../src/core/news');
const Settings = require('../src/core/settings');
const { makeWorker, json } = require('./helpers/worker');
const fixture = require('./fixtures/tibo-reset-remediation-2026-10-03.json');
const now = Date.parse(fixture.observedAt);
const [investigation, resolution] = fixture.posts;
const normalized = (post, extra = {}) => Direct.normalize([{ ...post, ...extra }], now)[0];
const quoted = () => Direct.linkQuotedContexts([
  normalized(investigation), normalized(resolution, { quotedPost: investigation })
]);

test('real missed Pro 500 reset investigation is an official follow-up, never a new reset promise', () => {
  const item = normalized(investigation);
  const report = Signals.reports([item], { now })[0];
  assert.equal(report.assessment.report, 'reset-update');
  assert.equal(report.assessment.updateStatus, 'investigating');
  assert.equal(report.assessment.eventAt, null);
  assert.equal(Signals.classify(item, { now }).actionable, false);
  assert.equal(Signals.classifyHint(item, { now }).candidate, false);
  assert.match(report.assessment.reason, /추가 리셋 여부·시각 미확정/);
});

test('resolution needs an exact independently collected quoted reset post, retained on cache reclassification', () => {
  assert.equal(Signals.reports([normalized(resolution)], { now }).length, 0);
  const items = quoted();
  assert.equal(items[1].replyContext.relation, 'quoted-post');
  const reports = Signals.reports(items, { now });
  assert.equal(reports[0].assessment.updateStatus, 'resolved');
  assert.equal(Signals.reports(reports, { now })[0].assessment.updateStatus, 'resolved');
  assert.equal(Signals.classify(items[1], { now }).actionable, false);
});

test('quote matching rejects changed text/time, incomplete quotes, ambiguous identity and mere adjacency', () => {
  const parent = normalized(investigation);
  for (const changes of [{ text: 'Different reset issue' }, { createdAt: resolution.createdAt },
    { truncated: true }, { author: 'someone' }]) {
    const item = normalized(resolution, { quotedPost: { ...investigation, ...changes } });
    const [result] = Direct.linkQuotedContexts([item, parent]);
    assert.equal(Signals.reports([result], { now }).length, 0);
  }
  const items = Direct.linkQuotedContexts([normalized(resolution, { quotedPost: investigation }),
    parent, { ...parent, id: '123', url: 'https://x.com/thsottiaux/status/123' }]);
  assert.equal(items[0].replyContext, undefined);
  assert.equal(Signals.reports([normalized(resolution, { replyContext: { ...parent, relation: 'adjacent-unverified' } })], { now }).length, 0);
});

test('follow-up rules exclude requests, unrelated fixes, denials, questions and stale or untrusted posts', () => {
  for (const text of ['Pro 500 did not get the reset. Please make up for it.',
    'Pro 500 did not get the reset. We are not investigating and will not make up for it.',
    'Maybe Pro 500 did not get the reset. Investigating.',
    'Pro 500 did not get the reset. Are we investigating?',
    'Password reset failed. Investigating.', 'All fixed. The Pro 500 billing issue is resolved.'])
    assert.equal(Signals.reports([normalized(investigation, { text })], { now }).length, 0, text);
  for (const item of [{ ...normalized(investigation), author: 'someone' },
    { ...normalized(investigation), source: { id: 'github-community' } }])
    assert.equal(Signals.reports([item], { now }).length, 0);
  assert.equal(Signals.reports([normalized(investigation)], { now: now + 8 * 86400000 }).length, 0);
});

function worker({ notifyOfficialReset = true, old = false } = {}) {
  const at = Date.now() - (old ? 2 * 86400000 : 3600000);
  const item = { ...investigation, createdAt: new Date(at).toISOString(), source: { id: 'codex-lead', weight: 1 } };
  const w = makeWorker({ stored: { accountSnapshot: { usage: { windows: [{ kind: 'weekly', remainingPercent: 80 }] } },
    settings: { monitorAccount: true, monitorLeadSource: true, monitorStatusSource: false, monitorHistorySource: false,
      monitorCommunitySource: false, notifyHints: false, notifyOfficialReset, quietHoursEnabled: false } },
    fetcher: async () => json({ items: [{ external_id: item.id, content: item.text, published_at: item.createdAt,
      metadata: { author_user_name: item.author }, url: item.url }] }) });
  const badges = [];
  w.context.chrome.action.setBadgeText = async ({ text }) => badges.push(text);
  return { ...w, item, badges };
}

test('official follow-up uses Windows notification path with hints off, marks badge and shows honest popup label once', async () => {
  const w = worker();
  await w.context.refreshSignals();
  const notification = w.notifications['report:' + w.item.id];
  assert.match(notification.title, /리셋 후속 안내/);
  assert.doesNotMatch(notification.title, /완료|지급/);
  assert.equal(w.badges.at(-1), '80%!');
  const news = News.select(w.local.signalSnapshot, w.local.hintSnapshot, Settings.sanitize());
  assert.equal(news.label, '리셋 후속');
  assert.equal(news.kindLabel, '리셋 반영 조사·보완');
  assert.match(news.timing, /후속 안내.*게시/);
  assert.equal(w.local.signalSnapshot.signal, null);
  assert.equal(w.local.recoveryState, undefined);
  assert.equal(w.local.creditGrantState, undefined);
  assert.equal(w.local.chatCounters, undefined);
  await w.events.notificationClick('report:' + w.item.id);
  assert.equal(w.tabs.at(-1).url, w.item.url);
  const history = JSON.stringify(w.local.notificationHistory);
  await w.context.refreshSignals();
  assert.equal(JSON.stringify(w.local.notificationHistory), history);
});

test('disabled official notices and old newly collected posts do not create follow-up toasts', async () => {
  for (const options of [{ notifyOfficialReset: false }, { old: true }]) {
    const w = worker(options);
    await w.context.refreshSignals();
    assert.equal(w.local.signalSnapshot.reports.length, 1);
    assert.equal(Object.keys(w.notifications).length, 0);
  }
});
