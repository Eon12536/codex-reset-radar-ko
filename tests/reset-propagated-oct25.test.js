const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
const NOW = Date.parse('2026-10-25T07:00:00Z');
// Public archival records, not a claim that these posts were fetched live by this test.
// https://github.com/PengZoneLab/thsottiaux-Tibo-x-monitor/blob/master/logs/2026-10-25.md
function chain() {
  const item = (id, text, createdAt) => ({ id, text, createdAt, author: 'thsottiaux',
    url: `https://x.com/thsottiaux/status/${id}`, source: { id: 'codex-lead' } });
  const parent = item('2114200152701575656', 'Day 20/ Rest and reset', '2026-10-25T03:39:31Z');
  const timing = item('2114200291319124163', 'By midnight PST', '2026-10-25T03:40:04Z');
  timing.replyContext = { ...parent, relation: 'conversation-before', targetId: timing.id };
  const done = item('2114237083652882932', 'It is all propagated. Enjoy some mad codexing tomorrow. Fun week ahead too.', '2026-10-25T06:06:16Z');
  done.replyContext = { ...timing, relation: 'quoted-post', targetId: done.id };
  return [parent, timing, done];
}
function runtime() {
  const w = makeWorker();
  w.context.Date = class extends Date { static now() { return NOW; } };
  return w;
}

test('Day23 completion with an afterword follows the quoted midnight reset', () => {
  const { context: c } = runtime();
  const items = chain();
  const [parent, timing, done] = items;
  Object.assign(parent, { id: '2115273064481218829', url: 'https://x.com/thsottiaux/status/2115273064481218829',
    text: 'Day 23/ Much requested iCloud Main & Calendar plugins. Just kidding, today is a reset. Still much requested though!', createdAt: '2026-10-28T02:42:53Z' });
  Object.assign(timing, { id: '2115273253711409208', url: 'https://x.com/thsottiaux/status/2115273253711409208', text: 'Lands by midnight PST.', createdAt: '2026-10-28T02:43:38Z', replyContext: { ...parent, relation: 'conversation-before', targetId: '2115273253711409208' } });
  Object.assign(done, { id: '2115330127886463244', url: 'https://x.com/thsottiaux/status/2115330127886463244', text: "And it's done. See you tomorrow for some good news.", createdAt: '2026-10-28T06:29:38Z', replyContext: { ...timing, relation: 'quoted-post', targetId: '2115330127886463244' } });
  const now = Date.parse('2026-10-28T07:00:00Z');
  c.Date = class extends Date { static now() { return now; } };
  const report = c.RadarSignals.reports(items, { now }).find(row => row.id === done.id);
  assert.equal(report?.assessment.report, 'completed-reset');
  assert.equal(report.assessment.completionLink, 'verified');
  const plain = items.map(({ replyContext, ...item }) => item);
  plain[2].quotedPost = plain[1];
  const normalized = c.RadarDirectX.normalize(plain, now);
  normalized[1] = c.RadarDirectX.conversationContext(normalized[1], { targetId: timing.id, rows: plain.slice(0, 2) }, now);
  const collected = c.RadarDirectX.linkQuotedContexts(normalized);
  assert.equal(c.RadarSignals.reports(collected, { now }).find(row => row.id === done.id)?.assessment.report, 'completed-reset');
  const settings = { monitorSignals: true, monitorLeadSource: true, resetOnly: true };
  const rows = c.RadarDailyNews.entries({ signalSnapshot: { reports: [report] }, hintSnapshot: { items: [] } }, settings);
  assert.equal(c.RadarDailyNews.resetCounts(rows).completed, 1);
  const inferredTiming = { ...timing, replyContext: { ...parent, relation: 'previous-reset-announcement', targetId: timing.id } };
  const inferredDone = { ...done, replyContext: { ...inferredTiming, relation: 'quoted-post', targetId: done.id } };
  const inferred = c.RadarSignals.reports([parent, inferredTiming, inferredDone], { now }).find(row => row.id === done.id);
  assert.equal(inferred?.assessment.report, 'completed-reset');
  assert.equal(inferred?.assessment.completionContext, 'inferred');
  const bare = { ...done }; delete bare.replyContext;
  assert.equal(c.RadarSignals.reports([bare], { now }).some(row => row.id === done.id), false);
  const unrelated = { ...done, replyContext: { ...parent, text: 'We are launching a new product tomorrow.', relation: 'quoted-post', targetId: done.id } };
  assert.equal(c.RadarSignals.reports([unrelated], { now }).some(row => row.id === done.id), false);
  for (const text of ["And it's not done. See you tomorrow for some good news.", "Is it done? See you tomorrow for some good news.", "And it's done if tests pass. See you tomorrow for some good news.", "The new model is done. See you tomorrow for some good news."]) {
    assert.equal(c.RadarSignals.reports([{ ...done, text }], { now }).some(row => row.assessment.report === 'completed-reset'), false, text);
  }
});

