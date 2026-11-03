const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json } = require('./helpers/worker');
const NOW = Date.parse('2026-10-25T13:00Z');
const post = (text, id = '91001') => ({ id, text, author: 'thsottiaux', source: { id: 'codex-lead' },
  url: `https://x.com/thsottiaux/status/${id}`, createdAt: new Date(NOW - 60000).toISOString() });
const positives = ['Time to refuel Codex soon.', 'Codex could get a fresh start tomorrow.',
  'Maybe we should dust off the reset button tomorrow.', 'Codex could get another round tomorrow.',
  'Codex will recharge the batteries tomorrow.', 'Time to fill up the tank for Codex tomorrow.'];

test('grounded ambiguous metaphors pass reset-only scope but remain inferred, never actionable or timed', () => {
  const { context: c } = makeWorker();
  for (const text of positives) {
    const item = post(text);
    assert.equal(c.RadarResetScope.allows(item, { resetOnly: true }), true, text);
    const assessment = c.RadarSignals.classifyHint(item, { now: NOW });
    assert.equal(assessment.candidate, true, text);
    assert.equal(assessment.actionable, false);
    assert.equal(c.RadarSignals.classify(item, { now: NOW }).actionable, false);
    const row = { item: { ...item, assessment } };
    assert.equal(c.RadarDailyNews.statusKind(row), 'inferred');
    assert.equal(c.RadarDailyNews.status(row), '리셋 추정');
    const time = c.RadarNews.schedule(item);
    assert.equal(time.instant, undefined);
    assert.equal(time.deadlineAt, undefined);
  }
});

test('gifts, generic celebrations, technical resets, negation and other-provider metaphors remain excluded', () => {
  const { context: c } = makeWorker();
  for (const text of ['Time to refuel the car soon.', 'Claude could get a fresh start tomorrow.',
    'Codex will not refuel tomorrow.', 'Codex launches a new product with a full tank tomorrow.',
    'A surprise gift for Codex fans tomorrow.', 'New milestone to celebrate tomorrow.', 'Burn those tokens!',
    'Maybe dust off the password reset button tomorrow.', 'Codex will reset the database tomorrow.',
    'Codex could get a fresh start after a browser restart tomorrow.', 'Maybe find the reset button for the Codex API key tomorrow.'])
    assert.equal(c.RadarResetScope.allows(post(text), { resetOnly: true }), false, text);
  assert.equal(c.RadarResetScope.allows({ ...post(positives[0]), author: 'someone' }, { resetOnly: true }), false);
  assert.equal(c.RadarResetScope.allows({ ...post(positives[0]), truncated: true }, { resetOnly: true }), false);
});

test('three categories are mutually exclusive and every source is counted exactly once', () => {
  const { context: c } = makeWorker();
  const row = (assessment, text = 'That’s a reset!') => ({ item: { ...post(text), assessment } });
  const rows = [row({ candidate: true, rule: 'reset-review' }, 'Maybe reset Codex limits?'), row({ actionable: true }),
    row({ report: 'completed-reset' }), row({ candidate: true, rule: 'reset-metaphor' }, 'Time to refuel Codex soon.')];
  const counts = c.RadarDailyNews.resetCounts(rows);
  assert.deepEqual(JSON.parse(JSON.stringify(counts)), { forecast: 1, completed: 1, inferred: 2, grant: 0 });
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), rows.length);
  assert.equal(c.RadarDailyNews.statusKind(row({ candidate: true, rule: 'semantic-reset', semanticCategory: 'uncertain' }, 'Maybe reset Codex limits?')), 'inferred');
  assert.equal(c.RadarDailyNews.statusKind(row({ report: 'completed-reset', completionLink: 'inferred' })), 'inferred');
});

async function runWorker(notifyHints = true) {
  const w = makeWorker({ individualPublicAlerts: false, stored: { settings: { monitorAccount: false, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false, semanticEnabled: false, quietHoursEnabled: false, notifyHints } },
    fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  const rows = [post(positives[0])];
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: rows, diagnostics: { posts: rows.length,
    timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai'].map(author => ({kind,author,ok:true,stopReason:'seven-days'}))) } }) };
  await w.context.refreshSignals();
  return { w, rows };
}

test('an inferred metaphor reaches the daily Windows summary once and later sources update the popup silently', async () => {
  const { w, rows } = await runWorker();
  const id = 'daily-reset:2026-10-25';
  assert.ok(w.notifications[id]);
  assert.match(w.notifications[id].message, /리셋 추정/);
  assert.doesNotMatch(w.notifications[id].title, /리셋됐|리셋 완료|100%/);
  assert.equal(w.local.signalSnapshot.activeSignals.length, 0);
  rows.push(post(positives[1], '91002'));
  await w.context.refreshSignals();
  assert.deepEqual(Object.keys(w.notifications), [id]);
  const groups = w.context.RadarDailyNews.groups(w.local, w.local.settings);
  assert.equal(groups[0].items.length, 2);
  assert.equal(w.context.RadarDailyNews.resetCounts(groups[0].items).inferred, 2);
});

test('turning candidate alerts off keeps inferred sources visible without native notifications', async () => {
  const { w } = await runWorker(false);
  assert.equal(Object.keys(w.notifications).length, 0);
  const groups = w.context.RadarDailyNews.groups(w.local, w.local.settings);
  assert.equal(w.context.RadarDailyNews.resetCounts(groups[0].items).inferred, 1);
});
