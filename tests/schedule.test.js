const test = require('node:test');
const assert = require('node:assert/strict');
global.RadarTime = require('../src/core/time.js');
global.RadarSignals = require('../src/core/signals.js');
const Schedule = require('../src/core/schedule.js');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker.js');
const NOW = Date.parse('2026-09-18T12:00:00Z');
const HOUR = 3600000;
const post = (id, text, ago = 1, extra = {}) => ({ id, text, author: 'thsottiaux',
  createdAt: new Date(NOW - ago * HOUR).toISOString(), source: { id: 'codex-lead', weight: 1 },
  url: `https://x.com/thsottiaux/status/${id}`, ...extra });
const initial = () => post('101', 'We will reset Codex usage limits later today.', 3);
const later = (extra = {}) => post('102', 'This reset is postponed until tomorrow.', 1, extra);
const reconcile = (items, state) => Schedule.reconcile(state, items, { now: NOW });
const changes = state => Schedule.changes(state, { now: NOW });

test('a referenced delay supersedes only its previous event, independent of feed ordering', () => {
  const other = post('103', 'We will reset Codex usage limits tomorrow.', 2);
  const state = reconcile([later({ inReplyToId: '101' }), other, initial()]);
  const change = changes(state)[0];
  assert.equal(change.association, 'reference');
  assert.equal(change.original.id, '101');
  assert.equal(change.label, '리셋 일정 연기');
  assert.deepEqual([...Schedule.supersededIds(state, { now: NOW })].sort(), ['101', '102']);
  assert.deepEqual(reconcile([initial(), later({ inReplyToId: '101' }), other], state), state);
});

test('an unreferenced celebration update links only one recent matching candidate and labels inference', () => {
  const first = post('201', 'new milestone to celebrate tomorrow', 3);
  const update = post('202', 'This celebration is moved to tomorrow', 1);
  const state = reconcile([first, update]);
  assert.equal(changes(state)[0].association, 'inferred');
  assert.equal(changes(state)[0].kind, 'hint');
  const ambiguous = reconcile([first, post('203', 'Another new milestone to celebrate tomorrow', 2), update]);
  assert.equal(changes(ambiguous).length, 0);
  assert.equal(changes(reconcile([first, { ...update, inReplyToId: '999' }])).length, 0);
});

test('same-post edits and a second postponement preserve the previous wording and deduplicate revisions', () => {
  let state = reconcile([initial()]);
  state = reconcile([{ ...initial(), text: 'Codex reset postponed until tomorrow.' }], state);
  const edited = changes(state)[0];
  assert.equal(edited.association, 'edit');
  assert.equal(edited.previous.text, initial().text);
  const next = post('104', 'Delayed again, no date yet.', 0, { inReplyToId: '101' });
  state = reconcile([next], state);
  const second = changes(state)[0];
  assert.equal(second.previous.text, edited.post.text);
  assert.notEqual(Schedule.notificationId(second), Schedule.notificationId(edited));
  assert.deepEqual(reconcile([next], state), state);
});

test('negation, speculation, unrelated subjects, wrong authors and missing prior evidence never link', () => {
  const invalid = [
    'Codex reset is not delayed.', 'Codex reset will not be postponed.', 'No delay for the Codex reset.',
    'Codex reset was delayed, but limits are reset now.', 'Codex reset cannot be postponed.',
    'We might postpone the Codex reset.', 'Codex launch postponed until tomorrow.',
    'Password reset postponed.', 'Our meeting is delayed. Codex reset tomorrow.',
    'All reset for everyone.', 'Thanks!', 'Is the Codex reset delayed?'
  ];
  for (const text of invalid) assert.equal(changes(reconcile([initial(), { ...later(), text }])).length, 0, text);
  assert.equal(changes(reconcile([initial(), later({ author: 'someone_else' })])).length, 0);
  assert.equal(changes(reconcile([later()])).length, 0);
  assert.equal(changes(reconcile([initial(), { ...later(), createdAt: new Date(NOW + HOUR).toISOString() }])).length, 0);
});

