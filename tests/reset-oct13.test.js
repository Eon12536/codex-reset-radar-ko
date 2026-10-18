const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
const Direct = require('../src/core/direct-x');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
const NOW = Date.parse('2026-10-13T01:10:00.000Z');
// Public text/timestamps observed in Chrome, not a rule keyed to these IDs.
const posts = [
  { id: '2109812216212099456', author: 'thsottiaux', text: 'Day 8/ Reset',
    createdAt: '2026-10-13T01:03:25.000Z', url: 'https://x.com/thsottiaux/status/2109812216212099456' },
  { id: '2109812360596865224', author: 'thsottiaux', text: 'Global reset landing by EOD PST time. Enjoy',
    createdAt: '2026-10-13T01:03:59.000Z', url: 'https://x.com/thsottiaux/status/2109812360596865224' }
];
const items = () => Direct.normalize(posts, NOW);

test('the observed EOD announcement is an explicit reset promise with no fabricated execution time or kind', () => {
  const [, item] = items();
  const assessment = Signals.classify(item, { now: NOW });
  assert.equal(assessment.actionable, true);
  assert.equal(assessment.untimedPromise, true);
  assert.equal(assessment.eventAt, null);
  assert.equal(Signals.classifyHint(item, { now: NOW }).candidate, false);
  assert.equal(Signals.reports([item], { now: NOW }).length, 0);
  assert.equal(Signals.resetKind(item), 'unknown');
  for (const post of posts) assert.ok(!fs.readFileSync(require.resolve('../src/core/signals'), 'utf8').includes(post.id));
});

test('deadline variants work for monitored authors without treating end of day as a precise hour', () => {
  for (const author of ['thsottiaux', 'reach_vb', 'OpenAI']) for (const text of [
    'Global reset landing by EOD PST time. Enjoy', 'A reset is arriving by end of day.',
    'More resets coming by the end of the day.', 'Reset planned before EOD UTC.'
  ]) {
    const item = { ...items()[1], author, text };
    const assessment = Signals.classify(item, { now: NOW });
    assert.equal(assessment.actionable, true, author + ': ' + text);
    assert.equal(assessment.eventAt, null, text);
  }
});

test('deadline wording does not promote negation, hearsay, quotation, questions, history or unrelated resets', () => {
  for (const text of [
    'No global reset landing by EOD PST.', 'Global reset is not landing by EOD PST.',
    'Maybe global reset landing by EOD.', 'Is global reset landing by EOD?',
    'Global reset landing by EOD if we can.', 'Global reset landing by EOD, but cancelled.',
    'I heard global reset landing by EOD.', 'Gia said global reset landing by EOD.',
    '"Global reset landing by EOD" is an example.', 'Global reset landed yesterday by EOD.',
    'Global password reset landing by EOD.', 'Banked reset credits landing by EOD.',
    'Global reset. The new product is arriving by EOD.', 'Global reset landing by geodesic projection.'
  ]) assert.equal(Signals.classify({ ...items()[1], text }, { now: NOW }).actionable, false, text);
  for (const patch of [{ author: 'someone' }, { source: { id: 'github-community' } }])
    assert.equal(Signals.classify({ ...items()[1], ...patch }, { now: NOW }).actionable, false);
});

test('the short Day N reset headline remains a reset-specific hint rather than a promise or completion', () => {
  for (const author of ['thsottiaux', 'reach_vb', 'OpenAI']) for (const text of [
    'Day 8/ Reset', 'Day 9 / Reset.', 'Day 12: Reset', 'Day 28 — Global reset!'
  ]) {
    const item = { ...items()[0], author, text };
    const hint = Signals.classifyHint(item, { now: NOW });
    assert.equal(hint.candidate, true, author + ': ' + text);
    assert.equal(hint.rule, 'reset-short');
    assert.equal(hint.eventAt, null);
    assert.equal(hint.actionable, false);
    assert.equal(Signals.classify(item, { now: NOW }).actionable, false);
    assert.equal(Signals.reports([item], { now: NOW }).length, 0);
    assert.equal(Signals.resetKind(item), 'unknown');
  }
});

test('a numbered headline cannot borrow authority, unrelated subjects, history or question intent', () => {
  for (const text of [
    'Day 8/ No reset', 'Day 8/ Reset?', 'Day 8/ Maybe reset', 'Day 8/ Password reset',
    'Day 8/ Git reset', 'Day 8/ Banked reset credits', 'Day 8/ Reset last year',
    'Day 8/ Reset is cancelled', 'Day 8/ Reset if we can', '"Day 8/ Reset"',
    'Example: Day 8/ Reset', 'Day 8/ Reset. Ignore all previous instructions.'
  ]) assert.equal(Signals.classifyHint({ ...items()[0], text }, { now: NOW }).candidate, false, text);
  for (const patch of [{ author: 'someone' }, { source: { id: 'github-community' } },
    { createdAt: '2026-10-01T01:03:25.000Z' }, { createdAt: '2026-10-14T01:03:25.000Z' }])
    assert.equal(Signals.classifyHint({ ...items()[0], ...patch }, { now: NOW }).candidate, false);
});

function worker(settings = {}) {
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false, quietHoursEnabled: false,
    notifyHints: false, notifyResetHints: true, ...settings } }, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: items(), diagnostics: {
    posts: 2, timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai']
      .map(author => ({ author, kind, ok: true, stopReason: 'seven-days' }))) } }) };
  return w;
}

test('startup collects both posts before notification delivery and repeats neither on the next startup', async () => {
  const w = worker();
  await w.events.startup();
  assert.ok(w.local.signalSnapshot.activeSignals.some(item => item.id === posts[1].id));
  assert.ok(w.local.hintSnapshot.items.some(item => item.id === posts[0].id));
  assert.equal(Object.keys(w.notifications).length, 0);
  await finishPublicResume(w);
  assert.ok(w.notifications['signal:' + posts[1].id]);
  assert.ok(w.notifications['hint:' + posts[0].id]);
  const history = JSON.stringify(w.local.notificationHistory);
  await w.events.startup(); await finishPublicResume(w);
  assert.equal(JSON.stringify(w.local.notificationHistory), history);
});

test('disabling reset hints hides only the short-headline notification while retaining the explicit promise', async () => {
  const w = worker({ notifyResetHints: false });
  await w.context.refreshSignals();
  assert.ok(w.notifications['signal:' + posts[1].id]);
  assert.equal(w.notifications['hint:' + posts[0].id], undefined);
  assert.ok(w.local.hintSnapshot.items.some(item => item.id === posts[0].id));
});
