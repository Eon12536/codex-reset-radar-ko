const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker } = require('./helpers/worker');
const fixture = require('./fixtures/tibo-day18-oct23.json');
const deadline = Date.parse('2026-10-23T18:00:00Z');

function scenario(patch = {}, extra = [], active = false) {
  const w = makeWorker();
  const now = Date.parse(active ? '2026-10-23T09:00:00Z' : '2026-10-24T06:00:00Z');
  w.context.Date = class extends Date { static now() { return now; } };
  const [parent, raw] = JSON.parse(JSON.stringify(fixture.posts)).map(item => ({ ...item, source: { id: 'codex-lead', weight: 1 } }));
  const child = { ...raw, replyContext: { ...parent, relation: 'conversation-before', targetId: raw.id } };
  const visible = { ...parent, ...patch };
  const settings = w.context.RadarSettings.sanitize({ monitorSignals: true, monitorLeadSource: true, resetOnly: true });
  const rows = w.context.RadarNews.list({ activeSignals: active ? [{ ...child, assessment: w.context.RadarSignals.classify(child, { now }) }] : [], reports: [], timingReplies: [child] },
    { items: [visible, ...extra.map(item => ({ ...parent, ...item }))] }, settings);
  return { rows, visible, parent, child };
}

test('a prefixed feed identifier cannot hide a verified timing reply for the same public post', () => {
  const id = 'feed:' + fixture.posts[0].id;
  const { rows } = scenario({ id });
  const original = rows.find(row => row.item.id === id);
  assert.equal(original?.timingSchedule?.deadlineAt, deadline);
  assert.equal(original.item.id, id, 'opening links and stored keys retain the original feed identifier');
});

test('sharing parameters and a trailing slash cannot hide the same verified public-post timing', () => {
  for (const suffix of ['?s=20', '#shared', '/?s=20#shared']) {
    const url = fixture.posts[0].url + suffix;
    const { rows, visible } = scenario({ url });
    const original = rows.find(row => row.item.id === visible.id);
    assert.equal(original?.timingSchedule?.deadlineAt, deadline, suffix);
    assert.equal(original.item.url, url);
  }
});

test('public identity matching keeps edited bodies, times, other posts and unsafe origins unlinked', () => {
  const parent = fixture.posts[0];
  for (const patch of [
    { id: 'feed:' + parent.id, text: parent.text + ' Updated announcement.' },
    { id: 'feed:' + parent.id, createdAt: '2026-10-23T04:46:20.000Z' },
    { id: 'feed:' + parent.id, url: 'https://x.com/thsottiaux/status/99990001' },
    { id: 'feed:' + parent.id, url: parent.url.replace('x.com/', 'x.com.evil.invalid/') },
    { id: 'feed:' + parent.id, url: parent.url.replace('https://', 'http://') },
    { id: 'feed:' + parent.id, url: parent.url.replace('https://', 'https://user@') },
    { id: 'feed:' + parent.id, author: 'reach_vb' }
  ]) {
    const { rows } = scenario(patch);
    assert.equal(rows.some(row => row.timingSchedule?.deadlineAt === deadline), false, JSON.stringify(patch));
  }
});

test('conflicting visible variants of one public post cannot restore a stale archived schedule', () => {
  const parent = fixture.posts[0];
  const { rows } = scenario({}, [{ id: 'feed:' + parent.id, text: parent.text + ' Updated announcement.' }]);
  assert.equal(rows.some(row => row.timingSchedule?.deadlineAt === deadline), false);
});

test('an active timing reply cannot bypass conflicting visible versions of its parent', () => {
  const parent = fixture.posts[0];
  const { rows } = scenario({}, [{ id: 'feed:' + parent.id, text: parent.text + ' Updated announcement.' }], true);
  const originals = rows.filter(row => row.item.id === parent.id || row.item.id === 'feed:' + parent.id);
  assert.equal(originals.length, 2);
  assert.equal(originals.some(row => row.timingSchedule?.deadlineAt === deadline), false);
});
