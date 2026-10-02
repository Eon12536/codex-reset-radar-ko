const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
const Direct = require('../src/core/direct-x');
const News = require('../src/core/news');
const Settings = require('../src/core/settings');
const { makeWorker, json } = require('./helpers/worker');
const fixture = require('./fixtures/tibo-banked-reset.json');
const now = Date.parse(fixture.observedAt);
const post = (text, extra = {}) => ({ ...fixture.post, text, source: { id: 'codex-lead', weight: 1 }, ...extra });

test('live long announcement is shown as a credit grant, not an automatic quota reset', () => {
  const [item] = Direct.normalize([fixture.post], now);
  const [report] = Signals.reports([item], { now });
  assert.equal(report.assessment.report, 'credit-grant');
  assert.equal(report.assessment.actionable, false);
  assert.equal(report.assessment.eventAt, null);
  assert.equal(Signals.classify(item, { now }).actionable, false);
  assert.equal(Signals.classifyHint(item, { now }).candidate, false);
  for (const file of ['../src/core/signals', '../src/core/direct-x', '../src/x-reader', '../src/background'])
    assert.ok(!fs.readFileSync(require.resolve(file), 'utf8').includes(item.id));
});

test('completed announcements and credit grants are distinct and expire after seven days', () => {
  for (const text of ['We have now reset all Codex usage limits.', 'All usage limits have been reset.', 'Your limits were reset.', 'Reset done.'])
    assert.equal(Signals.reports([post(text)], { now })[0]?.assessment.report, 'completed-reset', text);
  const credit = post('We added a banked reset to all accounts.');
  assert.equal(Signals.reports([credit], { now })[0].assessment.report, 'credit-grant');
  assert.equal(Signals.reports([credit], { now: now + 8 * 86400000 }).length, 0);
  assert.equal(Signals.reports([{ ...credit, createdAt: new Date(now + 3600000).toISOString() }], { now }).length, 0);
});

test('negation, hypothetical, unrelated, impersonated and stale cached reports are rejected', () => {
  for (const text of ['We have not reset the limits.', 'Maybe we reset all limits.', 'Have we reset all limits?',
    'We reset all passwords.', 'I reset my sleep schedule.', 'We will reset Codex tomorrow.',
    'We never gave a banked reset.', 'We gave a banked reset last year.', 'We have now reset the database.'])
    assert.equal(Signals.reports([post(text)], { now }).length, 0, text);
  for (const extra of [{ author: 'someone' }, { source: { id: 'github-community' } }])
    assert.equal(Signals.reports([post('We have now reset all limits.', extra)], { now }).length, 0);
  assert.equal(Signals.reports([post('We have now reset all limits.'), post('Unrelated correction.')], { now }).length, 0);
});

function worker(settings = {}) {
  const item = post(fixture.post.text, { createdAt: new Date(Date.now() - 3600000).toISOString() });
  const state = { items: [item] };
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorStatusSource: false, monitorHistorySource: false,
    monitorCommunitySource: false, quietHoursEnabled: false, notifyHints: false, ...settings } },
    fetcher: async () => json({ items: state.items.map(p => ({ external_id: p.id, content: p.text, published_at: p.createdAt,
      metadata: { author_user_name: p.author }, url: p.url })) }) });
  return { w, state, item };
}

test('report reaches popup and Windows notification path once, without account/counter side effects', async () => {
  const { w, item } = worker();
  await w.context.refreshSignals();
  const news = News.select(w.local.signalSnapshot, w.local.hintSnapshot, Settings.sanitize());
  assert.equal(news.label, 'Banked');
  assert.equal(news.kind, 'banked');
  assert.equal(news.kindLabel, 'Banked reset · 리셋권');
  assert.match(news.timing, /지급 안내 · 한국 .* 게시/);
  assert.match(w.notifications['report:' + item.id].title, /Banked reset 지급 공지/);
  assert.equal(w.local.signalSnapshot.signal, null);
  assert.equal(w.local.recoveryState, undefined);
  assert.equal(w.local.chatCounters, undefined);
  await w.events.notificationClick('report:' + item.id);
  assert.equal(w.tabs.at(-1).url, item.url);
  const history = JSON.stringify(w.local.notificationHistory);
  await w.context.refreshSignals();
  assert.equal(JSON.stringify(w.local.notificationHistory), history);
});

test('public notice preferences govern notifications while keeping enabled-monitor reports visible', async () => {
  const { w } = worker({ notifyOfficialReset: false });
  await w.context.refreshSignals();
  assert.equal(w.local.signalSnapshot.reports.length, 1);
  assert.equal(Object.keys(w.notifications).length, 0);
});

test('startup catches missed reports, and disabling monitoring clears queued and visible reports', async () => {
  const { w, item } = worker();
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.events.startup();
  assert.ok(w.notifications['report:' + item.id]);
  await w.context.saveSettings({ ...w.local.settings, monitorLeadSource: false });
  assert.equal(w.local.signalSnapshot.reports.length, 0);
  assert.equal(Object.keys(w.notifications).length, 0);
  assert.equal((w.local.pendingNotifications || []).filter(p => p.id.startsWith('report:')).length, 0);
});

test('quiet reports are revalidated before delivery, including edited bodies and unsafe source links', async () => {
  const { w, state, item } = worker({ notifyPublicOnResume: false });
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.refreshSignals();
  assert.equal(w.local.pendingNotifications.length, 1);
  state.items[0] = { ...item, text: 'Corrected: no reset planned.' };
  await w.context.refreshSignals();
  assert.equal(w.local.pendingNotifications.length, 0);
  assert.equal(w.local.signalSnapshot.reports.length, 0);
  state.items[0] = { ...item, url: 'https://evil.invalid/' };
  await w.context.refreshSignals();
  assert.equal((await w.context.openReport(item.id)).ok, false);
});
