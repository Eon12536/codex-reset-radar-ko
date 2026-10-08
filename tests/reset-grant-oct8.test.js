const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/reset-grant-oct8.json');
global.RadarTime = require('../src/core/time');
const Direct = require('../src/core/direct-x');
const Signals = require('../src/core/signals');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
const observedAt = Date.parse(fixture.observedAt);
function posts() {
  const items = Direct.linkQuotedContexts(Direct.normalize(fixture.posts, observedAt));
  items[1] = Direct.conversationContext(items[1], { targetId: items[1].id, rows: [fixture.posts[0], fixture.posts[1]] }, observedAt);
  return items;
}

test('all three supplied posts classify as grant, timing and confirmed without inventing quota resets', () => {
  const items = posts();
  const reports = Signals.reports(items, { now: observedAt });
  assert.equal(reports.length, 3);
  assert.equal(items[2].replyContext.relation, 'quoted-post');
  const byId = new Map(reports.map(report => [report.id, report.assessment]));
  assert.equal(byId.get(items[0].id).report, 'credit-grant');
  assert.equal(byId.get(items[1].id).grantStage, 'timing');
  assert.equal(byId.get(items[2].id).grantStage, 'confirmed');
  for (const item of items) {
    assert.equal(Signals.classify(item, { now: observedAt }).actionable, false);
    assert.equal(byId.get(item.id).eventAt, null);
  }
});

test('short follow-ups cannot borrow ambiguous, unrelated, future, negative or unverified context', () => {
  const [parent, timing, confirmed] = posts();
  for (const item of [timing, confirmed]) {
    for (const patch of [{ relation: 'adjacent-unverified' }, { targetId: parent.id }, { author: 'someone' },
      { url: 'https://x.com/i/chat' }, { createdAt: item.createdAt.replace('2026','2027') },
      { text: "We will not load a banked reset in paid accounts." },
      { text: "Loading a password reset in everyone's paid accounts." },
      { text: "Maybe we'll load a banked reset." }]) {
      assert.equal(Signals.reports([{ ...item, replyContext: { ...item.replyContext, ...patch } }], { now: observedAt }).length, 0);
    }
    assert.equal(Signals.reports([{ ...item, replyContext: null }], { now: observedAt }).length, 0);
  }
});

test('quote display URL artifacts are ignored only after unique author/time/full-body matching', () => {
  const [parent, , confirmation] = fixture.posts;
  const base = Direct.normalize([parent, confirmation], observedAt);
  assert.ok(Direct.linkQuotedContexts(base)[1].replyContext);
  for (const patch of [{ text: parent.text.slice(0, 80) + '…' }, { author: 'reach_vb' },
    { createdAt: '2026-10-07T19:19:18.000Z' }, { text: parent.text + ' Not happening.' }]) {
    assert.equal(Direct.linkQuotedContexts([base[0], { ...base[1], quotedPost: { ...base[1].quotedPost, ...patch } }])[1].replyContext, undefined);
  }
  assert.equal(Direct.linkQuotedContexts([base[0], { ...base[0], id: '999' }, base[1]])[2].replyContext, undefined);
});

test('startup catches up all three posts and failed notification delivery is retried once without duplicates', async () => {
  const w = makeWorker({ stored: { settings: { monitorAccount: false, quietHoursEnabled: false,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false } },
    fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return observedAt; } };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: posts(), diagnostics: {
    posts: 3, timelines: ['posts','replies'].flatMap(kind => ['thsottiaux','reach_vb','openai'].map(author => ({ author, kind, ok: true, stopReason: 'seven-days' }))) } }) };
  const create = w.context.chrome.notifications.create;
  let fail = true;
  w.context.chrome.notifications.create = async (...args) => { if (fail) throw new Error('OS temporarily unavailable'); return create(...args); };
  await w.events.startup();
  await finishPublicResume(w);
  assert.equal(Object.keys(w.notifications).length, 0);
  assert.equal(w.local.pendingNotifications.filter(item => item.id.startsWith('report:')).length, 3);
  fail = false;
  await w.events.alarm({ name: 'codex-reset-radar-poll' });
  for (const post of fixture.posts) assert.ok(w.notifications['report:' + post.id]);
  const history = JSON.stringify(w.local.notificationHistory);
  await w.events.startup(); await finishPublicResume(w);
  assert.equal(JSON.stringify(w.local.notificationHistory), history);
});
