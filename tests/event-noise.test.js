const test = require('node:test');
const assert = require('node:assert/strict');
global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
const News = require('../src/core/news');
const Events = require('../src/core/events');
const Settings = require('../src/core/settings');
const { makeWorker, json } = require('./helpers/worker');
const now = Date.parse('2026-09-28T18:00:00Z');
const settings = Settings.sanitize({ notifyHints: true, quietHoursEnabled: false });
const post = (text, id = '951', age = 60000, author = 'thsottiaux') => ({ id, text, author,
  createdAt: new Date(now - age).toISOString(), source: { id: 'codex-lead', weight: 1 }, url: `https://x.com/${author}/status/${id}` });
const opts = { now };

test('vague event reactions are excluded even with launch wording or a dated parent', () => {
  for (const text of ["It's a good devday, sir!", 'DevDay will be fun.', 'DevDay soon. Introducing new Codex tools.',
    'Our developer conference starts soon.', 'DevDay 2026!', 'See you at DevDay next week!', 'DevDay timezone UTC+05:30.']) {
    const item = post(text);
    assert.equal(Signals.classifyHint(item, opts).candidate, false, text);
    assert.equal(Events.resolve(item), null, text);
  }
  const parent = { id: '950', targetId: '951', relation: 'conversation-before', text: 'DevDay on September 29, 2026 at 10am PT.', url: 'https://x.com/OpenAI/status/950' };
  for (const text of ['👀', 'Excited!', 'See you soon!']) {
    const item = { ...post(text), replyContext: parent };
    assert.equal(Signals.classifyHint(item, opts).candidate, false);
    assert.equal(Events.resolve(item), null);
  }
  const reply = { ...post('Tomorrow at 10am PT.'), replyContext: parent };
  assert.equal(Signals.classifyHint(reply, opts).topic, 'event');
  assert.equal(Events.resolve(reply).keynoteAt, Date.parse('2026-09-29T17:00:00Z'));
});

test('dates, weekdays and clock times qualify; reset promises and metaphors retain priority', () => {
  for (const text of ['DevDay Tuesday.', 'DevDay at 10am PT.', 'DevDay September 29, 2026.'])
    assert.equal(Signals.classifyHint(post(text), opts).topic, 'event');
  for (const text of ['At DevDay we will reset.', 'At DevDay we will reset Codex usage limits.'])
    assert.equal(Signals.classify(post(text), opts).actionable, true, text);
  for (const text of ['DevDay is exciting. Burn those tokens', 'At DevDay we may refuel Codex soon.', 'DevDay tomorrow. Maybe we should dust off the reset button.']) {
    const hint = Signals.classifyHint(post(text), opts);
    assert.equal(hint.candidate, true, text);
    assert.equal(hint.topic, undefined, text);
  }
});

test('reset news sorts before newer events and launches', () => {
  const recent = (text, id, age) => ({ ...post(text, id), createdAt: new Date(Date.now() - age).toISOString() });
  const entries = News.list({ reports: [recent('Resets all propagated.', '960', 30000)] },
    { items: [recent('DevDay tomorrow.', '961', 1000), recent('Introducing GPT-7.', '962', 2000), recent('Burn those tokens', '963', 60000)] }, settings);
  assert.deepEqual(entries.slice(0, 2).map(entry => entry.item.id), ['960', '963']);
});

test('lead event news cannot hide active resets from another enabled public source', () => {
  const item = { ...post('We will reset Codex usage limits soon.', '964'), createdAt: new Date().toISOString(), source: { id: 'openai-status', weight: 1 } };
  item.assessment = Signals.classify(item);
  const event = { ...post('DevDay tomorrow.', '965'), createdAt: new Date().toISOString() };
  const entries = News.list({ activeSignals: [item] }, { items: [event] }, settings);
  assert.equal(entries[0].item.id, '964');
});

test('same-event posts group under one banner with related originals preserved', () => {
  const a = post('DevDay September 29, 2026 at 10am PT.'), b = post('See you at DevDay Tuesday!', '952', 30000, 'reach_vb');
  const cache = Events.reconcile([], [a, b, post('DevDay is exciting!', '953', 10000)], opts);
  assert.equal(cache.length, 2);
  const pins = Events.pinned(null, { events: cache }, settings, opts);
  assert.equal(pins.length, 1);
  assert.deepEqual(pins[0].related.map(item => item.id), ['952', '951']);
});

