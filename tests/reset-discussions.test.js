const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
const Direct = require('../src/core/direct-x');
require('../src/core/news');
const Settings = require('../src/core/settings');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
const fixture = require('./fixtures/tibo-reset-polls.json');
const START = Date.parse(fixture.observedAt);
const items = () => Direct.normalize(fixture.posts, START);

test('the three rendered reset survey/choice posts are hints, without promises, completed resets or guessed dates', () => {
  for (const [i, item] of items().entries()) {
    const hint = Signals.classifyHint(item, { now: START });
    assert.equal(hint.rule, i === 1 ? 'reset-choice' : 'reset-poll');
    assert.equal(hint.eventAt, null);
    assert.equal(hint.actionable, false);
    assert.equal(Signals.classify(item, { now: START }).actionable, false);
    assert.equal(Signals.reports([item], { now: START }).length, 0);
  }
  for (const file of ['signals', 'direct-x']) {
    const source = fs.readFileSync(require.resolve('../src/core/' + file), 'utf8');
    for (const post of fixture.posts) assert.ok(!source.includes(post.id));
  }
});

test('poll normalization accepts bounded public labels and retains them through cached hint reclassification', () => {
  const raw = { external_id: '700', content: 'Vote', published_at: fixture.observedAt,
    metadata: { author_user_name: 'thsottiaux' }, poll: { options: [{ label: 'Great release' }, { text: 'Needs a reset' }] } };
  const item = Signals.extractItems({ items: [raw] })[0]; item.source = { id: 'codex-lead' };
  const cached = Signals.hintCandidates([item], { now: START })[0];
  assert.deepEqual(cached.pollOptions, ['Great release', 'Needs a reset']);
  assert.equal(Signals.classifyHint(cached, { now: START }).rule, 'reset-poll');
  assert.equal(Signals.pollOptions([{ label: {} }, 12, 'x'.repeat(300), 'a', 'b', 'c']).length, 2);
  assert.equal(Signals.pollOptions(['x'.repeat(300)])[0].length, 160);
});

test('surveys from other authors, unrelated reset types, negation and unrelated options remain excluded', () => {
  const base = items()[0];
  for (const extra of [{ author: 'random' }, { source: { id: 'github-community' } },
    { text: 'Password reset poll' }, { text: 'No reset planned' },
    { pollOptions: ['good', 'needs a password reset'] }, { pollOptions: ['Good release', 'Claude needs a reset'] },
    { pollOptions: ['Great release'] }, { pollOptions: ['Great release', 'No reset'] }, { pollOptions: ['red', 'blue'] }])
    assert.equal(Signals.classifyHint({ ...base, ...extra }, { now: START }).candidate, false, JSON.stringify(extra));
  for (const text of ['Four updates or a reset last year.', 'A password update or a reset.', 'No update or a reset planned.'])
    assert.equal(Signals.classifyHint({ ...base, text, pollOptions: [] }, { now: START }).candidate, false, text);
});

test('reset discussions stay outside forecasts and their popup badges state survey or hint', () => {
  const hints = Signals.hintCandidates(items(), { now: START, limit: 100 });
  assert.equal(Signals.actionable(hints, { now: START }).length, 0);
  // News reclassifies against its current clock, so use a worker-local clock.
  const w = makeWorker(); w.context.Date = class extends Date { static now() { return START; } };
  const rows = w.context.RadarNews.list(null, { items: hints }, Settings.sanitize());
  assert.equal(rows.length, 3);
  assert.equal(rows[0].label, '리셋 설문');
  assert.equal(rows.find(row => row.item.id === fixture.posts[1].id).label, '리셋 암시');
  assert.ok(rows.every(row => !row.explicit && /실행 미확정/.test(row.kindLabel)));
});

function worker(settings = {}) {
  let now = START - 12 * 3600000, reads = 0;
  const source = { posts: [], fail: false };
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorSignals: true,
    monitorDirectX: true, monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false,
    notifyHints: false, quietHoursEnabled: false, ...settings } }, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return now; } };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => {
    reads++; if (source.fail) throw new Error('offline');
    return { items: Direct.normalize(source.posts, now), diagnostics: { posts: source.posts.length,
      timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai'].map(author =>
        ({ author, kind, ok: true, stopReason: 'seven-days' }))) } };
  } };
  return { ...w, source, clock: at => { now = at; }, reads: () => reads };
}

