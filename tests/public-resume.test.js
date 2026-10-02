const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json } = require('./helpers/worker');
const HOUR = 3600000;
const post = (text, id = '200', age = 0) => ({ id, entityId: id, text, author: 'thsottiaux',
  createdAt: new Date(Date.now() - age * HOUR).toISOString(), url: `https://x.com/thsottiaux/status/${id}`,
  source: { id: 'codex-lead', weight: 1 } });
function publicWorker(overrides = {}) {
  const source = { fail: false, items: [], direct: [] };
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorSignals: true,
    monitorLeadSource: true, monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false,
    notifyHints: true, quietHoursEnabled: false, ...overrides } }, fetcher: async () => {
    if (source.fail) throw new Error('offline');
    return json({ items: source.items.map(item => ({ external_id: item.id, content: item.text,
      published_at: item.createdAt, metadata: { author_user_name: item.author } })) });
  } });
  let directReads = 0;
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => {
    directReads++;
    return Array.isArray(source.direct) ? { items: source.direct, diagnostics: { timelines:
      ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai'].map(author => ({ author, kind, ok: true, stopReason: 'seven-days' }))) } } : source.direct;
  } };
  return { w, source, directReads: () => directReads };
}

test('stale Tibo feed is exposed even when HTTP and another public source succeed', async () => {
  const { w, source } = publicWorker({ monitorStatusSource: true });
  source.items = [post('Old product news.', '200', 14 * 24)];
  const result = await w.context.refreshSignals({ quiet: true });
  assert.equal(result.ok, true);
  assert.equal(result.leadVerified, false);
  assert.equal(w.local.signalSnapshot.leadStatus.state, 'stale');
  assert.equal(w.local.signalSnapshot.sources.length, 2);
  assert.equal(Object.keys(w.notifications).length, 0);
});

test('optional direct X is never read while off, with lead disabled, or with public monitoring disabled', async () => {
  for (const settings of [{}, { monitorDirectX: true, monitorLeadSource: false }, { monitorDirectX: true, monitorSignals: false }]) {
    const h = publicWorker(settings);
    await h.w.context.refreshSignals(); assert.equal(h.directReads(), 0);
  }
});

test('fresh direct X results recover the missed reply when the feed lacks it; no reset forecast is invented', async () => {
  const { w, source } = publicWorker({ monitorDirectX: true });
  source.items = [post('Old product news.', '100', 14 * 24)];
  source.direct = w.context.RadarDirectX.normalize([
    { ...post('you owe us a banked reset', '101', 6), author: 'udiWertheimer', url: 'https://x.com/udiWertheimer/status/101' },
    post('OK fine. But it’s also still coming in Tuesday', '102', 2)
  ]);
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.events.startup();
  assert.equal(w.local.signalSnapshot.leadStatus.mode, 'x-page');
  assert.equal(w.local.signalSnapshot.signal, null);
  assert.equal(w.local.hintSnapshot.items[0].assessment.rule, 'reply-reset-context');
  assert.equal(w.local.hintSnapshot.items[0].assessment.eventAt, null);
  assert.ok(w.notifications['hint:102']);
  assert.match(w.notifications['hint:102'].message, /문맥 연결과 일정 대상 미확인/);
  await w.events.startup();
  assert.equal(Object.keys(w.notifications).length, 1);
  assert.equal(w.local.publicResumeCheck, undefined);
});

test('hints posted during a known three-day offline gap notify once, even with account monitoring off', async () => {
  const { w, source } = publicWorker();
  w.local.signalSnapshot = { checkedAt: Date.now() - 96 * HOUR };
  source.items = [post('Maybe we should dust off the reset button next Tuesday.', '201', 72)];
  await w.events.startup();
  assert.equal(w.local.hintSnapshot.items.length, 1);
  assert.ok(w.notifications['hint:201']);
  const count = Object.keys(w.local.notificationHistory).length;
  await w.events.startup();
  assert.equal(Object.keys(w.local.notificationHistory).length, count);
});

