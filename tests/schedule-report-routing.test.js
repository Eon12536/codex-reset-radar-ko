const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
global.RadarTime = require('../src/core/time');
global.RadarSignals = require('../src/core/signals');
const Schedule = require('../src/core/schedule');
const Direct = require('../src/core/direct-x');
const Alerts = require('../src/core/public-alerts');

function fixture(settings = {}) {
  const now = Date.now();
  const post = (id, text, minutes) => ({ id, text, author: 'thsottiaux',
    createdAt: new Date(now - minutes * 60000).toISOString(),
    url: `https://x.com/thsottiaux/status/${id}`, source: { id: 'codex-lead', weight: 1 } });
  const original = post('101', 'We will reset Codex usage limits tomorrow.', 30);
  const update = post('102', 'The Codex reset is delayed. We are working on it.', 10);
  const data = { items: [original, update] };
  const fetcher = async () => json({ items: data.items.map(item => ({ external_id: item.id, content: item.text,
    published_at: item.createdAt, url: item.url, metadata: { author_user_name: item.author } })) });
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorSignals: true, monitorLeadSource: true,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false,
    quietHoursEnabled: false, ...settings } }, fetcher });
  const delivered = [];
  const create = w.context.chrome.notifications.create;
  w.context.chrome.notifications.create = async (id, options) => { delivered.push(id); return create(id, options); };
  return { w, data, original, update, post, delivered, fetcher };
}

test('one delay post classified as a follow-up produces only its schedule notification', async () => {
  const { w, delivered } = fixture();
  await w.context.refreshSignals(); await w.context.refreshSignals();
  assert.equal(w.local.signalSnapshot.reports[0].assessment.report, 'reset-update');
  assert.equal(delivered.length, 1);
  assert.match(delivered[0], /^schedule:101:102:/);
  assert.equal(w.local.pendingNotifications.length, 0);
});

test('quiet hours retain one schedule queue and deliver it once after a worker restart', async () => {
  const { w, fetcher } = fixture();
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.refreshSignals(); await w.context.refreshSignals();
  assert.equal(w.local.pendingNotifications.length, 1);
  assert.match(w.local.pendingNotifications[0].id, /^schedule:/);
  const restarted = makeWorker({ stored: structuredClone(w.local), fetcher });
  await restarted.context.ensureSecurity();
  await restarted.context.flushPendingNotifications();
  assert.equal(Object.keys(restarted.notifications).length, 1);
  await restarted.context.refreshSignals();
  assert.equal(restarted.notifications['report:102'], undefined);
});

test('a rejected schedule delivery cannot create a parallel follow-up toast or queue', async () => {
  const { w, delivered } = fixture();
  w.context.chrome.notifications.create = async () => { throw Error('Desktop unavailable'); };
  await w.context.refreshSignals();
  assert.equal(Object.keys(w.notifications).length, 0);
  assert.equal(w.local.pendingNotifications.length, 1);
  const id = w.local.pendingNotifications[0].id;
  assert.match(id, /^schedule:/);
  w.context.chrome.notifications.create = async (key, options) => { delivered.push(key); w.notifications[key] = options; };
  await w.context.flushPendingNotifications(); await w.context.refreshSignals();
  assert.deepEqual(delivered, [id]);
});

test('a schedule waiting through a long quiet period does not acquire a second follow-up queue', async () => {
  const { w, delivered } = fixture();
  let now = Date.now();
  w.context.Date = class extends Date { static now() { return now; } };
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.refreshSignals();
  now += 13 * 3600000;
  await w.context.refreshSignals();
  assert.equal(w.local.pendingNotifications.length, 1);
  assert.match(w.local.pendingNotifications[0].id, /^schedule:/);
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => false };
  await finishPublicResume(w);
  assert.equal(delivered.length, 1);
});

test('disabling schedule notices keeps the official follow-up route available', async () => {
  const { w, delivered } = fixture({ notifyScheduleChanges: false });
  await w.context.refreshSignals();
  assert.deepEqual(delivered, ['report:102']);
  w.local.settings.notifyScheduleChanges = true;
  await w.context.refreshSignals();
  assert.deepEqual(delivered, ['report:102']);
});

