const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
const Direct = require('../src/core/direct-x');
const NOW = Date.parse('2026-10-18T12:00:00Z');
const raw = [
  { id: '2111492673890824348', text: 'Day 13/ Le limit reset', createdAt: '2026-10-17T16:20:57Z' },
  { id: '2111492738025959922', text: 'Landing sometime today by EOD PST', createdAt: '2026-10-17T16:21:13Z' },
  { id: '2111495392559067199', text: 'My work dot coordinated with my personal dot over email to file some tax stuff.', createdAt: '2026-10-17T16:31:45Z' },
  { id: '2111566005684289735', text: 'Done', createdAt: '2026-10-17T21:12:21Z' }
].map(row => ({ ...row, author: 'thsottiaux', url: `https://x.com/thsottiaux/status/${row.id}` }));
function items() {
  const rows = Direct.normalize(raw, NOW);
  rows[1] = Direct.conversationContext(rows[1], { targetId: rows[1].id, rows: raw.slice(0, 2) }, NOW);
  return rows;
}

test('the observed standalone Done after one verified reset promise becomes a labelled inferred completion', () => {
  const reports = Signals.reports(items(), { now: NOW });
  const done = reports.find(item => item.id === raw[3].id);
  assert.ok(done);
  assert.equal(done.assessment.report, 'completed-reset');
  assert.equal(done.assessment.completionLink, 'inferred');
  assert.equal(done.assessment.confidence, 'medium');
  assert.equal(done.replyContext.id, raw[1].id);
  assert.equal(done.replyContext.relation, 'previous-announcement');
  assert.equal(done.assessment.eventAt, null);
  assert.match(done.assessment.reason, /추정/);
  assert.equal(Signals.reports([done], { now: NOW })[0].id, done.id);
  assert.equal(Signals.reports([items()[3]], { now: NOW }).length, 0);
});

test('only a unique recent same-author reset promise can supply standalone completion context', () => {
  const [headline, promise, unrelated, done] = items();
  for (const patch of [
    { author: 'reach_vb', url: `https://x.com/reach_vb/status/${done.id}` },
    { text: 'Done?' }, { text: 'Not done' }, { text: 'My code is done' }, { text: 'Done if we can' },
    { truncated: true }, { source: { id: 'github-community' } },
    { createdAt: '2026-10-19T21:12:21Z' },
    { replyContext: { ...unrelated, relation: 'conversation-before', targetId: done.id } }
  ]) assert.equal(Signals.reports([headline, promise, { ...done, ...patch }], { now: NOW + 3 * 86400000 }).some(item => item.id === done.id), false, JSON.stringify(patch));
  const competing = { ...promise, id: '300', text: 'Codex limits will reset tomorrow.',
    url: 'https://x.com/thsottiaux/status/300', createdAt: '2026-10-17T19:00:00Z', replyContext: undefined };
  assert.equal(Signals.reports([promise, competing, done], { now: NOW }).length, 0);
  for (const text of ['No reset today.', 'The reset was cancelled.', 'GPT-6 will launch tonight.', 'Loading a banked reset in paid accounts.']) {
    const intervening = { ...competing, text };
    assert.equal(Signals.reports([promise, intervening, done], { now: NOW }).some(item => item.id === done.id), false, text);
  }
});

test('a verified completion can resolve an exact collected timing reply and its original reset headline', () => {
  const [headline, promise, unrelated, done] = items();
  const { replyContext: _nested, ...reference } = promise;
  const target = { ...done, replyContext: { ...reference, relation: 'conversation-before', targetId: done.id } };
  const report = Signals.reports([headline, promise, unrelated, target], { now: NOW }).find(item => item.id === done.id);
  assert.equal(report?.assessment.completionLink, 'verified');
});

test('a saved inferred completion is revalidated after a promise edit and does not repeat on another Done', () => {
  const rows = items();
  const report = Signals.reports(rows, { now: NOW })[0];
  const changed = { ...rows[1], text: 'A product is coming tomorrow.', replyContext: undefined };
  assert.equal(Signals.reports([report, changed], { now: NOW }).some(item => item.id === report.id), false);
  const another = { ...rows[3], id: '501', url: 'https://x.com/thsottiaux/status/501', createdAt: '2026-10-17T22:00:00Z' };
  assert.equal(Signals.reports([report, ...rows.slice(0, 3), another], { now: NOW }).length, 1);
});

