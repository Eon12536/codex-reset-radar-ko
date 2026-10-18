const test = require('node:test');
const assert = require('node:assert/strict');

global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
const Direct = require('../src/core/direct-x');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
const NOW = Date.parse('2026-10-14T01:00:00.000Z');
// Public text observed in Chrome. These IDs are fixture identities, not rules.
const parent = { id: '2109812360596865224', author: 'thsottiaux',
  text: 'Global reset landing by EOD PST time. Enjoy',
  createdAt: '2026-10-13T01:03:59.000Z',
  url: 'https://x.com/thsottiaux/status/2109812360596865224' };
const confirmation = { id: '2109873287853707513', author: 'thsottiaux',
  text: "What would you like with your side of reset? It's done.",
  createdAt: '2026-10-13T05:06:06.000Z',
  url: 'https://x.com/thsottiaux/status/2109873287853707513',
  quotedPost: { ...parent, truncated: false } };
const posts = () => Direct.linkQuotedContexts(Direct.normalize([parent, confirmation], NOW));

test('a reset question followed by an explicit completion retains its verified quoted promise', () => {
  const [, item] = posts();
  assert.equal(item.replyContext.relation, 'quoted-post');
  const report = Signals.reports([item], { now: NOW })[0];
  assert.ok(report);
  assert.equal(report.assessment.report, 'completed-reset');
  assert.equal(report.assessment.eventAt, null);
  assert.equal(report.assessment.actionable, false);
  assert.deepEqual(report.replyContext, item.replyContext);
  assert.equal(Signals.classify(item, { now: NOW }).actionable, false);
  assert.equal(Signals.classifyHint(item, { now: NOW }).candidate, false);
  assert.equal(Signals.resetKind(report), 'unknown');
});

test('short completions require the same author and an exact recent quote relationship', () => {
  const [, item] = posts();
  for (const patch of [
    { relation: 'adjacent-unverified' }, { relation: 'conversation-before' },
    { targetId: parent.id }, { id: 'not-an-id' }, { author: 'reach_vb' }, { truncated: true },
    { url: 'https://x.com/thsottiaux/status/999' },
    { createdAt: '2026-10-14T00:00:00.000Z' },
    { createdAt: '2026-09-01T01:03:59.000Z' },
    { text: 'The product is landing by EOD.' },
    { text: 'Global password reset landing by EOD.' },
    { text: 'Maybe global reset landing by EOD.' },
    { text: 'Global reset was completed yesterday.' },
    { text: 'Banked reset credits landing by EOD.' }
  ]) assert.equal(Signals.reports([{ ...item, replyContext: { ...item.replyContext, ...patch } }], { now: NOW }).length, 0, JSON.stringify(patch));
  for (const patch of [{ replyContext: null }, { author: 'someone' }, { truncated: true }, { source: { id: 'github-community' } }])
    assert.equal(Signals.reports([{ ...item, ...patch }], { now: NOW }).length, 0, JSON.stringify(patch));
});

test('verified completion wording works for each monitored author without relying on fixture IDs', () => {
  for (const author of ['thsottiaux', 'reach_vb', 'OpenAI']) for (const text of [
    "Reset? It's done.", 'Reset. It is now complete.', 'Reset. The reset has been finished.'
  ]) {
    const rows = [
      { ...parent, id: '500', author, text: 'Codex limits will reset tomorrow.', url: `https://x.com/${author}/status/500` },
      { ...confirmation, id: '501', author, text, url: `https://x.com/${author}/status/501`,
        quotedPost: { ...parent, author, text: 'Codex limits will reset tomorrow.' } }
    ];
    const linked = Direct.linkQuotedContexts(Direct.normalize(rows, NOW));
    const report = Signals.reports([linked[1]], { now: NOW })[0];
    assert.equal(report?.assessment.report, 'completed-reset', author + ': ' + text);
    assert.equal(report.assessment.eventAt, null);
  }
});

test('questions alone, unrelated, speculative, negated and historical completions stay outside reset reports', () => {
  const [, item] = posts();
  for (const text of [
    "What would you like with your side of reset?", "It's done.",
    "What would you like with your side of reset? Is it done?",
    "What would you like with your side of reset? It's not done.",
    "No reset. It's done.", "Password reset? It's done.",
    "The product release has a reset option. It's done.",
    "Banked reset credits? It's done.",
    "Reset? Maybe it's done.", "Reset? It's done if we can.",
    "Reset? I heard it's done.", "Reset? They said it's done.",
    "Reset? Yesterday it was done.", "Last year: reset. It's done.",
    "Reset? It's done. But the reset was cancelled."
  ]) assert.equal(Signals.reports([{ ...item, text }], { now: NOW }).length, 0, text);
});

test('startup keeps the completion above older banked reports and sends its Windows notification once', async () => {
  const old = { id: '200', author: 'thsottiaux', text: 'Banked resets have been granted to everyone.',
    createdAt: '2026-10-08T03:00:00.000Z', url: 'https://x.com/thsottiaux/status/200',
    source: { id: 'codex-lead', weight: 1 } };
  const w = makeWorker({ stored: { settings: { monitorAccount: false, quietHoursEnabled: false,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false },
    signalSnapshot: { reports: [old], activeSignals: [], checkedAt: NOW - 86400000 } },
    fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: posts(), diagnostics: {
    posts: 2, timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai']
      .map(author => ({ author, kind, ok: true, stopReason: 'seven-days' }))) } }) };
  await w.events.startup();
  const news = w.context.RadarNews.list(w.local.signalSnapshot, w.local.hintSnapshot,
    w.context.RadarSettings.sanitize(w.local.settings));
  assert.equal(news[0].item.id, confirmation.id);
  assert.equal(news[0].label, 'reset 완료');
  assert.ok(news.some(item => item.item.id === old.id));
  await finishPublicResume(w);
  assert.ok(w.notifications['report:' + confirmation.id]);
  assert.match(w.notifications['report:' + confirmation.id].message, /완료/);
  const history = JSON.stringify(w.local.notificationHistory);
  await w.events.startup(); await finishPublicResume(w);
  assert.equal(JSON.stringify(w.local.notificationHistory), history);
});
