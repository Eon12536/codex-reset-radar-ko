const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, FAKE_TOKEN, RAW_USAGE, json, finishPublicResume } = require('./helpers/worker');
const START = Date.parse('2026-10-06T03:00:00Z');
const HOUR = 3600000;
const EXPIRY = 'codex-reset-radar-credit-expiry';
const WAKE = 'codex-reset-radar-wake-check';

function harness(stored = {}) {
  let now = START;
  const source = { fail: false, creditsStatus: 200, count: 1, expires: [START + 48 * HOUR], posts: [] };
  const w = makeWorker({ stored: { ...stored, settings: { monitorAccount: true,
    monitorSignals: false, quietHoursEnabled: false, notifyAdvice: false,
    notifyAccountReset: false, ...stored.settings } }, fetcher: async url => {
    if (source.fail) throw new Error('offline');
    if (url.endsWith('/auth/session')) return json({ accessToken: FAKE_TOKEN });
    if (url.endsWith('/usage')) return json(RAW_USAGE);
    if (url.endsWith('/rate-limit-reset-credits')) return json({ available_count: source.count,
      credits: source.count ? source.expires.map((at, i) => ({ id: 'credit-' + i, status: 'available', expires_at: new Date(at).toISOString() })) : [] }, source.creditsStatus);
    return json({ items: source.posts });
  } });
  w.context.Date = class extends Date { static now() { return now; } };
  return { ...w, source, clock: value => { now = value; },
    refresh: () => w.context.pollAll({ quiet: true }),
    alarm: name => w.context.chrome.alarms.get(name) };
}

test('a verified credit schedules its own exact 24-hour warning and a lightweight wake check', async () => {
  const h = harness(); await h.refresh();
  assert.equal((await h.alarm(EXPIRY)).when, START + 24 * HOUR);
  assert.equal((await h.alarm(WAKE)).periodInMinutes, 1);
  assert.equal(Object.keys(h.notifications).length, 0);
});

test('the expiry alarm rechecks current credits and notifies once without opening the popup', async () => {
  const h = harness(); await h.refresh();
  const before = h.requests.length; h.clock(START + 24 * HOUR);
  h.context.chrome.notifications.create = async (id, options) => {
    assert.ok(h.requests.slice(before).some(request => request.url.endsWith('/rate-limit-reset-credits')));
    h.notifications[id] = structuredClone(options);
  };
  await h.events.alarm({ name: EXPIRY, scheduledTime: START + 24 * HOUR });
  await h.events.alarm({ name: EXPIRY, scheduledTime: START + 24 * HOUR });
  assert.equal(Object.keys(h.notifications).length, 1);
  assert.match(Object.keys(h.notifications)[0], /^expiry:/);
  assert.equal(await h.alarm(EXPIRY), undefined);
});

test('a spent credit cancels its scheduled warning after a fresh automatic read', async () => {
  const h = harness(); await h.refresh();
  h.source.count = 0; h.clock(START + 24 * HOUR);
  await h.events.alarm({ name: EXPIRY, scheduledTime: START + 24 * HOUR });
  assert.equal(Object.keys(h.notifications).length, 0);
  assert.equal(await h.alarm(EXPIRY), undefined);
});

test('an offline expiry check retries automatically and never notifies from unverified private data', async () => {
  const h = harness(); await h.refresh();
  h.source.fail = true; h.clock(START + 24 * HOUR);
  await h.events.alarm({ name: EXPIRY, scheduledTime: START + 24 * HOUR });
  assert.equal(Object.keys(h.notifications).length, 0);
  assert.equal((await h.alarm(EXPIRY)).when, START + 24 * HOUR + 5 * 60000);
  h.source.fail = false; h.clock(START + 24 * HOUR + 5 * 60000);
  await h.events.alarm({ name: EXPIRY, scheduledTime: START + 24 * HOUR + 5 * 60000 });
  assert.equal(Object.keys(h.notifications).length, 1);
});

test('wake ticks only inspect local timing during ordinary browser activity', async () => {
  const h = harness(); await h.refresh();
  await h.events.alarm({ name: WAKE, scheduledTime: START });
  const before = h.requests.length;
  h.clock(START + 60000); await h.events.alarm({ name: WAKE, scheduledTime: START + 60000 });
  assert.equal(h.requests.length, before);
});

test('a partial credit failure preserves the warning across worker restart and retries without the popup', async () => {
  const h = harness(); await h.refresh();
  h.source.creditsStatus = 500; h.clock(START + 24 * HOUR);
  await h.events.alarm({ name: EXPIRY, scheduledTime: START + 24 * HOUR });
  assert.equal(h.local.accountSnapshot.credits, null);
  assert.equal((await h.alarm(EXPIRY)).when, START + 24 * HOUR + 5 * 60000);
  assert.equal(Object.keys(h.notifications).length, 0);
  const resumed = harness(h.local); resumed.clock(START + 24 * HOUR + 5 * 60000);
  await resumed.events.alarm({ name: EXPIRY, scheduledTime: START + 24 * HOUR + 5 * 60000 });
  assert.equal(Object.keys(resumed.notifications).length, 1);
});