test('Day20 propagation completion resolves the quoted midnight reply and original reset', () => {
  const { context: c } = runtime(), items = chain(), done = items[2];
  const report = c.RadarSignals.reports(items, { now: NOW }).find(row => row.id === done.id);
  assert.ok(report, 'the actual propagation wording must be reported');
  assert.equal(report.assessment.report, 'completed-reset');
  assert.equal(report.assessment.completionLink, 'verified');
  assert.equal(report.assessment.eventAt, null, 'publication is not a per-account recovery time');
  assert.equal(report.replyContext.id, items[1].id);
  assert.equal(report.replyContext.replyContext.id, items[0].id);
});

test('a retained propagation completion survives reset-only filtering and daily completed counts', () => {
  const { context: c } = runtime(), items = chain();
  const reports = c.RadarSignals.reports(items, { now: NOW });
  const settings = { monitorSignals: true, monitorLeadSource: true, resetOnly: true };
  const done = reports.find(row => row.id === items[2].id);
  assert.ok(done);
  assert.equal(c.RadarResetScope.allows(done, settings), true);
  const rows = c.RadarDailyNews.entries({ signalSnapshot: { reports }, hintSnapshot: { items: [] } }, settings);
  assert.ok(rows.some(row => row.item.id === done.id));
  assert.equal(c.RadarDailyNews.resetCounts(rows).completed, 1);
  assert.equal(c.RadarSignals.reports([done], { now: NOW })[0].assessment.completionLink, 'verified');
});

test('collected quote cards and a Day20 reply page supply the complete verified chain', () => {
  const { context: c } = runtime(), raw = chain();
  const plain = raw.map(({ replyContext, ...item }) => item);
  plain[2].quotedPost = plain[1];
  const normalized = c.RadarDirectX.normalize(plain, NOW);
  normalized[1] = c.RadarDirectX.conversationContext(normalized[1], {
    targetId: plain[1].id, rows: plain.slice(0, 2)
  }, NOW);
  const collected = c.RadarDirectX.linkQuotedContexts(normalized);
  const report = c.RadarSignals.reports(collected, { now: NOW }).find(row => row.id === plain[2].id);
  assert.ok(report, 'DOM-normalized quote and reply evidence must reach the completion classifier');
  assert.equal(report.assessment.completionLink, 'verified');
  assert.equal(c.RadarResetScope.allows(report, { resetOnly: true }), true);
});

test('bounded propagation synonyms require a verified reset context', () => {
  const { context: c } = runtime(), [parent, , original] = chain();
  for (const text of ['It is all propagated.', 'All propagated.', 'The reset has fully propagated.', 'Fully rolled out.']) {
    const done = { ...original, text, replyContext: { ...parent, relation: 'quoted-post', targetId: original.id } };
    assert.equal(c.RadarSignals.reports([done], { now: NOW })[0]?.assessment.report, 'completed-reset', text);
    const { replyContext, ...bare } = done;
    assert.equal(c.RadarSignals.reports([bare], { now: NOW }).length, 0, 'no context: ' + text);
  }
});

test('product rollouts and incomplete, conditional or interrogative propagation never become reset completions', () => {
  const { context: c } = runtime(), [parent, , original] = chain();
  for (const text of ['It is not all propagated.', 'It is all propagated?', 'It is all propagated if tests pass.',
    'It will all propagate tomorrow.', 'The model is fully rolled out.', 'The new product is all propagated.',
    'It is all propagated. Except some accounts.', 'It is all propagated. The reset is cancelled.']) {
    const done = { ...original, text, replyContext: { ...parent, relation: 'quoted-post', targetId: original.id } };
    assert.equal(c.RadarSignals.reports([done], { now: NOW }).some(row => row.assessment.report === 'completed-reset'), false, text);
  }
  const done = { ...original, text: 'It is all propagated.', replyContext: { ...parent,
    text: 'We are rolling out a new model today.', relation: 'quoted-post', targetId: original.id } };
  assert.equal(c.RadarSignals.reports([done], { now: NOW }).length, 0);
});