test('conversation-enriched date replies reach the popup candidate and notify once with scan counts', async () => {
  const { w, source } = publicWorker({ monitorDirectX: true });
  const item = post('Tuesday 👀', '301', 2);
  const parent = { ...post('you owe us a banked reset', '300', 3), author: 'someone', url: 'https://x.com/someone/status/300' };
  source.direct = { items: [w.context.RadarDirectX.conversationContext(item, { targetId: '301', rows: [parent, item] })],
    diagnostics: { posts: 16, contexts: 1, conversations: 2, conversationFailures: 0, pages: 12, stopReason: 'scan-limit' } };
  await w.events.startup();
  assert.equal(w.local.signalSnapshot.leadStatus.directScan.posts, 16);
  assert.equal(w.local.signalSnapshot.signal, null);
  assert.equal(w.local.hintSnapshot.items[0].replyContext.relation, 'conversation-before');
  assert.ok(w.notifications['hint:301']);
  const history = JSON.stringify(w.local.notificationHistory);
  await w.events.startup();
  assert.equal(JSON.stringify(w.local.notificationHistory), history);
});

test('a fresh feed cannot hide a direct reply collection permission or login failure', async () => {
  for (const [error, reason] of [['X_PERMISSION_REQUIRED', 'permission'], ['X_LOGIN_REQUIRED', 'login']]) {
    const { w, source } = publicWorker({ monitorDirectX: true });
    source.items = [post('Product news')];
    w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => { throw new Error(error); } };
    await w.context.refreshSignals();
    assert.equal(w.local.signalSnapshot.leadStatus.state, 'ok');
    assert.equal(w.local.signalSnapshot.leadStatus.directOk, false);
    assert.equal(w.local.signalSnapshot.leadStatus.directError, reason);
  }
});

test('notification preferences still govern catch-up while candidates remain visible', async () => {
  for (const settings of [{ notifyHints: false }, { notifyPublicOnResume: false }]) {
    const { w, source } = publicWorker(settings);
    w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
    source.items = [post('Maybe dust off the reset button Tuesday.', '201', 20)];
    await w.events.startup();
    assert.equal(w.local.hintSnapshot.items.length, 1);
    assert.equal(Object.keys(w.notifications).length, 0);
  }
});

test('public startup retry works independently of account monitoring and is bounded', async () => {
  const { w, source } = publicWorker();
  const alarms = [];
  w.context.chrome.alarms.create = async (name, options) => alarms.push({ name, ...options });
  source.fail = true; await w.events.startup();
  assert.ok(w.local.signalError);
  assert.ok(w.local.publicResumeCheck);
  for (let i = 0; i < 5; i++) await w.events.alarm({ name: 'codex-reset-radar-public-resume' });
  assert.equal(alarms.filter(a => a.name === 'codex-reset-radar-public-resume').length, 5);
  source.fail = false; source.items = [post('Maybe dust off the reset button Tuesday.')];
  await w.events.alarm({ name: 'codex-reset-radar-poll' });
  assert.ok(w.notifications['hint:200']);
  assert.equal(w.local.publicResumeCheck, undefined);
});

test('a public OFF change cannot be undone by a late direct X response', async () => {
  const { w } = publicWorker({ monitorDirectX: true });
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  w.context.RadarDirectX.read = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const request = w.context.refreshSignals(); await waiting;
  await w.context.saveSettings({ ...w.local.settings, monitorSignals: false });
  release([post('Maybe dust off the reset button Tuesday.')]); await request;
  assert.equal(w.local.hintSnapshot?.items.length || 0, 0);
  assert.equal(Object.keys(w.notifications).length, 0);
  assert.equal(w.local.settings.monitorSignals, false);
});