test('worker initialization preserves a future expiry retry deadline instead of postponing it', async () => {
  const h = harness(); await h.refresh();
  const resumed = harness(h.local); resumed.clock(START + 24 * HOUR + 4 * 60000);
  const deadline = START + 24 * HOUR + 5 * 60000;
  await resumed.context.chrome.alarms.create(EXPIRY, { when: deadline });
  await resumed.context.ensureSecurity();
  assert.equal((await resumed.alarm(EXPIRY)).when, deadline);
});

test('an already delivered warning is not restored from a watch left behind before a worker crash', async () => {
  const h = harness(); await h.refresh(); h.clock(START + 24 * HOUR);
  const watch = structuredClone(h.local.creditExpiryWatch);
  await h.events.alarm({ name: EXPIRY, scheduledTime: START + 24 * HOUR });
  h.local.creditExpiryWatch = watch;
  h.local.accountSnapshot.credits = null;
  const restarted = harness(h.local); restarted.clock(START + 24 * HOUR + 60000);
  await restarted.context.ensureSecurity();
  assert.equal(await restarted.alarm(EXPIRY), undefined);
  assert.equal(restarted.local.creditExpiryWatch, undefined);
});

test('multiple expiry dates each schedule their own warning even while an earlier warned credit remains available', async () => {
  const h = harness(); h.source.count = 2; h.source.expires.push(START + 50 * HOUR);
  await h.refresh(); h.clock(START + 24 * HOUR);
  await h.events.alarm({ name: EXPIRY, scheduledTime: START + 24 * HOUR });
  assert.equal(Object.keys(h.notifications).length, 1);
  assert.equal((await h.alarm(EXPIRY)).when, START + 26 * HOUR);
  h.clock(START + 26 * HOUR);
  await h.events.alarm({ name: EXPIRY, scheduledTime: START + 26 * HOUR });
  assert.equal(Object.keys(h.notifications).length, 2);
  assert.equal(await h.alarm(EXPIRY), undefined);
});

test('expiry opt-out cancels its stored watch and late alarm without another private request', async () => {
  const h = harness(); await h.refresh();
  await h.context.saveSettings({ ...h.local.settings, notifyCreditExpiry: false });
  assert.equal(await h.alarm(EXPIRY), undefined);
  assert.equal(h.local.creditExpiryWatch, undefined);
  const before = h.requests.length;
  await h.events.alarm({ name: EXPIRY, scheduledTime: START + 24 * HOUR });
  assert.equal(h.requests.length, before);
});

test('an unknown credit expiry never schedules or fabricates a one-day warning', async () => {
  const h = harness(); h.source.expires = [];
  await h.refresh();
  assert.equal(await h.alarm(EXPIRY), undefined);
  assert.equal(Object.keys(h.notifications).length, 0);
});

test('a missed wake tick scans new credits before notifying even with public monitoring off', async () => {
  const h = harness(); await h.refresh();
  await h.events.alarm({ name: WAKE, scheduledTime: START });
  h.clock(START + 20 * 60000); h.source.count = 2;
  h.source.expires.push(START + 72 * HOUR);
  h.context.RadarTime = { ...h.context.RadarTime, isQuietHours: () => true };
  await h.events.alarm({ name: WAKE, scheduledTime: START + 60000 });
  assert.equal(Object.keys(h.notifications).length, 1);
  assert.match(Object.keys(h.notifications)[0], /^banked:/);
});

test('the resume preference continues to govern quiet-hours Banked delivery', async () => {
  const h = harness({ settings: { notifyRecoveryOnResume: false } }); await h.refresh();
  await h.events.alarm({ name: WAKE, scheduledTime: START });
  h.clock(START + 20 * 60000); h.source.count = 2; h.source.expires.push(START + 72 * HOUR);
  h.context.RadarTime = { ...h.context.RadarTime, isQuietHours: () => true };
  await h.events.alarm({ name: WAKE, scheduledTime: START + 60000 });
  assert.equal(Object.keys(h.notifications).length, 0);
  assert.equal(h.local.pendingNotifications.length, 1);
});