test('propagation evidence rejects mismatched targets, authors, unrelated nested parents and banked grants', () => {
  const { context: c } = runtime(), [parent, timing, original] = chain();
  for (const patch of [
    { targetId: '123' }, { author: 'reach_vb', url: `https://x.com/reach_vb/status/${timing.id}` },
    { truncated: true }, { replyContext: { ...timing.replyContext, text: 'A product launch tomorrow.' } },
    { replyContext: { ...timing.replyContext, targetId: '123' } },
    { text: 'Banked reset credits have been loaded.' }
  ]) {
    const done = { ...original, replyContext: { ...original.replyContext, ...patch } };
    assert.equal(c.RadarSignals.reports([done], { now: NOW }).length, 0, JSON.stringify(patch));
  }
  const bare = { ...original, text: 'It is all propagated.', replyContext: undefined };
  const another = { ...parent, id: '2114200152701575657', url: 'https://x.com/thsottiaux/status/2114200152701575657' };
  assert.equal(c.RadarSignals.reports([parent, another, bare], { now: NOW }).some(row => row.id === bare.id), false);
});

test('startup collects the propagation completion, accepts one alert and retains it across worker restart', async () => {
  const items = chain();
  function worker(stored = {}) {
    const w = makeWorker({ stored: { ...stored, settings: { ...stored.settings, monitorAccount: false,
      quietHoursEnabled: false, monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false } },
      fetcher: async () => json({ items: [] }) });
    w.context.Date = class extends Date { static now() { return NOW; } };
    w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items, contextCache: {}, diagnostics: {
      posts: items.length, timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai']
        .map(author => ({ author, kind, ok: true, stopReason: 'seven-days' }))) } }) };
    return w;
  }
  const w = worker();
  await w.events.startup(); await finishPublicResume(w);
  assert.ok(w.local.signalSnapshot.reports.some(row => row.id === items[2].id));
  assert.ok(w.notifications['report:' + items[2].id], 'public completion alert must reach the Chrome API mock');
  const history = JSON.stringify(w.local.notificationHistory);
  const next = worker(w.local);
  await next.events.startup(); await finishPublicResume(next);
  assert.ok(next.local.signalSnapshot.reports.some(row => row.id === items[2].id));
  assert.equal(next.notifications['report:' + items[2].id], undefined);
  assert.equal(JSON.stringify(next.local.notificationHistory), history);
});

function inferredChain(c) {
  const [parent, timing, done] = chain();
  delete timing.replyContext;
  const linked = c.RadarSignals.linkTimingFollowUps([parent, timing]);
  done.replyContext = { ...linked[1], relation: 'quoted-post', targetId: done.id };
  return [...linked, done];
}

test('a quote of a bounded inferred timing promise is completion with its root association disclosed', () => {
  const { context: c } = runtime(), items = inferredChain(c);
  assert.equal(items[1].replyContext.relation, 'previous-reset-announcement');
  const report = c.RadarSignals.reports(items, { now: NOW }).find(row => row.id === items[2].id);
  assert.ok(report, 'a directly identified quote must not disappear because its root was not visible');
  assert.equal(report.assessment.report, 'completed-reset');
  assert.equal(report.assessment.completionLink, 'verified', 'the immediate quote is verified, not timeline adjacency');
  assert.equal(report.assessment.completionContext, 'inferred');
  assert.equal(report.assessment.confidence, 'medium');
  assert.equal(report.assessment.eventAt, null);
  assert.equal(report.replyContext.replyContext.relation, 'previous-reset-announcement');
});

test('retained public posts rebuild inferred timing context before resolving their quote after restart', () => {
  const { context: c } = runtime(), items = inferredChain(c);
  items[2].quotedPost = { author: items[1].author, text: items[1].text, createdAt: items[1].createdAt };
  const saved = c.RadarDirectX.archivePosts(items, NOW);
  assert.equal(saved.some(row => row.replyContext), false, 'the archive stores public bodies, not verdicts');
  const restored = c.RadarDirectX.restorePosts(saved, {}, NOW);
  const report = c.RadarSignals.reports(restored, { now: NOW }).find(row => row.id === items[2].id);
  assert.ok(report, 'rebuilding only the outer quote loses the reset subject');
  assert.equal(report.assessment.completionContext, 'inferred');
  assert.equal(report.assessment.completionLink, 'verified');
});

test('saved inferred-root completion survives revalidation and counts as completed without hiding uncertainty', () => {
  const { context: c } = runtime(), items = inferredChain(c);
  const report = c.RadarSignals.reports(items, { now: NOW }).find(row => row.id === items[2].id);
  assert.ok(report);
  const retained = c.RadarSignals.reports([report], { now: NOW });
  assert.equal(retained[0]?.assessment.completionContext, 'inferred');
  assert.equal(retained[0]?.replyContext.replyContext.relation, 'previous-reset-announcement');
  const settings = { monitorSignals: true, monitorLeadSource: true, resetOnly: true };
  assert.equal(c.RadarResetScope.allows(retained[0], settings), true);
  const rows = c.RadarDailyNews.entries({ signalSnapshot: { reports: retained } }, settings);
  assert.equal(c.RadarDailyNews.resetCounts(rows).completed, 1);
});