test('equivalent schedules do not alert twice; a clock change and cancellation do', () => {
  const a = post('DevDay September 29, 2026 at 10am PT.');
  let state = Events.alerts(null, [], [a], opts);
  assert.equal(Events.notices(state)[0].kind, 'scheduled');
  const b = post('DevDay Tuesday at 17:00 UTC.', '952', 40000, 'OpenAI');
  state = Events.alerts(state, [], [b], opts);
  assert.equal(Events.notices(state)[0].id, 'event:951');
  const c = post('DevDay keynote moved to September 29, 2026 at 11am PT.', '953', 30000);
  state = Events.alerts(state, [], [c], opts);
  assert.equal(Events.notices(state)[0].kind, 'changed');
  assert.equal(Events.notices(state)[0].event.keynoteAt, Date.parse('2026-09-29T18:00:00Z'));
  const d = post('DevDay is cancelled.', '954', 10000, 'OpenAI');
  state = Events.alerts(state, [], [d], opts);
  assert.equal(Events.notices(state)[0].kind, 'cancelled');
  state = Events.alerts(state, [], [a, b, c], opts);
  assert.equal(Events.notices(state)[0].id, 'event:954');
});

test('date-only reminders and worker rechecks do not erase revised precise schedules', () => {
  const a = post('DevDay keynote moved to September 29, 2026 at 11am PT.');
  let state = Events.alerts(null, [], [a], opts);
  state = Events.alerts(state, [], [post('DevDay September 29, 2026!', '952', 10000)], opts);
  state = Events.alerts(state, [], [], opts);
  assert.equal(Events.notices(state)[0].id, 'event:951');
  assert.equal(state.entries['devday-2026'].current.keynoteAt, Date.parse('2026-09-29T18:00:00Z'));
});

test('bounded related-post retention keeps the evidence for an exact revised schedule', () => {
  const a = post('DevDay keynote moved to September 29, 2026 at 11am PT.');
  const reminders = Array.from({ length: 40 }, (_, index) => post('DevDay September 29, 2026!', String(1000 + index), 50000 - index * 100));
  const cache = Events.reconcile([], [a, ...reminders], opts);
  assert.equal(cache.length, 30);
  const pinned = Events.pinned(null, { events: cache }, settings, opts)[0];
  assert.equal(pinned.keynoteAt, Date.parse('2026-09-29T18:00:00Z'));
});

test('cached events seed notification baselines silently and mixed reset posts never add an event toast', () => {
  const a = post('DevDay September 29, 2026 at 10am PT.');
  let state = Events.alerts(undefined, [a], [a], opts);
  assert.equal(Events.notices(state).length, 0);
  state = Events.alerts(state, [], [post('DevDay tomorrow at 10am PT.', '952', 10000)], opts);
  assert.equal(Events.notices(state).length, 0);
  state = Events.alerts(undefined, [], [post('DevDay tomorrow at 10am PT. We will reset Codex usage limits.')], opts);
  assert.equal(Events.notices(state).length, 0);
});

test('a generic event reschedule and undated cancellation stay associated with the original event', () => {
  const a = post('OpenAI livestream October 6, 2026 from 10am to 5pm PT.');
  const b = post('OpenAI livestream moved to October 7, 2026 from 10am to 5pm PT.', '952', 20000);
  const c = post('OpenAI livestream is cancelled.', '953', 10000);
  let state = Events.alerts(null, [], [a], opts);
  state = Events.alerts(state, [], [b], opts);
  assert.equal(Object.keys(state.entries).length, 1);
  assert.equal(Events.notices(state)[0].kind, 'changed');
  state = Events.alerts(state, [], [c], opts);
  assert.equal(Events.notices(state)[0].kind, 'cancelled');
  assert.equal(Events.pinned(null, { events: Events.reconcile([], [a,b,c], opts) }, settings, opts).filter(event => !event.officialOnly).length, 0);
});