test('a failed quiet poll preserves recent evidence and exposes an error', async () => {
  const { w, source } = publicWorker(); source.items = [post('Maybe dust off the reset button Tuesday.')];
  await w.context.refreshSignals(); source.fail = true;
  await w.context.refreshSignals({ quiet: true });
  assert.equal(w.local.hintSnapshot.items.length, 1);
  assert.ok(w.local.signalError);
});

test('both missed explicit announcements notify instead of only the top-ranked one', async () => {
  const { w, source } = publicWorker();
  w.local.signalSnapshot = { checkedAt: Date.now() - 72 * HOUR };
  source.items = [post('We will reset Codex usage limits next Tuesday.', '201', 48), post('We will refill Codex usage limits next Friday.', '202', 47)];
  await w.events.startup();
  assert.ok(w.notifications['signal:201']); assert.ok(w.notifications['signal:202']);
  await w.events.notificationClick('signal:201');
  await w.events.notificationButton('signal:202', 0);
  assert.equal(w.tabs.at(-2).url, 'https://x.com/thsottiaux/status/201');
  assert.equal(w.tabs.at(-1).url, 'https://x.com/thsottiaux/status/202');
});

test('public-only refresh accepts only trusted popup/options and rejects arbitrary destinations', async () => {
  const { w } = publicWorker();
  assert.equal((await w.send({ type: 'REFRESH_SIGNALS' }, w.sender('options'))).ok, true);
  assert.equal((await w.send({ type: 'REFRESH_SIGNALS', url: 'https://evil.test' }, w.sender('popup'))).ok, false);
  assert.equal((await w.send({ type: 'REFRESH_SIGNALS' }, { id: w.runtime.id, url: 'https://x.com/thsottiaux/with_replies' })).ok, false);
});

function clock(w, at) {
  w.context.Date = class extends Date { static now() { return at.value; } };
}

test('a delayed poll after a short sleep catches up without Chrome startup', async () => {
  const { w, source } = publicWorker({ pollMinutes: 30 });
  w.local.signalSnapshot = { checkedAt: Date.now() - 45 * 60000 };
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  source.items = [post('We have now reset all Codex usage limits.', '401', 0.2)];
  await w.events.alarm({ name: 'codex-reset-radar-poll', scheduledTime: Date.now() - 15 * 60000 });
  assert.ok(w.notifications['report:401']);
  assert.equal(w.local.publicResumeCheck, undefined);
});

test('network recovery includes posts published after Chrome started but before collection succeeded', async () => {
  const { w, source } = publicWorker();
  const at = { value: Date.now() };
  clock(w, at);
  w.local.signalSnapshot = { checkedAt: at.value - HOUR };
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  source.fail = true;
  await w.events.startup();
  source.fail = false;
  source.items = [{ ...post('We have now reset all Codex usage limits.', '402'),
    createdAt: new Date(at.value + 2 * 60000).toISOString() }];
  at.value += 5 * 60000;
  await w.events.alarm({ name: 'codex-reset-radar-public-resume' });
  assert.ok(w.notifications['report:402']);
  assert.equal(w.local.pendingNotifications.length, 0);
});

test('a partial wake-up scan keeps its offline boundary across subsequent polls and worker restart', async () => {
  const { w, source } = publicWorker({ monitorDirectX: true, pollMinutes: 15 });
  const at = { value: Date.now() };
  clock(w, at);
  const since = at.value - 4 * 24 * HOUR;
  w.local.signalSnapshot = { checkedAt: since };
  source.items = [post('Product news.', '403')];
  source.direct = { items: [], diagnostics: { timelines: [] } };
  await w.events.alarm({ name: 'codex-reset-radar-poll', scheduledTime: at.value - HOUR });
  assert.equal(w.local.publicResumeCheck?.since, since);
  const resumed = makeWorker({ stored: w.local, fetcher: async () => json({ items: [] }) });
  clock(resumed, at);
  resumed.context.RadarTime = { ...resumed.context.RadarTime, isQuietHours: () => true };
  const missed = post('We have now reset all Codex usage limits.', '404', 2 * 24);
  resumed.context.RadarDirectX = { ...resumed.context.RadarDirectX, read: async () => ({ items: [missed],
    diagnostics: { timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai']
      .map(author => ({ author, kind, ok: true, stopReason: 'seven-days' }))) } }) };
  at.value += 15 * 60000;
  await resumed.events.alarm({ name: 'codex-reset-radar-poll', scheduledTime: at.value });
  assert.ok(resumed.notifications['report:404']);
  assert.equal(resumed.local.publicResumeCheck, undefined);
});