test('publication dates are distinct from reset deadlines and follow the selected country in every news row', () => {
  const { context } = makeWorker();
  context.Date = class extends Date { static now() { return NOW; } };
  const reports = Signals.reports(items(), { now: NOW });
  for (const country of context.RadarI18n.COUNTRIES) {
    context.RadarI18n.setLocale(country.locale);
    const list = context.RadarNews.list({ activeSignals: [], reports }, { items: [items()[0]] }, { monitorSignals: true, monitorLeadSource: true });
    assert.equal(list.length, 2);
    for (const news of list) {
      assert.equal(news.publishedAt, Date.parse(news.item.createdAt));
      assert.match(news.publishedText, /2026/);
      assert.ok(news.publishedText.includes(country.timeLabel));
    }
    if (country.locale === 'ko-KR') {
      const completed = list.find(news => news.item.id === raw[3].id);
      assert.match(completed.publishedText, /오전 6:12/);
      assert.equal(completed.label, '완료 표현');
      assert.match(completed.kindLabel, /추정/);
    }
  }
});

test('a verified direct completion accepts short wording without treating it as account telemetry', () => {
  const [headline, , , done] = items();
  for (const relation of ['quoted-post', 'conversation-before']) for (const text of ['Done', "It's done.", 'Completed!', 'All done.']) {
    const item = { ...done, text, replyContext: { ...headline, relation, targetId: done.id } };
    const report = Signals.reports([item], { now: NOW })[0];
    assert.equal(report?.assessment.completionLink, 'verified', relation + ': ' + text);
    assert.equal(report.assessment.report, 'completed-reset');
    assert.equal(Signals.resetKind(report), 'unknown');
  }
});

test('repeated standalone completions do not repeatedly claim the same promise', () => {
  const rows = items();
  const another = { ...rows[3], id: '500', url: 'https://x.com/thsottiaux/status/500', createdAt: '2026-10-17T22:00:00Z' };
  const reports = Signals.reports([...rows, another], { now: NOW });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].id, raw[3].id);
});

test('startup and worker restart recover the completion notification exactly once with inference explained', async () => {
  const w = makeWorker({ stored: { settings: { monitorAccount: false, quietHoursEnabled: false,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false } }, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: items(), contextCache: {}, diagnostics: {
    posts: 4, timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai']
      .map(author => ({ author, kind, ok: true, stopReason: 'seven-days' }))) } }) };
  await w.events.startup(); await finishPublicResume(w);
  assert.ok(w.notifications['report:' + raw[3].id]);
  assert.match(w.notifications['report:' + raw[3].id].title, /추정/);
  assert.match(w.notifications['report:' + raw[3].id].message, /별도|미확인/);
  const history = JSON.stringify(w.local.notificationHistory);
  await w.events.startup(); await finishPublicResume(w);
  assert.equal(JSON.stringify(w.local.notificationHistory), history);
  assert.ok(Signals.reports([...w.local.signalSnapshot.reports, ...w.local.signalSnapshot.activeSignals, items()[3]], { now: NOW }).length, 'refetched bare Done keeps prior public evidence');
  const next = makeWorker({ stored: w.local, fetcher: async () => json({ items: [] }) });
  next.context.Date = class extends Date { static now() { return NOW + 120000; } };
  next.context.RadarDirectX = { ...next.context.RadarDirectX, read: async () => ({ items: [items()[3]], diagnostics: {
    posts: 1, timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai']
      .map(author => ({ author, kind, ok: true, stopReason: 'seven-days' }))) } }) };
  await next.events.startup(); await finishPublicResume(next);
  assert.equal(next.notifications['report:' + raw[3].id], undefined);
  assert.ok(next.local.signalSnapshot.reports.some(report => report.id === raw[3].id));
});