test('edits retract obsolete changes; missing posts or failed feeds do not retract them', () => {
  const state = reconcile([initial(), later()]);
  assert.equal(changes(reconcile([], state)).length, 1);
  const retracted = reconcile([{ ...later(), text: 'The Codex reset is not delayed.' }], state);
  assert.equal(changes(retracted).length, 0);
  assert.equal(Schedule.supersededIds(retracted, { now: NOW }).size, 0);
});

test('not today is a timing qualifier, while not delayed is a true negation', () => {
  const root = post('301', 'Codex will reset soon, but not today.', 3);
  const update = post('302', 'Not today: the Codex reset is delayed until tomorrow.', 1, { inReplyToId: '301' });
  const change = changes(reconcile([root, update]))[0];
  assert.equal(change.kind, 'hint');
  assert.equal(change.label, '리셋 일정 연기');
  assert.equal(changes(reconcile([root, { ...update, text: 'The Codex reset has not been delayed.' }])).length, 0);
});

test('schedule display expires after 48 hours but suppression lasts for the seven-day retained event', () => {
  const state = reconcile([initial(), later()]);
  assert.equal(Schedule.changes(state, { now: NOW + 49 * HOUR }).length, 0);
  assert.equal(Schedule.supersededIds(state, { now: NOW + 49 * HOUR }).has('101'), true);
  assert.equal(Schedule.reconcile(state, [], { now: NOW + 8 * 24 * HOUR }).events.length, 0);
  assert.equal(reconcile(Array.from({ length: 40 }, (_, i) => post(String(i + 1), initial().text, i))).events.length, 30);
});

test('feed normalization retains validated string references without rounding large IDs', () => {
  const normalize = metadata => global.RadarSignals.extractItems({ items: [{ id: '102', content: later().text, metadata }] })[0];
  assert.equal(normalize({ in_reply_to_status_id_str: '2093573991965557198' }).inReplyToId, '2093573991965557198');
  assert.equal(normalize({ in_reply_to_status_id: 2093573991965557198 }).inReplyToId, null);
  assert.equal(normalize({ quoted_status_id: '101' }).quotedStatusId, '101');
  assert.equal(normalize({ in_reply_to_status_id: 'https://evil.invalid' }).inReplyToId, null);
});

function worker({ hint = false, notifyHints = true } = {}) {
  const base = Date.now();
  const raw = (id, content, minutes, reply) => ({ external_id: id, content,
    published_at: new Date(base - minutes * 60000).toISOString(),
    metadata: { author_user_name: 'thsottiaux', in_reply_to_status_id: reply } });
  const first = raw('101', hint ? 'new milestone to celebrate tomorrow' : initial().text, 10);
  const next = raw('102', hint ? 'This celebration is moved to tomorrow' : later().text, 5, '101');
  const data = { items: [first], fail: false };
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorSignals: true,
    monitorLeadSource: true, monitorStatusSource: false, monitorHistorySource: false,
    monitorCommunitySource: false, quietHoursEnabled: false, notifyHints } },
    fetcher: async () => { if (data.fail) throw Error('Feed unavailable'); return json({ items: data.items }); } });
  let count = 0;
  const original = w.context.chrome.notifications.create;
  w.context.chrome.notifications.create = async (id, options) => { count++; return original(id, options); };
  return { w, data, first, next, raw, count: () => count };
}

