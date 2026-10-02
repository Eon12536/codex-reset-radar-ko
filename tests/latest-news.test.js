const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
const Direct = require('../src/core/direct-x');
const News = require('../src/core/news');
const Settings = require('../src/core/settings');
const { makeWorker, json } = require('./helpers/worker');
const fixture = require('./fixtures/tibo-latest-reset.json');
const now = Date.parse(fixture.observedAt);
const post = (text, extra = {}) => ({ ...fixture.posts[0], text, source: { id: 'codex-lead', weight: 1 }, ...extra });

test('independently discovered reset promise is detected without a Codex keyword or a guessed hour', () => {
  const [item] = Direct.normalize(fixture.posts, now);
  const result = Signals.classify(item, { now });
  assert.equal(result.actionable, true);
  assert.equal(result.confidence, 'high');
  assert.equal(result.eventAt, null);
  for (const file of ['../src/core/signals', '../src/core/direct-x', '../src/x-reader', '../src/background']) {
    const source = fs.readFileSync(require.resolve(file), 'utf8');
    for (const item of fixture.posts) assert.ok(!source.includes(item.id), file);
  }
});

test('token-spending imperatives are weak hints, never confirmed resets or forecasts', () => {
  for (const text of ['Burn those tokens', 'Use up your remaining tokens.', 'Spend those tokens!', "Let's burn through the tokens."]) {
    const item = post(text);
    assert.equal(Signals.classifyHint(item, { now }).rule, 'token-burn', text);
    assert.equal(Signals.classifyHint(item, { now }).eventAt, null);
    assert.equal(Signals.classify(item, { now }).actionable, false);
  }
});

test('new rules preserve exclusions, source identity, completion and cancellation', () => {
  for (const text of ['I promised a password reset for Tuesday.', 'I promised a reset for Tuesday, but cancelled it.',
    'I promised a reset last Tuesday.', 'I promised a reset for Tuesday and delivered.', 'If I promised a reset for Tuesday?',
    'I never promised a reset for Tuesday.', 'I promised a banked reset credit for Tuesday.'])
    assert.equal(Signals.classify(post(text), { now }).actionable, false, text);
  for (const text of ["Don't burn those tokens", 'We burned those tokens yesterday.', 'How many tokens did you burn?',
    'Burn those tokens for Claude.', 'Huge!!', 'Sergio is indeed on fire', 'Negroni is on you'])
    assert.equal(Signals.classifyHint(post(text), { now }).candidate, false, text);
  for (const extra of [{ author: 'someone' }, { source: { id: 'github-community' } }]) {
    assert.equal(Signals.classify(post(fixture.posts[0].text, extra), { now }).actionable, false);
    assert.equal(Signals.classifyHint(post('Burn those tokens', extra), { now }).candidate, false);
  }
});

test('newly fetched posts join old candidates and deliver the configured notification once', async () => {
  const fresh = fixture.posts.map(item => ({ ...item, createdAt: new Date().toISOString() }));
  const old = post('3am on a tuesday', { id: '100', createdAt: new Date(Date.now() - 3600000).toISOString() });
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorDirectX: true, notifyHints: true,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false, quietHoursEnabled: false },
    hintSnapshot: { items: [old] } }, fetcher: async () => json({ items: [] }) });
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: Direct.normalize(fresh),
    diagnostics: { posts: 2, pages: 2, timelines: [{ kind: 'posts', ok: true }, { kind: 'replies', ok: true }] } }) };
  await w.context.refreshSignals();
  assert.equal(w.local.signalSnapshot.signal.id, fresh[0].id);
  assert.equal(w.local.hintSnapshot.items.length, 2);
  assert.equal(News.list(w.local.signalSnapshot, w.local.hintSnapshot, Settings.sanitize()).length, 3);
  assert.ok(w.notifications['signal:' + fresh[0].id]);
  assert.ok(w.notifications['hint:' + fresh[1].id]);
  const history = JSON.stringify(w.local.notificationHistory);
  await w.context.refreshSignals();
  assert.equal(JSON.stringify(w.local.notificationHistory), history);
});
