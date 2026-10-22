const test = require('node:test');
const assert = require('node:assert');
global.RadarTime = require('../src/core/time');
global.RadarSignals = require('../src/core/signals');
const Schedule = require('../src/core/schedule');
const NOW = Date.now();
const H = 3600000;
const post = (id, text, ago, extra = {}) => ({ id, text, author: 'thsottiaux', createdAt: new Date(NOW - ago).toISOString(), source: { id: 'codex-lead', weight: 1 }, url: 'https://x.com/thsottiaux/status/' + id, ...extra });
const run = (posts) => {
  const state = Schedule.reconcile(undefined, posts, { now: NOW });
  return { changes: Schedule.changes(state, { now: NOW }), superseded: [...Schedule.supersededIds(state, { now: NOW })] };
};

test('delay replying to reset-review does not create a schedule hint', () => {
  const review = post('1001', 'Fresh reset for everyone. Enjoy!', 3 * H);
  const delay = post('1002', 'This reset is postponed until tomorrow.', H, { inReplyToId: review.id });
  const r = run([review, delay]);
  assert.deepStrictEqual(r.changes, []);
  assert.deepStrictEqual(r.superseded, []);
});

test('delay replying to a strict forecast still yields one change', () => {
  const forecast = post('2001', 'We will reset Codex usage limits later today.', 3 * H);
  const delay = post('2002', 'This reset is postponed until tomorrow.', H, { inReplyToId: forecast.id });
  const r = run([forecast, delay]);
  assert.strictEqual(r.changes.length, 1);
});