test('worker replaces old forecast, visible notification and snooze with one linked change alert', async () => {
  const { w, data, first, next, count } = worker();
  const cleared = [];
  w.context.chrome.alarms.clear = async name => cleared.push(name);
  await w.context.refreshSignals();
  assert.ok(w.notifications['signal:101']);
  data.items = [next, first];
  await w.context.refreshSignals();
  const change = w.context.RadarSchedule.changes(w.local.scheduleSnapshot)[0];
  const id = w.context.RadarSchedule.notificationId(change);
  assert.equal(w.local.signalSnapshot.signal, null);
  assert.equal(w.local.signalSnapshot.activeSignals.length, 0);
  assert.equal(w.local.hintSnapshot.items.length, 0);
  assert.equal(w.notifications['signal:101'], undefined);
  assert.ok(cleared.includes('snooze:signal:101'));
  assert.match(w.notifications[id].title, /일정 연기/);
  await w.context.refreshSignals();
  await w.events.alarm({ name: 'snooze:signal:101' });
  assert.equal(count(), 2);
  data.fail = true;
  await w.context.refreshSignals();
  assert.ok(w.notifications[id]);
  assert.equal(w.local.signalSnapshot.signal, null);
  const restarted = makeWorker({ stored: structuredClone(w.local) });
  await restarted.context.ensureSecurity();
  assert.equal(restarted.local.signalSnapshot.signal, null);
  assert.equal(restarted.context.RadarSchedule.changes(restarted.local.scheduleSnapshot).length, 1);
});

test('a second delay alerts once and removes the earlier change notification', async () => {
  const { w, data, first, next, raw, count } = worker();
  await w.context.refreshSignals();
  data.items = [next, first]; await w.context.refreshSignals();
  const oldId = Object.keys(w.notifications)[0];
  const second = raw('103', 'Delayed again, no date yet.', 1, '102');
  data.items = [second, first, next]; await w.context.refreshSignals(); await w.context.refreshSignals();
  assert.equal(count(), 3);
  assert.equal(w.notifications[oldId], undefined);
  assert.match(Object.values(w.notifications)[0].message, /Delayed again/);
  await w.events.notificationButton(Object.keys(w.notifications)[0], 1);
  assert.equal(w.tabs[0].url, 'https://x.com/thsottiaux/status/102');
});

test('hint opt-in and schedule toggle are honored while the display still updates', async () => {
  const { w, data, first, next, count } = worker({ hint: true, notifyHints: false });
  data.items = [first, next]; await w.context.refreshSignals();
  assert.equal(count(), 0);
  assert.equal(w.context.RadarSchedule.changes(w.local.scheduleSnapshot).length, 1);
  await w.context.saveSettings({ ...w.local.settings, notifyHints: true });
  await w.context.refreshSignals(); assert.equal(count(), 1);
  assert.match(Object.values(w.notifications)[0].message, /리셋 확정은 아닙니다/);
  await w.context.saveSettings({ ...w.local.settings, notifyScheduleChanges: false });
  assert.equal(Object.keys(w.notifications).length, 0);
  assert.equal(w.local.scheduleSnapshot.events.length, 1);
  await w.context.saveSettings({ ...w.local.settings, monitorLeadSource: false });
  assert.equal(w.local.scheduleSnapshot?.events?.length || 0, 0);
});

test('quiet queues discard superseded forecasts and stale or disabled schedule alerts', async () => {
  const { w, data, first, next } = worker();
  await w.context.ensureSecurity();
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.refreshSignals();
  assert.equal(w.local.pendingNotifications[0].id, 'signal:101');
  data.items = [first, next]; await w.context.refreshSignals(); await w.context.refreshSignals();
  assert.equal(w.local.pendingNotifications.length, 1);
  assert.match(w.local.pendingNotifications[0].id, /^schedule:/);
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => false };
  await w.context.flushPendingNotifications();
  assert.match(Object.keys(w.notifications)[0], /^schedule:/);
  const queued = { id: Object.keys(w.notifications)[0], options: Object.values(w.notifications)[0] };
  w.local.pendingNotifications = [queued];
  w.local.settings.notifyScheduleChanges = false;
  const before = Object.keys(w.notifications).length;
  await w.context.flushPendingNotifications();
  assert.equal(Object.keys(w.notifications).length, before);
  w.local.settings.notifyScheduleChanges = true;
  w.local.scheduleSnapshot.events[0].updates[0].post.createdAt = new Date(Date.now() - 49 * HOUR).toISOString();
  w.local.pendingNotifications = [queued];
  await w.context.revalidateCachedSignals(0);
  assert.equal(w.local.pendingNotifications.length, 0);
  assert.equal(Object.keys(w.notifications).length, 0);
});