test('an authorized schedule queue survives three offline days even after the display card expires', async () => {
  const { w, delivered } = fixture();
  let now = Date.now();
  w.context.Date = class extends Date { static now() { return now; } };
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.refreshSignals();
  const id = w.local.pendingNotifications[0].id;
  now += 72 * 3600000;
  await w.context.refreshSignals();
  assert.equal(w.context.RadarSchedule.changes(w.local.scheduleSnapshot).length, 0);
  assert.equal(w.local.pendingNotifications.length, 1);
  await finishPublicResume(w);
  assert.deepEqual(delivered, [id]);
  assert.equal(w.local.pendingNotifications.length, 0);
});

test('a prior announcement arriving after an already notified follow-up does not notify it again', async () => {
  const { w, data, original, update, delivered } = fixture();
  data.items = [update]; await w.context.refreshSignals();
  assert.deepEqual(delivered, ['report:102']);
  data.items = [original, update]; await w.context.refreshSignals();
  assert.deepEqual(delivered, ['report:102']);
  assert.equal(w.local.scheduleSnapshot.events[0].updates[0].post.id, '102');
});

test('a meaningful edit to an already notified schedule still notifies the new revision once', async () => {
  const { w, data, update, delivered } = fixture();
  await w.context.refreshSignals();
  data.items[1] = { ...update, text: 'The Codex reset is postponed until next week. We are working on it.' };
  await w.context.refreshSignals(); await w.context.refreshSignals();
  assert.equal(delivered.length, 2);
  assert.notEqual(delivered[0], delivered[1]);
  assert.equal(w.notifications['report:102'], undefined);
});

test('legacy duplicate pending notices are reconciled to one schedule route', async () => {
  const { w } = fixture();
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.refreshSignals();
  w.local.pendingNotifications.push({ id: 'report:102', queuedAt: Date.now(), options: { title: 'Legacy duplicate' } });
  await w.context.revalidateCachedSignals(0);
  assert.equal(w.local.pendingNotifications.length, 1);
  assert.match(w.local.pendingNotifications[0].id, /^schedule:/);
});

test('a delivered schedule suppresses later category changes for the same post', () => {
  const now = Date.now(), item = { id: '102', createdAt: new Date(now).toISOString() };
  assert.equal(Alerts.allowed(item, null, { 'schedule:101:102:abc': now }), false);
  assert.equal(Alerts.allowed(item, null, { 'schedule:101:1020:abc': now }), true);
});

test('a legacy queued schedule is discarded if the same post already delivered as a report', async () => {
  const { w } = fixture();
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.refreshSignals();
  w.local.notificationHistory = { 'report:102': Date.now() };
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => false };
  await w.context.flushPendingNotifications();
  assert.equal(Object.keys(w.notifications).length, 0);
  assert.equal(w.local.pendingNotifications.length, 0);
});

test('an exact collected quote links a delay to one of several reset announcements', () => {
  const { original, update, post } = fixture();
  const other = post('103', 'We will reset Codex weekly usage limits later today.', 20);
  const items = Direct.linkQuotedContexts(Direct.normalize([original, other, { ...update, quotedPost: original }]));
  const state = Schedule.reconcile(undefined, items);
  const changes = Schedule.changes(state);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].original.id, original.id);
  assert.equal(changes[0].association, 'reference');
  assert.equal(Schedule.changes(Schedule.reconcile(state, items)).length, 1);
  assert.equal(Schedule.supersededIds(state).has(other.id), false);
});

test('wrong target, unverified adjacency and altered quoted evidence cannot choose a reset schedule', () => {
  const { original, update, post } = fixture();
  const other = post('103', 'We will reset Codex weekly usage limits later today.', 20);
  const context = { ...original, targetId: update.id, relation: 'quoted-post' };
  for (const change of [{ targetId: '999' }, { relation: 'adjacent-unverified' },
    { text: 'A different reset announcement' }, { createdAt: update.createdAt }, { url: 'https://evil.invalid' }]) {
    const state = Schedule.reconcile(undefined, [original, other, { ...update, replyContext: { ...context, ...change } }]);
    assert.equal(Schedule.changes(state).length, 0);
  }
});
