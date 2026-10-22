const test = require('node:test');
const assert = require('node:assert/strict');
global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
// All texts below are synthetic fixtures, not observed posts (except ACTUAL Day 15).
const NOW = Date.parse('2026-10-21T01:00:00Z');
const post = (text, extra = {}, id = '2112500000000000001', author = 'thsottiaux') => ({ id, text, author,
  createdAt: '2026-10-20T12:00:00Z', source: { id: 'codex-lead', weight: 1 }, url: `https://x.com/${author}/status/${id}`, ...extra });
const hint = item => Signals.classifyHint(item, { now: NOW });
const reportOf = (items, id) => Signals.reports(items, { now: NOW }).find(r => r.id === id);
const LONG = 'Codex update: we know many of you hit your weekly usage limits during a very busy week of heavy use, and we appreciate the ' +
  'patience while the team worked through capacity and reliability fixes across every surface. As a thank you, everyone ' +
  'gets a fresh usage reset across Codex plans. Thanks for building with us and keep sending feedback on what to improve.';

test('synthetic unmatched reset posts become low-confidence review hints only', () => {
  assert.ok(LONG.length > 280);
  for (const text of ['Day 16/ We shipped improvements. A reset for all accounts is in. Enjoy!', 'Fresh reset for everyone. Enjoy!', LONG]) {
    const item = post(text), result = hint(item);
    assert.equal(result.rule, 'reset-review', text);
    assert.equal(result.candidate, true);
    assert.equal(result.actionable, false);
    assert.equal(result.confidence, 'low');
    assert.equal(result.eventAt, null);
    assert.match(result.reason, /수동 확인 필요/);
    assert.match(result.reason, /미확정/);
    assert.equal(Signals.actionable([item], { now: NOW }).length, 0, text);
  }
});

test('safety negatives never produce reset-review', () => {
  const texts = ['No reset for everyone this week.', 'The reset for everyone is cancelled.', "Last week's reset for everyone was fun.",
    'A reset for everyone a while ago.', 'Reset your router for everyone.', 'Codex tip: reset the branch before you commit.',
    'Password reset for everyone.', 'Database reset for all accounts is done.', 'Reset the cache for everyone.',
    'Reset config for everyone.', 'Maybe a reset for everyone?', '🔄🎉✨', 'Codex is now live for everyone. Enjoy!',
    'Big product launch today. Enjoy!', "Usage limits won't reset for everyone."];
  for (const text of texts) assert.notEqual(hint(post(text)).rule, 'reset-review', text);
  const base = 'Fresh reset for everyone. Enjoy!';
  for (const extra of [{ truncated: true }, { url: 'https://x.com/evil/status/2112500000000000001' }, { url: 'https://evil.example/thsottiaux/status/2112500000000000001' },
    { author: 'someone_else', url: 'https://x.com/someone_else/status/2112500000000000001' }, { source: { id: 'github-community' } },
    { createdAt: '2026-10-13T00:00:00Z' }, { createdAt: '2026-10-21T01:10:00Z' }])
    assert.notEqual(hint(post(base, extra)).rule, 'reset-review', JSON.stringify(extra));
});

test('actual Day 15 stays a completed report with no duplicate hint', () => {
  const item = post("Day 15/ Nevermind, we're still cooking... and reset. Enjoy.", { createdAt: '2026-10-20T06:33:48.000Z' }, '2112432076767289678');
  assert.equal(reportOf([item], item.id)?.assessment.report, 'completed-reset');
  assert.equal(hint(item).candidate, false);
  assert.equal(Signals.hintCandidates([item], { now: NOW, limit: 10 }).find(h => h.id === item.id), undefined);
});

test('review candidate followed by Done never infers completion', () => {
  const parent = post('Fresh reset for everyone. Enjoy!', {}, '2112500000000000002');
  assert.equal(hint(parent).rule, 'reset-review');
  assert.equal(reportOf([parent], parent.id), undefined);
  for (const relation of ['previous-announcement', 'conversation-before', 'quoted-post']) {
    const done = post('Done.', { createdAt: '2026-10-20T13:00:00Z', replyContext: { id: parent.id, author: parent.author, text: parent.text,
      url: parent.url, createdAt: parent.createdAt, relation, targetId: '2112500000000000003' } }, '2112500000000000003');
    assert.equal(reportOf([parent, done], done.id), undefined, relation);
    assert.equal(Signals.actionable([parent, done], { now: NOW }).length, 0);
  }
});