test('change evidence accepts only trusted popup requests and allowlisted post URLs', async () => {
  const { w, data, first, next } = worker();
  data.items = [first, next]; await w.context.refreshSignals();
  assert.equal((await w.send({ type: 'OPEN_SCHEDULE_UPDATE' }, w.sender('options'))).ok, false);
  assert.equal((await w.send({ type: 'OPEN_SCHEDULE_UPDATE', url: 'https://evil.invalid' }, w.sender('popup'))).ok, false);
  assert.equal((await w.send({ type: 'OPEN_SCHEDULE_UPDATE' }, w.sender('popup'))).ok, true);
  assert.equal(w.tabs[0].url, 'https://x.com/thsottiaux/status/102');
  const id = Object.keys(w.notifications)[0];
  await w.events.notificationButton(id, 1);
  assert.equal(w.tabs[1].url, 'https://x.com/thsottiaux/status/101');
  w.local.scheduleSnapshot.events[0].updates[0].post.url = 'https://evil.invalid';
  assert.equal((await w.send({ type: 'OPEN_SCHEDULE_UPDATE' }, w.sender('popup'))).ok, false);
  await w.context.clearLocalData();
  assert.equal(w.local.scheduleSnapshot, undefined);
});

test('disabling monitoring while a feed request is pending prevents delayed state and notification writes', async () => {
  const { w, first, next } = worker();
  await w.context.refreshSignals();
  let release, started;
  const pending = new Promise(resolve => { started = resolve; });
  w.context.fetch = async () => { started(); return new Promise(resolve => { release = resolve; }); };
  const refreshing = w.context.refreshSignals();
  await pending;
  await w.context.saveSettings({ ...w.local.settings, monitorSignals: false });
  release(json({ items: [first, next] }));
  await refreshing;
  assert.equal(w.local.scheduleSnapshot, undefined);
  assert.equal(w.local.signalSnapshot.signal, null);
  assert.equal(Object.keys(w.notifications).length, 0);
});

test('same-post delay edits survive a worker restart and edited-away delay removes pending alerts', async () => {
  const { w, data, first } = worker();
  await w.context.refreshSignals();
  data.items = [{ ...first, content: 'Codex reset postponed until tomorrow.' }];
  await w.context.refreshSignals();
  const change = w.context.RadarSchedule.changes(w.local.scheduleSnapshot)[0];
  assert.equal(change.association, 'edit');
  const restarted = makeWorker({ stored: structuredClone(w.local), fetcher: async () => json({ items: data.items }) });
  await restarted.context.refreshSignals();
  assert.equal(restarted.local.signalSnapshot.signal, null);
  assert.equal(restarted.context.RadarSchedule.changes(restarted.local.scheduleSnapshot).length, 1);
  data.items = [{ ...first, content: 'Codex reset is not postponed.' }];
  w.local.pendingNotifications = Object.entries(w.notifications).map(([id, options]) => ({ id, options }));
  await w.context.refreshSignals();
  assert.equal(w.context.RadarSchedule.changes(w.local.scheduleSnapshot).length, 0);
  assert.equal(w.local.pendingNotifications.length, 0);
  assert.equal(Object.keys(w.notifications).length, 0);
});

test('a schedule change missed during downtime can notify on resume and retry during quiet hours', async () => {
  const { w, data, first, next } = worker();
  await w.context.refreshSignals();
  w.local.signalSnapshot.checkedAt = Date.now() - 7 * 60000;
  data.items = [first, next];
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  const create = w.context.chrome.notifications.create;
  w.context.chrome.notifications.create = async () => { throw new Error('desktop waking'); };
  await w.events.startup();
  await finishPublicResume(w);
  const change = w.context.RadarSchedule.changes(w.local.scheduleSnapshot)[0];
  const id = w.context.RadarSchedule.notificationId(change);
  assert.equal(w.local.pendingNotifications[0].id, id);
  w.context.chrome.notifications.create = create;
  await w.events.alarm({ name: 'codex-reset-radar-public-delivery' });
  assert.ok(w.notifications[id]);
  assert.equal(w.local.pendingNotifications.length, 0);
});
