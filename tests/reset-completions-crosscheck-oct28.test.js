const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
// Original public posts were checked in Chrome; timestamps are publication times.
const row = (id, text, createdAt) => ({ id, text, createdAt, author: 'thsottiaux',
  url: `https://x.com/thsottiaux/status/${id}`, source: { id: 'codex-lead' } });
const at = value => Date.parse(value.createdAt) + 60000;
function runtime(now) {
  const w = makeWorker();
  w.context.Date = class extends Date { static now() { return now; } };
  return w.context;
}
const processed = row('2107676072871600470', "We shipped four things that were deemed good to great and some math proofs, but the vote is clear and the community demands a reset. I did calibrate it and it *seems* that the game is rigged in reset's favor, but such are the rules at the moment.\n\nTherefore ... the reset has been processed. Enjoy!", '2026-10-07T03:35:09Z');
const votePromise = row('2109045392684032299', 'Global reset by EOD. May the tokens do good things for you.', '2026-10-10T22:16:20Z');
const bag = row('2109132167112782291', 'Put the reset in the bag. All propagated.', '2026-10-11T04:01:09Z');
function bagItems() { return [votePromise, { ...bag, replyContext: { ...votePromise, relation: 'quoted-post', targetId: bag.id } }]; }
function day10() {
  const root = row('2110595484180214059', 'The reports of my reset button being lost are greatly exaggerated\n\nDay 10/ Reset', '2026-10-15T04:55:51Z');
  const timing = row('2110595554036400151', 'Landing within the next 2 hours', '2026-10-15T04:56:07Z');
  timing.replyContext = { ...root, relation: 'conversation-before', targetId: timing.id };
  const done = row('2110618732666257557', 'Done and dusted', '2026-10-15T06:28:13Z');
  done.replyContext = { ...timing, relation: 'quoted-post', targetId: done.id };
  return [root, timing, done];
}
function report(c, items, id) { return c.RadarSignals.reports(items, { now: Math.max(...items.map(at)) }).find(x => x.id === id); }

test('Oct 7 processed reset is a completion in the complete public body', () => {
  const c = runtime(at(processed)), result = report(c, [processed], processed.id);
  assert.equal(result?.assessment.report, 'completed-reset');
  assert.equal(result.assessment.eventAt, null);
  assert.equal(c.RadarResetScope.allows(result, { resetOnly: true }), true);
  assert.equal(c.RadarDailyNews.statusKind({ item: result }), 'completed');
});

test('Oct 11 propagated idiom is a completion of its verified reset quote', () => {
  const c = runtime(at(bag)), result = report(c, bagItems(), bag.id);
  assert.equal(result?.assessment.report, 'completed-reset');
  assert.equal(result.replyContext.relation, 'quoted-post');
  assert.equal(c.RadarResetScope.allows(result, { resetOnly: true }), true);
  assert.equal(c.RadarDailyNews.statusKind({ item: result }), 'completed');
});

test('Oct 11 quote survives actual public-card normalization and archive restoration', () => {
  const c = runtime(at(bag));
  const raw = [votePromise, { ...bag, quotedPost: votePromise }];
  const live = c.RadarDirectX.linkQuotedContexts(c.RadarDirectX.normalize(raw, at(bag)));
  const restored = c.RadarDirectX.restorePosts(c.RadarDirectX.archivePosts(live, at(bag)), {}, at(bag));
  for (const items of [live, restored]) {
    const result = report(c, items, bag.id);
    assert.equal(result?.assessment.report, 'completed-reset');
    assert.equal(c.RadarDailyNews.statusKind({ item: result }), 'completed');
  }
});

test('Oct 15 dusted completion uses its actual two-hour reply and original reset', () => {
  const [root, timing, done] = day10(), c = runtime(at(done));
  assert.equal(c.RadarSignals.resetAnchor(root), true);
  assert.equal(c.RadarSignals.classify(timing, { now: Date.parse(timing.createdAt) }).actionable, true);
  const result = report(c, [root, timing, done], done.id);
  assert.equal(result?.assessment.report, 'completed-reset');
  assert.equal(result.assessment.completionLink, 'verified');
  assert.equal(result.assessment.eventAt, null);
  assert.equal(c.RadarResetScope.allows(result, { resetOnly: true }), true);
  assert.equal(c.RadarDailyNews.statusKind({ item: result }), 'completed');
});

test('Oct 15 quote remains attributable with a unique inferred root, including archive restore', () => {
  const [root, timing, done] = day10(), c = runtime(at(done));
  delete timing.replyContext;
  done.quotedPost = timing;
  const items = c.RadarDirectX.restorePosts(c.RadarDirectX.archivePosts([root, timing, done], at(done)), {}, at(done));
  const result = report(c, items, done.id);
  assert.equal(result?.assessment.report, 'completed-reset');
  assert.equal(result.assessment.completionContext, 'inferred');
  assert.equal(result.assessment.confidence, 'medium');
  assert.equal(c.RadarResetScope.allows(result, { resetOnly: true }), true);
});

test('negative, uncertain, banked and technical processing do not become completions', () => {
  const c = runtime(at(processed));
  for (const text of ["The password reset has been processed.", "The database reset has been processed.",
    'The banked reset has been processed.', 'The reset has not been processed.',
    'The community demands a reset. Maybe the reset has been processed.',
    'The community demands a reset. Has the reset been processed?',
    'The reset was cancelled. The community reset has been processed.',
    'The community demands a reset. The reset will be processed tomorrow.']) {
    assert.equal(c.RadarSignals.reports([{ ...processed, text }], { now: at(processed) }).length, 0, text);
  }
});