test('a postponement with a replacement date remains pinned and equivalent timezone wording stays silent', () => {
  const a = post('OpenAI livestream October 6, 2026 from 10am to 5pm PT.');
  const b = post('OpenAI livestream postponed to October 7, 2026 from 10am to 5pm PT.', '952', 30000);
  let state = Events.alerts(null, [], [a], opts);
  state = Events.alerts(state, [], [b], opts);
  assert.equal(Events.notices(state)[0].kind, 'changed');
  assert.equal(Events.pinned(null, { events: [a,b] }, settings, opts).filter(event => !event.officialOnly).length, 1);
  const c = post('OpenAI livestream October 8, 2026 at 2am KST.', '953', 10000, 'reach_vb');
  state = Events.alerts(state, [], [c], opts);
  assert.equal(Object.keys(state.entries).length, 1);
  assert.equal(Events.notices(state)[0].id, 'event:952');
});

function feedWorker(extra = {}) {
  let sequence = 0, content = [];
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorLeadSource: true, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false, notifyHints: true, quietHoursEnabled: false }, ...extra },
    fetcher: async () => json({ items: content }) });
  w.posts = texts => { content = texts.map(text => ({ external_id: String(980 + sequence++), content: text,
    published_at: new Date(Date.now() - 60000 + sequence * 100).toISOString(), metadata: { author_user_name: 'thsottiaux' } })); };
  return w;
}
const futureDate = () => new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

test('worker sends initial event once, suppresses repeated dates and delivers meaningful updates with original links', async () => {
  const w = feedWorker();
  w.posts([`OpenAI livestream ${futureDate()} at 10am PT.`]);
  await w.context.refreshSignals();
  assert.ok(w.notifications['event:980']);
  assert.match(w.notifications['event:980'].message, /리셋 확정이 아닙니다/);
  w.posts([`OpenAI livestream ${futureDate()} at 10am PT.`]);
  await w.context.refreshSignals();
  assert.equal(Object.keys(w.local.notificationHistory).length, 1);
  w.posts([`OpenAI livestream ${futureDate()} now at 11am PT.`]);
  await w.context.refreshSignals();
  assert.ok(w.notifications['event:982']);
  assert.match(w.notifications['event:982'].title, /일정 변경/);
  await w.events.notificationClick('event:982');
  assert.equal(w.tabs.at(-1).url, 'https://x.com/thsottiaux/status/982');
  w.posts(['OpenAI livestream is cancelled.']);
  await w.context.refreshSignals();
  assert.ok(w.notifications['event:983']);
  assert.match(w.notifications['event:983'].title, /취소/);
});

test('event queue survives delivery failure and restart; replacement drops stale schedule alerts', async () => {
  const w = feedWorker();
  w.context.chrome.notifications.create = async () => { throw new Error('unavailable'); };
  w.posts([`OpenAI livestream ${futureDate()} at 10am PT.`]);
  await w.context.refreshSignals();
  assert.equal(w.local.pendingNotifications[0].id, 'event:980');
  assert.equal(w.local.notificationHistory?.['event:980'], undefined);
  w.posts([`OpenAI livestream ${futureDate()} now at 11am PT.`]);
  await w.context.refreshSignals();
  assert.deepEqual(w.local.pendingNotifications.map(item => item.id), ['event:981']);
  const restarted = makeWorker({ stored: w.local });
  await restarted.context.revalidateCachedSignals(0);
  await restarted.context.flushPendingNotifications();
  await restarted.context.flushPendingNotifications();
  assert.ok(restarted.notifications['event:981']);
  assert.equal(restarted.local.pendingNotifications.length, 0);
  assert.equal(Object.keys(restarted.local.notificationHistory).length, 1);
});

test('event opt-out, old posts and old per-tweet event queues cannot produce surprise notifications', async () => {
  const off = feedWorker({ settings: { ...settings, monitorAccount: false, notifyHints: false } });
  off.posts([`OpenAI livestream ${futureDate()} at 10am PT.`]);
  await off.context.refreshSignals();
  assert.equal(Object.keys(off.notifications).length, 0);
  const old = { ...post(`OpenAI livestream ${futureDate()} at 10am PT.`), createdAt: new Date(Date.now() - 4 * 86400000).toISOString() };
  const w = makeWorker({ stored: { settings, hintSnapshot: { items: [old] },
    pendingNotifications: [{ id: 'hint:951', options: {}, queuedAt: Date.now() }] } });
  await w.context.revalidateCachedSignals(0);
  await w.context.flushPendingNotifications();
  assert.equal(w.local.pendingNotifications.length, 0);
  assert.equal(Events.notices(w.local.hintSnapshot.eventAlerts).length, 0);
  assert.equal(Object.keys(w.notifications).length, 0);
});