test('startup scans the new surveys before desktop delivery even when general event/hint alerts are off', async () => {
  const w = worker(); await w.context.refreshSignals();
  w.source.posts = fixture.posts; w.clock(START);
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.events.startup();
  assert.equal(w.local.hintSnapshot.items.length, 3);
  assert.equal(Object.keys(w.notifications).length, 0);
  const before = w.reads(); await finishPublicResume(w);
  assert.equal(w.reads(), before);
  assert.equal(Object.keys(w.notifications).length, 3);
  assert.match(Object.values(w.notifications)[0].message, /리셋 확정이 아닙니다/);
  await w.events.startup(); await finishPublicResume(w);
  assert.equal(Object.keys(w.notifications).length, 3);
});

test('sleep wake scans new surveys before the selected 30-minute poll and delivers once after readiness', async () => {
  const w = worker(); w.clock(START - 20 * 60000); await w.context.refreshSignals();
  await w.events.alarm({ name: 'codex-reset-radar-wake-check', scheduledTime: START - 20 * 60000 });
  w.source.posts = fixture.posts; w.clock(START);
  await w.events.alarm({ name: 'codex-reset-radar-wake-check', scheduledTime: START - 19 * 60000 });
  assert.equal(w.local.hintSnapshot.items.length, 3);
  assert.equal(Object.keys(w.notifications).length, 0);
  await finishPublicResume(w); assert.equal(Object.keys(w.notifications).length, 3);
});

test('the dedicated reset-discussion OFF cancels a pending wake notice while leaving the popup evidence', async () => {
  const w = worker(); await w.context.refreshSignals(); w.source.posts = fixture.posts; w.clock(START);
  await w.events.startup(); assert.equal(w.local.pendingNotifications.length, 3);
  await w.context.saveSettings({ ...w.local.settings, notifyResetHints: false });
  await finishPublicResume(w);
  assert.equal(w.local.pendingNotifications.length, 0);
  assert.equal(Object.keys(w.notifications).length, 0);
  assert.equal(w.local.hintSnapshot.items.length, 3);
});

test('turning unrelated event alerts off preserves a configured reset survey queue', async () => {
  const w = worker({ notifyHints: true }); await w.context.refreshSignals(); w.source.posts = fixture.posts; w.clock(START);
  await w.events.startup();
  await w.context.saveSettings({ ...w.local.settings, notifyHints: false });
  assert.equal(w.local.pendingNotifications.length, 3);
  await finishPublicResume(w); assert.equal(Object.keys(w.notifications).length, 3);
});

test('a previously observed but unclassified recent survey becomes eligible without repeating an acknowledged alert', async () => {
  const w = worker(); w.source.posts = [{ ...fixture.posts[0], pollOptions: [] }]; w.clock(START);
  await w.context.refreshSignals(); assert.equal(w.local.hintSnapshot.items.length, 0);
  w.source.posts = fixture.posts.slice(0,1); await w.context.refreshSignals();
  assert.equal(Object.keys(w.notifications).length, 1);
  await w.context.refreshSignals(); assert.equal(Object.keys(w.notifications).length, 1);
});

test('startup keeps the missed interval through a failed X read and recovers on the automatic resume retry', async () => {
  const w = worker(); await w.context.refreshSignals(); w.clock(START);
  w.source.posts = fixture.posts; w.source.fail = true; await w.events.startup();
  assert.equal(Object.keys(w.notifications).length, 0);
  assert.ok(w.local.publicResumeCheck);
  w.source.fail = false;
  await w.events.alarm({ name: 'codex-reset-radar-public-resume' });
  await finishPublicResume(w);
  assert.equal(Object.keys(w.notifications).length, 3);
});

test('a retracted survey is rechecked and cancelled before pending desktop delivery', async () => {
  const w = worker(); await w.context.refreshSignals(); w.clock(START);
  w.source.posts = fixture.posts.slice(0,1); await w.events.startup();
  assert.equal(w.local.pendingNotifications.length, 1);
  w.source.posts = [{ ...fixture.posts[0], pollOptions: ['Great release', 'No reset'] }];
  await w.context.refreshSignals(); await finishPublicResume(w);
  assert.equal(Object.keys(w.notifications).length, 0);
  assert.equal(w.local.pendingNotifications.length, 0);
});

test('poll result changes do not change the notification identity or cause another toast', async () => {
  const w = worker(); w.clock(START); w.source.posts = fixture.posts.slice(0,1);
  await w.context.refreshSignals(); assert.equal(Object.keys(w.notifications).length, 1);
  // Only stable choice labels are retained; response counts and percentages
  // are deliberately absent from both identity and classified public data.
  w.source.posts = [{ ...fixture.posts[0], votes: 40000, percentages: [10,90] }];
  await w.context.refreshSignals(); assert.equal(Object.keys(w.notifications).length, 1);
});