test('idioms require exact non-contradictory wording and verified reset context', () => {
  const c = runtime(at(bag)), [parent, base] = bagItems();
  for (const item of [{ ...base, replyContext: undefined },
    { ...base, text: 'Put the reset in the bag. Not all propagated.' },
    { ...base, text: 'Put the reset in the bag. All propagated if ready.' },
    { ...base, replyContext: { ...base.replyContext, targetId: '1' } },
    { ...base, replyContext: { ...base.replyContext, text: 'The product will launch by EOD.' } },
    { ...base, replyContext: { ...base.replyContext, author: 'reach_vb' } }]) {
    assert.equal(c.RadarSignals.reports([parent, item], { now: at(bag) }).some(r => r.id === item.id), false);
  }
  const [root, timing, done] = day10();
  const later = runtime(at(done));
  for (const item of [{ ...done, replyContext: undefined }, { ...done, text: 'Done and dusted?' },
    { ...done, text: 'Not done and dusted.' }, { ...done, text: 'Done and dusted if tests pass.' },
    { ...done, replyContext: { ...done.replyContext, targetId: '1' } },
    { ...done, replyContext: { ...done.replyContext, replyContext: { ...timing.replyContext, text: 'Day 10/ Product launch' } } }]) {
    assert.equal(c.RadarSignals.reports([item], { now: at(done) }).some(r => r.id === done.id), false);
  }
  assert.equal(c.RadarSignals.reports([root, timing], { now: at(done) }).some(r => r.id === done.id), false);
});

test('two-hour timing cannot borrow a false, unrelated or ambiguous reset anchor', () => {
  const [root, timing, done] = day10(), c = runtime(at(done));
  for (const text of ['Reset the database\n\nDay 10/ Reset',
    'The reset was cancelled\n\nDay 10/ Reset',
    'Did we reset the device?\n\nDay 10/ Reset']) {
    const edited = { ...root, text };
    const target = { ...done, replyContext: { ...done.replyContext,
      replyContext: { ...timing.replyContext, text } } };
    assert.equal(c.RadarSignals.reports([edited, target], { now: at(done) }).some(r => r.id === done.id), false, text);
  }
  for (const text of ['Landing within the next 2 hours?', 'Maybe landing within the next 2 hours',
    'Not landing within the next 2 hours', 'Landing within the next 2 hours if ready']) {
    const target = { ...done, replyContext: { ...done.replyContext, text } };
    assert.equal(c.RadarSignals.reports([target], { now: at(done) }).some(r => r.id === done.id), false, text);
  }
});

test('existing day-specific regression fixtures still receive no duplicated daily completion alert', async () => {
  const [root, timing, done] = day10(), now = at(done);
  const w = makeWorker({ stored: { settings: { monitorAccount: false, quietHoursEnabled: false,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false } }, fetcher: async () => json({items:[]}) });
  w.context.Date = class extends Date { static now() { return now; } };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: [root, timing, done], contextCache: {}, diagnostics: {
    posts: 3, timelines: ['posts','replies'].flatMap(kind => ['thsottiaux','reach_vb','openai']
      .map(author => ({author, kind, ok:true, stopReason:'seven-days'}))) } }) };
  await w.events.startup(); await finishPublicResume(w);
  assert.ok(w.local.signalSnapshot.reports.some(x => x.id === done.id));
  assert.ok(w.notifications['report:' + done.id]);
  const history = JSON.stringify(w.local.notificationHistory);
  await w.events.startup(); await finishPublicResume(w);
  assert.equal(JSON.stringify(w.local.notificationHistory), history);
});

for (const [label, raw, target] of [
  ['Oct 7 processed', [processed], processed],
  ['Oct 11 quoted propagation', [votePromise, { ...bag, quotedPost: votePromise }], bag]
]) test(label + ' reaches the daily card and the mock Chrome notification once', async () => {
  const now = at(target);
  const w = makeWorker({ stored: { settings: { monitorAccount: false, quietHoursEnabled: false,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false } }, fetcher: async () => json({items:[]}) });
  const c = w.context;
  c.Date = class extends Date { static now() { return now; } };
  const items = c.RadarDirectX.linkQuotedContexts(c.RadarDirectX.normalize(raw, now));
  c.RadarDirectX = { ...c.RadarDirectX, read: async () => ({ items, contextCache: {}, diagnostics: {
    posts: items.length, timelines: ['posts','replies'].flatMap(kind => ['thsottiaux','reach_vb','openai']
      .map(author => ({author, kind, ok:true, stopReason:'seven-days'}))) } }) };
  await w.events.startup(); await finishPublicResume(w);
  assert.ok(w.local.signalSnapshot.reports.some(x => x.id === target.id));
  const groups = c.RadarDailyNews.groups(w.local, w.local.settings);
  const group = groups.find(g => g.items.some(news => news.item.id === target.id));
  assert.ok(group);
  assert.equal(c.RadarDailyNews.resetCounts(group.items).completed, 1);
  assert.ok(w.notifications['report:' + target.id]);
  const history = JSON.stringify(w.local.notificationHistory);
  await w.events.startup(); await finishPublicResume(w);
  assert.equal(JSON.stringify(w.local.notificationHistory), history);
});
