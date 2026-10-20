const test = require('node:test');
const assert = require('node:assert/strict');
global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
const Direct = require('../src/core/direct-x');
const NOW = Date.parse('2026-10-21T01:00:00Z');
const row = (id, text, createdAt, author = 'thsottiaux') => ({ id, text, createdAt, author, url: `https://x.com/${author}/status/${id}` });
const ACTUAL = 'Day 15/ Nevermind, we\'re still cooking... and reset. Enjoy.';
const RAW = row('2112432076767289678', ACTUAL, '2026-10-20T06:33:48.000Z');
const COOKED = row('2112268918681485431', 'Day 15/ We\'re cooked', '2026-10-19T19:45:28Z');
const norm = raws => Direct.normalize(raws, NOW);
const reportOf = (item, now = NOW) => Signals.reports([item], { now }).find(r => r.id === item.id);
const hintOf = item => Signals.hintCandidates([item], { now: NOW, limit: 10 }).find(h => h.id === item.id);
const withText = text => ({ ...norm([RAW])[0], text });

test('actual Day 15 post becomes labeled medium completed-reset report, not hint/actionable', () => {
  const [cooked, latest] = norm([COOKED, RAW]);
  const report = reportOf(latest);
  assert.ok(report, 'latest reported');
  assert.equal(report.assessment.report, 'completed-reset');
  assert.equal(report.assessment.confidence, 'medium');
  assert.equal(report.assessment.announcement, 'day-series');
  assert.equal(report.assessment.eventAt, null);
  assert.equal(report.assessment.actionable, false);
  assert.equal(report.assessment.completionLink, undefined, 'no invented link');
  assert.equal(hintOf(latest), undefined, 'no duplicate hint');
  assert.equal(Signals.actionable([latest], { now: NOW }).length, 0);
  assert.equal(reportOf(cooked), undefined, 'quoted cooked post is not a reset claim');
  assert.equal(hintOf(cooked), undefined);
  const quoting = { ...latest, replyContext: { id: COOKED.id, author: COOKED.author, text: COOKED.text, url: COOKED.url,
    createdAt: COOKED.createdAt, relation: 'quoted-post', targetId: latest.id } };
  assert.equal(reportOf(quoting)?.assessment.report, 'completed-reset');
});

test('whitespace, case, separator and day-number variations', () => {
  for (const text of [
    'day 3/ still cooking... and reset. enjoy.', 'DAY 101 :  Nevermind,   we are cooking — and reset!  Enjoy!',
    'Day 7- shipping fixes and reset. Enjoy', 'Day 2/ and reset. It\'s live.', 'Day 42/ Reset done.',
    'Day 16/ Cooking and reset is done.', 'Day 9/ And reset. It\'s now live.'
  ]) assert.equal(reportOf(withText(text))?.assessment.report, 'completed-reset', text);
  const mention = withText('Day 9/ Still cooking and reset.');
  assert.equal(reportOf(mention), undefined, 'no availability cue -> no completion claim');
  assert.equal(hintOf(mention)?.assessment.rule, 'reset-day');
  assert.equal(hintOf(mention)?.assessment.confidence, 'low');
});

test('negatives produce no report and no reset-day hint', () => {
  for (const text of [
    'Day 15/ and reset? Enjoy.', 'Day 15/ Should we reset? Enjoy.', 'Day 15/ No reset. Enjoy.',
    'Day 15/ Reset denied. Enjoy.', 'Day 15/ Reset cancelled. Enjoy.', 'Day 15/ Reset will come tomorrow. Enjoy.',
    'Day 15/ Reset later today. Enjoy.', 'Day 15/ Not cooking and reset. Enjoy.', 'Day 15/ Password reset. Enjoy.',
    'Day 15/ Did a git reset. Enjoy.', 'Day 15/ Reset your device. Enjoy.', 'Day 15/ Router and reset. Enjoy.',
    'Day 15/ Banked reset credits. Enjoy.', 'Day 15/ Banking and reset. Enjoy.', 'Day 15/ We\'re cooked',
    'Day 15/ We\'re cooked. Enjoy.', 'Nevermind, we\'re still cooking... and reset. Enjoy.'
  ]) {
    const item = withText(text);
    assert.equal(reportOf(item), undefined, text);
    assert.notEqual(hintOf(item)?.assessment.rule, 'reset-day', text);
  }
});

test('hedged/incomplete cues, negated contractions and plans are never completion', () => {
  const noHint = ['Day 15/ We didn\'t ship and reset. Enjoy.', 'Day 15/ We didn’t ship and reset. Enjoy.',
    'Day 15/ Reset isn\'t done. Enjoy.', 'Day 15/ Time to reset. Enjoy.', 'Day 15/ Let\'s reset. Enjoy.',
    'Day 15/ Shall we reset. Enjoy.', 'Day 15/ Hoping to ship and reset. Enjoy.', 'Day 15/ Intending to reset. Enjoy.'];
  for (const text of [...noHint, 'Day 15/ Reset. Almost done.', 'Day 15/ Cooking and reset. Nearly live.',
    'Day 15/ Cooking and reset. Log in']) {
    const item = withText(text);
    assert.equal(reportOf(item), undefined, text);
    assert.notEqual(hintOf(item)?.assessment.confidence, 'medium', text);
    if (noHint.includes(text)) assert.notEqual(hintOf(item)?.assessment.rule, 'reset-day', text);
  }
});

test('untrusted author, truncation and stale posts are rejected', () => {
  const [latest] = norm([RAW]);
  assert.equal(reportOf({ ...latest, author: 'someone', url: `https://x.com/someone/status/${RAW.id}` }), undefined);
  assert.equal(reportOf({ ...latest, url: `https://x.com/someone/status/${RAW.id}` }), undefined);
  assert.equal(reportOf({ ...latest, truncated: true }), undefined);
  assert.equal(hintOf({ ...latest, truncated: true })?.assessment.rule, undefined);
  assert.equal(reportOf(latest, NOW + 8 * 86400000), undefined);
});

test('old headline stays a hint and headline + Done inference is unchanged', () => {
  const T = Date.parse('2026-10-18T12:00:00Z');
  const [a, done] = Direct.normalize([row('2111492673890824348', 'Day 13/ Le limit reset', '2026-10-17T16:20:57Z'),
    row('2111566005684289735', 'Done', '2026-10-17T21:12:21Z')], T);
  assert.equal(Signals.hintCandidates([a], { now: T })[0]?.assessment.rule, 'reset-short');
  const list = Signals.reports([a, done], { now: T });
  assert.deepEqual(list.map(r => r.id), [done.id]);
  assert.deepEqual([list[0].assessment.completionLink, list[0].assessment.confidence], ['inferred', 'medium']);
  assert.equal(list[0].assessment.announcement, undefined);
});