test('a rejected catch-up toast retries in quiet hours after the catch-up scan has completed', async () => {
  const { w, source } = publicWorker();
  w.local.signalSnapshot = { checkedAt: Date.now() - HOUR };
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  source.items = [post('We have now reset all Codex usage limits.', '405', 0.1)];
  const create = w.context.chrome.notifications.create;
  w.context.chrome.notifications.create = async () => { throw new Error('desktop waking'); };
  await w.events.startup();
  assert.equal(w.local.publicResumeCheck, undefined);
  assert.equal(w.local.pendingNotifications.length, 1);
  w.context.chrome.notifications.create = create;
  await w.events.alarm({ name: 'codex-reset-radar-poll', scheduledTime: Date.now() });
  assert.ok(w.notifications['report:405']);
  assert.equal(w.local.pendingNotifications.length, 0);
});

test('ordinary alarm jitter does not override quiet hours or create a recovery window', async () => {
  const { w, source } = publicWorker({ pollMinutes: 30 });
  w.local.signalSnapshot = { checkedAt: Date.now() - 31 * 60000 };
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  source.items = [post('We have now reset all Codex usage limits.', '406', 0.1)];
  await w.events.alarm({ name: 'codex-reset-radar-poll', scheduledTime: Date.now() - 60000 });
  assert.equal(w.local.publicResumeCheck, undefined);
  assert.equal(Object.keys(w.notifications).length, 0);
  assert.equal(w.local.pendingNotifications.length, 1);
});

test('a prolonged partial recovery does not override quiet hours for subsequent ordinary posts', async () => {
  const { w, source } = publicWorker({ monitorDirectX: true });
  const at = { value: Date.now() };
  clock(w, at);
  w.local.signalSnapshot = { checkedAt: at.value - 24 * HOUR };
  source.direct = { items: [], diagnostics: { timelines: [] } };
  source.items = [post('We have now reset all Codex usage limits.', '407', 1)];
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.events.startup();
  assert.ok(w.notifications['report:407']);
  assert.equal(w.local.publicResumeCheck.collectedAt, at.value);
  at.value += HOUR;
  source.items.push({ ...post('We have now reset all Codex usage limits.', '408'),
    createdAt: new Date(at.value - 5 * 60000).toISOString() });
  await w.events.alarm({ name: 'codex-reset-radar-public-resume' });
  assert.equal(w.notifications['report:408'], undefined);
  assert.equal(w.local.publicAlertState.entries['408'].catchUp, false);
});

test('public delivery retries survive worker restart and do not require another source fetch', async () => {
  const { w, source } = publicWorker();
  w.local.signalSnapshot = { checkedAt: Date.now() - HOUR };
  source.items = [post('We have now reset all Codex usage limits.', '409', 0.1)];
  w.context.chrome.notifications.create = async () => { throw new Error('desktop not ready'); };
  await w.events.startup();
  assert.equal(w.local.notificationHistory?.['report:409'], undefined);
  const resumed = makeWorker({ stored: w.local, fetcher: async () => { assert.fail('Delivery must not fetch'); } });
  resumed.context.RadarTime = { ...resumed.context.RadarTime, isQuietHours: () => true };
  await resumed.events.alarm({ name: 'codex-reset-radar-public-delivery' });
  assert.ok(resumed.notifications['report:409']);
  assert.equal(resumed.local.pendingNotifications.length, 0);
  resumed.context.chrome.notifications.create = async () => assert.fail('Must not repeat an accepted alert');
  await resumed.events.alarm({ name: 'codex-reset-radar-public-delivery' });
});