test('wake retries a failed credits read even when the quota endpoint already succeeded', async () => {
  const h = harness(); h.source.count = 0; await h.refresh();
  await h.events.alarm({ name: WAKE, scheduledTime: START });
  h.context.RadarTime = { ...h.context.RadarTime, isQuietHours: () => true };
  h.source.count = 1; h.source.creditsStatus = 500; h.clock(START + 20 * 60000);
  await h.events.alarm({ name: WAKE, scheduledTime: START + 60000 });
  assert.ok(h.local.resumeCheck);
  assert.ok(await h.alarm('codex-reset-radar-resume'));
  assert.equal(Object.keys(h.notifications).length, 0);
  h.source.creditsStatus = 200; h.clock(START + 21 * 60000);
  await h.events.alarm({ name: 'codex-reset-radar-resume', scheduledTime: START + 21 * 60000 });
  assert.equal(Object.keys(h.notifications).length, 1);
  assert.match(Object.keys(h.notifications)[0], /^banked:/);
  assert.equal(h.local.resumeCheck, undefined);
});

test('wake collection finds fresh public news before the normal poll is due and sends it after the startup grace', async () => {
  const h = harness({ settings: { monitorAccount: false, monitorSignals: true, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false } });
  await h.refresh(); await h.events.alarm({ name: WAKE, scheduledTime: START });
  h.clock(START + 20 * 60000);
  h.source.posts = [{ external_id: '904', content: 'We have now reset all Codex usage limits.',
    published_at: new Date(START + 10 * 60000).toISOString(), metadata: { author_user_name: 'thsottiaux' } }];
  await h.events.alarm({ name: WAKE, scheduledTime: START + 60000 });
  assert.equal(h.local.signalSnapshot.reports[0].id, '904');
  assert.equal(Object.keys(h.notifications).length, 0);
  await finishPublicResume(h);
  assert.ok(h.notifications['report:904']);
  await h.events.alarm({ name: WAKE, scheduledTime: START + 60000 });
  assert.equal(Object.keys(h.notifications).length, 1);
});

test('startup catches a missed 24-hour expiry warning without requiring the popup', async () => {
  const h = harness(); await h.refresh();
  const resumed = harness(h.local); resumed.clock(START + 25 * HOUR);
  resumed.context.RadarTime = { ...resumed.context.RadarTime, isQuietHours: () => true };
  await resumed.events.startup();
  assert.equal(Object.keys(resumed.notifications).length, 1);
  assert.match(Object.keys(resumed.notifications)[0], /^expiry:/);
});

test('initialization repairs lost automatic alarms without resetting an existing poll deadline', async () => {
  const h = harness();
  await h.context.chrome.alarms.create('codex-reset-radar-poll', { when: START + 17 * 60000, periodInMinutes: 30 });
  await h.context.ensureSecurity();
  assert.equal((await h.alarm('codex-reset-radar-poll')).when, START + 17 * 60000);
  assert.equal((await h.alarm(WAKE)).periodInMinutes, 1);
});

test('a delayed delivery alarm checks edited public news after sleep before replaying old pending alerts', async () => {
  const h = harness({ settings: { monitorAccount: false, monitorSignals: true, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false } });
  h.source.posts = [{ external_id: '903', content: 'We will reset Codex usage limits tomorrow.',
    published_at: new Date(START).toISOString(), metadata: { author_user_name: 'thsottiaux' } }];
  h.context.RadarTime = { ...h.context.RadarTime, isQuietHours: () => true };
  await h.refresh(); assert.equal(h.local.pendingNotifications.length, 1);
  h.source.posts[0].content = 'No reset tomorrow.';
  h.clock(START + 20 * 60000);
  await h.events.alarm({ name: 'codex-reset-radar-public-delivery', scheduledTime: START + 60000 });
  await finishPublicResume(h);
  assert.equal(Object.keys(h.notifications).length, 0);
  assert.equal(h.local.pendingNotifications.length, 0);
});

test('desktop delivery waits for an in-flight wake scan before replaying a retracted cached announcement', async () => {
  const h = harness({ settings: { monitorAccount: false, monitorSignals: true, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false } });
  h.source.posts = [{ external_id: '905', content: 'We will reset Codex usage limits tomorrow.',
    published_at: new Date(START).toISOString(), metadata: { author_user_name: 'thsottiaux' } }];
  h.context.RadarTime = { ...h.context.RadarTime, isQuietHours: () => true };
  await h.refresh(); await h.events.alarm({ name: WAKE, scheduledTime: START });
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const fetch = h.context.fetch;
  h.context.fetch = async (...args) => { started(); await gate; return fetch(...args); };
  h.clock(START + 20 * 60000);
  const wake = h.events.alarm({ name: WAKE, scheduledTime: START + 60000 });
  await waiting;
  h.source.posts[0].content = 'No reset tomorrow.'; h.clock(START + 21 * 60000);
  const delivery = h.events.alarm({ name: 'codex-reset-radar-public-delivery', scheduledTime: START + 21 * 60000 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(Object.keys(h.notifications).length, 0);
  release(); await Promise.all([wake, delivery]);
  assert.equal(Object.keys(h.notifications).length, 0);
  assert.equal(h.local.pendingNotifications.length, 0);
});