test('new conflicting anchors or an edited root revoke a cached inferred timing completion', () => {
  const { context: c } = runtime(), [parent, timing, done] = inferredChain(c);
  const competing = { ...parent, id: '2114200152701575657', url: 'https://x.com/thsottiaux/status/2114200152701575657',
    text: 'Day 20/ Reset', createdAt: '2026-10-25T03:39:40Z' };
  for (const items of [[parent, competing, timing, done],
    [{ ...parent, text: 'Day 20/ New model launch' }, timing, done]]) {
    assert.equal(c.RadarSignals.reports(items, { now: NOW }).some(row => row.id === done.id), false);
  }
});

test('inferred root completion rejects malformed evidence and foreign or unlinked quote cards', () => {
  const { context: c } = runtime(), [parent, timing, done] = inferredChain(c);
  for (const patch of [{ targetId: '999' }, { truncated: true },
    { author: 'reach_vb', url: `https://x.com/reach_vb/status/${parent.id}` },
    { createdAt: '2026-10-25T02:00:00Z' }, { text: 'Day 20/ Reset the database' }]) {
    const changed = { ...done, replyContext: { ...done.replyContext,
      replyContext: { ...timing.replyContext, ...patch } } };
    assert.equal(c.RadarSignals.reports([changed], { now: NOW }).length, 0, JSON.stringify(patch));
  }
  const bare = { ...done, replyContext: undefined };
  assert.equal(c.RadarSignals.reports([parent, timing, bare], { now: NOW }).some(row => row.id === bare.id), false);
});

test('current hint context supersedes a saved inferred root instead of reviving its old body', () => {
  const { context: c } = runtime(), items = inferredChain(c);
  const report = c.RadarSignals.reports(items, { now: NOW }).find(row => row.id === items[2].id);
  const edited = { ...items[0], text: 'Day 20/ New model launch' };
  assert.equal(c.RadarSignals.reports([report], { now: NOW, context: [edited] }).length, 0);
});

test('a two-day-old completion remains on its publication-day card after retained-post recovery', () => {
  const { context: c } = runtime(), late = Date.parse('2026-10-27T03:00:00Z');
  c.Date = class extends Date { static now() { return late; } };
  const items = inferredChain(c);
  items[2].quotedPost = items[1];
  const retained = c.RadarDirectX.archivePosts(items, late);
  const restored = c.RadarDirectX.restorePosts(retained, {}, late);
  const reports = c.RadarSignals.reports(restored, { now: late });
  const rows = c.RadarDailyNews.entries({ signalSnapshot: { reports } },
    { monitorSignals: true, monitorLeadSource: true, resetOnly: true });
  assert.equal(rows.length, 1);
  assert.equal(c.RadarDailyNews.resetCounts(rows).completed, 1);
  assert.equal(c.RadarDailyNews.dayKey(rows[0].publishedAt), '2026-10-25');
  assert.equal(rows[0].item.assessment.completionContext, 'inferred');
});

test('startup restores the quoted inferred-root completion and restart does not repeat its daily alert', async () => {
  const raw = chain().map(({ replyContext, ...item }) => item);
  raw[2].quotedPost = raw[1];
  function worker(stored = {}) {
    const w = makeWorker({ stored: { ...stored, settings: { ...stored.settings, monitorAccount: false,
      quietHoursEnabled: false, monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false } },
      fetcher: async () => json({ items: [] }) });
    const c = w.context;
    c.Date = class extends Date { static now() { return NOW; } };
    const items = c.RadarDirectX.restorePosts(raw, {}, NOW);
    c.RadarDirectX = { ...c.RadarDirectX, read: async () => ({ items,
      retainedPosts: c.RadarDirectX.archivePosts(items, NOW), contextCache: {}, diagnostics: { posts: items.length,
        timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai']
          .map(author => ({ author, kind, ok: true, stopReason: 'seven-days' }))) } }) };
    return w;
  }
  const w = worker();
  await w.events.startup(); await finishPublicResume(w);
  const report = w.local.signalSnapshot.reports.find(row => row.id === raw[2].id);
  assert.equal(report?.assessment.completionContext, 'inferred');
  assert.ok(w.notifications['report:' + raw[2].id]);
  const history = JSON.stringify(w.local.notificationHistory);
  const next = worker(w.local);
  await next.events.startup(); await finishPublicResume(next);
  assert.equal(next.local.signalSnapshot.reports.find(row => row.id === raw[2].id)?.assessment.completionContext, 'inferred');
  assert.equal(next.notifications['report:' + raw[2].id], undefined);
  assert.equal(JSON.stringify(next.local.notificationHistory), history);
});