test('public delivery backoff is bounded and does not extend the original queue expiry', async () => {
  const { w, source } = publicWorker();
  source.items = [post('We have now reset all Codex usage limits.', '410', 0.1)];
  const alarms = [];
  w.context.chrome.alarms.create = async (name, options) => alarms.push({ name, ...options });
  w.context.chrome.notifications.create = async () => { throw new Error('notifications denied'); };
  await w.context.refreshSignals();
  const queuedAt = w.local.pendingNotifications[0].queuedAt;
  for (let i = 0; i < 7; i++) await w.events.alarm({ name: 'codex-reset-radar-public-delivery' });
  assert.deepEqual(alarms.filter(a => a.name === 'codex-reset-radar-public-delivery').map(a => a.delayInMinutes), [1, 2, 5, 10]);
  assert.equal(w.local.pendingNotifications[0].queuedAt, queuedAt);
  assert.equal(w.local.pendingNotifications[0].deliveryAttempts, 5);
  w.local.pendingNotifications[0].queuedAt -= 25 * HOUR;
  await w.events.alarm({ name: 'codex-reset-radar-public-delivery' });
  assert.equal(w.local.pendingNotifications.length, 0);
});

test('delivery retry still honors changed category and resume notification preferences', async () => {
  for (const preference of ['notifyOfficialReset', 'notifyPublicOnResume']) {
    const { w, source } = publicWorker();
    w.local.signalSnapshot = { checkedAt: Date.now() - HOUR };
    source.items = [post('We have now reset all Codex usage limits.', '411', 0.1)];
    w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
    w.context.chrome.notifications.create = async () => { throw new Error('desktop not ready'); };
    await w.events.startup();
    w.local.settings[preference] = false;
    w.context.chrome.notifications.create = async () => assert.fail('Preference must be respected');
    await w.events.alarm({ name: 'codex-reset-radar-public-delivery' });
    assert.equal(w.local.pendingNotifications.length, preference === 'notifyPublicOnResume' ? 1 : 0);
  }
});

test('an overdue collection retry after sleep also detects recovery before the regular poll is due', async () => {
  const { w, source } = publicWorker({ monitorDirectX: true, pollMinutes: 30 });
  w.local.signalSnapshot = { checkedAt: Date.now() - 10 * 60000 };
  w.local.publicRetryCheck = { attempts: 0, startedAt: w.local.signalSnapshot.checkedAt };
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  source.items = [post('We have now reset all Codex usage limits.', '412', 0.05)];
  await w.events.alarm({ name: 'codex-reset-radar-public-retry', scheduledTime: Date.now() - 8 * 60000 });
  assert.ok(w.notifications['report:412']);
});

test('a second sleep during a partial recovery opens a new wake-up window without losing the original boundary', async () => {
  const { w, source } = publicWorker({ monitorDirectX: true });
  const at = { value: Date.now() };
  clock(w, at);
  const since = at.value - 24 * HOUR;
  w.local.signalSnapshot = { checkedAt: since };
  source.items = [post('Product news.', '413')];
  source.direct = { items: [], diagnostics: { timelines: [] } };
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.events.startup();
  assert.equal(w.local.publicResumeCheck.collectedAt, at.value);
  at.value += 2 * HOUR;
  source.items.push({ ...post('We have now reset all Codex usage limits.', '414'),
    createdAt: new Date(at.value - 10 * 60000).toISOString() });
  await w.events.alarm({ name: 'codex-reset-radar-public-resume', scheduledTime: at.value - 90 * 60000 });
  assert.ok(w.notifications['report:414']);
  assert.equal(w.local.publicResumeCheck.since, since);
});
