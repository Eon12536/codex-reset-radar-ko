const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, FAKE_TOKEN, RAW_USAGE, json } = require('./helpers/worker');
const START = Date.parse('2026-10-01T03:00:00Z');
const DAY = 86400000;
const jwt = (user, account, extra = {}) => 'e30.' + Buffer.from(JSON.stringify({ sub: user,
  'https://api.openai.com/auth': { chatgpt_account_id: account }, ...extra })).toString('base64url') + '.signature';
const credits = (count, ids) => ({ available_count: count, credits: (ids || []).map(id => ({ id, status: 'available' })) });

function harness(stored = {}) {
  const source = { token: FAKE_TOKEN, usage: structuredClone(RAW_USAGE), credits: credits(0, []), usageStatus: 200, creditsStatus: 200 };
  const h = makeWorker({ stored: { ...stored, settings: { monitorAccount: true, monitorSignals: false,
    notifyAdvice: false, notifyCreditExpiry: false, quietHoursEnabled: false, ...stored.settings } },
  fetcher(url) {
    if (url.endsWith('/auth/session')) return json({ accessToken: source.token });
    if (url.endsWith('/usage')) return json(source.usage, source.usageStatus);
    if (url.endsWith('/rate-limit-reset-credits')) return json(source.credits, source.creditsStatus);
    throw new Error('Unexpected request');
  }});
  let now = START;
  h.context.Date = class extends Date { static now() { return now; } };
  const delivered = [], badges = [], alarms = [];
  const create = h.context.chrome.notifications.create;
  h.context.chrome.notifications.create = async (id, options) => { await create(id, options); delivered.push({ id, ...options }); };
  h.context.chrome.action.setBadgeText = async ({ text }) => badges.push(text);
  h.context.chrome.alarms.create = async (name, options) => alarms.push({ name, ...options });
  return { ...h, source, delivered, badges, alarms, clock(value) { now = value; },
    refresh: () => h.send({ type: 'REFRESH_NOW' }, h.sender('popup')),
    save: settings => h.send({ type: 'SAVE_SETTINGS', settings: { ...h.local.settings, ...settings } }, h.sender('options')) };
}

test('first inventory and upgrade cache never turn already-owned credits into a new grant', async () => {
  const h = harness({ accountSnapshot: { credits: { availableCount: 0 }, updatedAt: START - 60000 } });
  h.source.credits = credits(3, ['old-1', 'old-2', 'old-3']);
  await h.refresh(); await h.refresh();
  assert.equal(h.local.creditGrantState.count, 3);
  assert.equal(h.delivered.length, 0);
  assert.equal(h.badges.at(-1), '75%');
  assert.ok(h.local.creditGrantState.seenIds.every(id => /^[a-f0-9]{64}$/.test(id)));
  assert.doesNotMatch(JSON.stringify(h.local.creditGrantState), /old-1|AUDIT_ONLY/);
});

test('account credit increase alerts independently of X and quota recovery, once per grant', async () => {
  const h = harness(); await h.refresh();
  h.source.credits = credits(1, ['new-1']); await h.refresh(); await h.refresh();
  assert.equal(h.delivered.length, 1);
  assert.match(h.delivered[0].id, /^banked:/);
  assert.match(h.delivered[0].title, /Banked reset \+1 지급/);
  assert.match(h.delivered[0].message, /새 리셋권 1개 확인.*총 1개/);
  assert.match(h.delivered[0].message, /사용해야/);
  assert.equal(h.delivered[0].silent, false);
  assert.equal(h.delivered[0].type, 'basic');
  assert.equal(h.badges.at(-1), '75%!');
  assert.equal(h.local.recoveryState.events.length, 0);
  assert.ok(h.requests.every(request => request.url.includes('chatgpt.com/')));
  h.source.credits = credits(3, ['new-1', 'new-2', 'new-3']); await h.refresh();
  assert.equal(h.delivered.length, 2);
  assert.match(h.delivered[1].title, /\+2/);
});

test('a new stable credit ID detects a grant even when simultaneous redemption keeps the total unchanged', async () => {
  const h = harness(); h.source.credits = credits(2, ['a', 'b']); await h.refresh();
  h.source.credits = { available_count: 2, credits: [ { id: 'a', status: 'redeemed' },
    { id: 'b', status: 'available' }, { id: 'c', status: 'available' } ] };
  await h.refresh();
  assert.equal(h.delivered.length, 1);
  assert.match(h.delivered[0].title, /\+1/);
  assert.equal(h.local.creditGrantState.count, 2);
});

test('redemption, row reorder, expiry edits and a previously seen ID returning never fabricate a grant', async () => {
  const h = harness(); h.source.credits = credits(2, ['a', 'b']); await h.refresh();
  h.source.credits = credits(2, ['b', 'a']); h.source.credits.credits[0].expires_at = '2026-10-03T00:00:00Z'; await h.refresh();
  h.source.credits = credits(1, ['b']); await h.refresh();
  // Same total, same previously seen credit: not an independent arrival.
  h.source.credits = credits(1, ['a']); await h.refresh();
  h.source.credits = credits(0, []); await h.refresh();
  h.source.credits = credits(2, ['a', 'b']); await h.refresh();
  assert.equal(h.delivered.length, 0);
});

test('count-only inventories work; adding ID support later or incomplete rows does not produce false grants', async () => {
  const h = harness(); h.source.credits = credits(2); await h.refresh();
  h.source.credits = credits(2, ['a', 'b']); await h.refresh();
  h.source.credits = credits(2, ['incomplete']); await h.refresh();
  h.source.credits = credits(2, ['a', 'b']); await h.refresh();
  assert.equal(h.delivered.length, 0);
  h.source.credits = { available_count: 3 }; await h.refresh();
  assert.equal(h.delivered.length, 1);
  h.source.credits = credits(3, ['a', 'b', 'c']); await h.refresh();
  assert.equal(h.delivered.length, 1);
});

test('after a count-only grant, complete IDs can still identify one additional arrival amid redemption', async () => {
  const h = harness(); h.source.credits = credits(1, ['a']); await h.refresh();
  h.source.credits = credits(2); await h.refresh(); assert.equal(h.delivered.length, 1);
  h.source.credits = credits(2, ['b', 'c']); await h.refresh();
  assert.equal(h.delivered.length, 2); assert.match(h.delivered[1].title, /\+1/);
  await h.refresh(); assert.equal(h.delivered.length, 2);
});

test('spending all count-only credits cannot suppress a later identified grant after restart', async () => {
  const h = harness(); await h.refresh();
  h.source.credits = { available_count: 1 }; await h.refresh();
  assert.equal(h.delivered.length, 1);
  const receipt = h.context.RadarBadge.view(h.local, h.local.settings).receipt;
  await h.send({ type: 'ACK_VISIBLE_BADGES', receipt }, h.sender('popup'));
  h.source.credits = { available_count: 0 }; await h.refresh();
  assert.equal(h.badges.at(-1), '75%');

  const restarted = harness(h.local);
  restarted.source.credits = credits(1, ['later-grant']);
  await restarted.refresh(); await restarted.refresh();
  assert.equal(restarted.delivered.length, 1);
  assert.match(restarted.delivered[0].title, /\+1/);
  assert.equal(restarted.badges.at(-1), '75%!');
  assert.equal(restarted.local.creditGrantState.events.length, 2);
});

test('failed or malformed inventories retain comparison state instead of becoming zero', async () => {
  const h = harness(); h.source.credits = credits(2); await h.refresh();
  const before = structuredClone(h.local.creditGrantState);
  h.source.creditsStatus = 500; await h.refresh();
  assert.deepEqual(h.local.creditGrantState, before);
  h.source.creditsStatus = 200;
  for (const raw of [{}, { available_count: null }, { available_count: -1 }, { available_count: 'unknown' },
    { available_count: false }, { available_count: [] }, { available_count: ' ' }, { credits: [null] }]) {
    h.source.credits = raw; await h.refresh();
    assert.deepEqual(h.local.creditGrantState, before);
  }
  h.source.credits = credits(2); await h.refresh(); assert.equal(h.delivered.length, 0);
  h.source.credits = credits(3); await h.refresh(); assert.equal(h.delivered.length, 1);
});

test('account and workspace changes start silent baselines; verified JWT rotation preserves comparison', async () => {
  const h = harness(); h.source.token = jwt('u', 'account'); h.source.usage.account_id = 'workspace'; await h.refresh();
  h.source.token = jwt('u', 'account', { nonce: 2 }); h.source.credits = credits(1); await h.refresh();
  assert.equal(h.delivered.length, 1);
  h.source.usage.account_id = 'other-workspace'; h.source.credits = credits(5); await h.refresh();
  assert.equal(h.delivered.length, 1); assert.equal(h.local.creditGrantState.events.length, 0);
  h.source.token = jwt('other', 'other-account'); h.source.credits = credits(9); await h.refresh();
  assert.equal(h.delivered.length, 1);
  assert.equal(h.badges.at(-1), '75%');
});

test('partial quota failures cannot rebase an unknown workspace or lose a later verified arrival', async () => {
  const h = harness(); h.source.usage.account_id = 'workspace'; await h.refresh();
  h.source.usageStatus = 500; h.source.credits = credits(1); await h.refresh();
  assert.equal(h.delivered.length, 0); assert.equal(h.local.creditGrantState.count, 0);
  h.source.usageStatus = 200; await h.refresh();
  assert.equal(h.delivered.length, 1);
});

test('credits can be verified while quota is temporarily unavailable if the same account scope is still known', async () => {
  const h = harness(); await h.refresh();
  h.source.usageStatus = 500; h.source.credits = credits(1);
  const result = await h.refresh();
  assert.equal(result.account.creditsVerified, true);
  assert.equal(h.delivered.length, 1); assert.equal(h.badges.at(-1), '!');
});

test('quiet hours queue one alert and require successful credit verification before release', async () => {
  const h = harness({ settings: { quietHoursEnabled: true, quietStart: '00:00', quietEnd: '23:59', timezoneMode: 'manual', timezoneOverride: 'UTC' } });
  await h.refresh(); h.source.credits = credits(1); await h.refresh();
  assert.equal(h.delivered.length, 0); assert.equal(h.local.pendingNotifications.length, 1);
  assert.equal(h.badges.at(-1), '75%!');
  await h.save({ quietHoursEnabled: false });
  h.source.creditsStatus = 500; await h.refresh();
  assert.equal(h.delivered.length, 0); assert.equal(h.local.pendingNotifications.length, 1);
  h.source.creditsStatus = 200; await h.refresh(); await h.refresh();
  assert.equal(h.delivered.length, 1); assert.equal(h.local.pendingNotifications.length, 0);
});

test('Windows delivery failures retry durably after worker restart without duplicate acceptance', async () => {
  const h = harness(); await h.refresh();
  h.context.chrome.notifications.create = async () => { throw new Error('Notifications unavailable'); };
  h.source.credits = credits(1); await h.refresh();
  assert.equal(h.local.pendingNotifications.length, 1);
  assert.equal(Object.keys(h.local.notificationHistory).filter(id => id.startsWith('banked:')).length, 0);
  const restarted = harness(h.local); restarted.source.credits = credits(1); await restarted.refresh(); await restarted.refresh();
  assert.equal(restarted.delivered.length, 1); assert.equal(restarted.local.pendingNotifications.length, 0);
});

test('an undelivered Banked arrival survives two days offline without renewing the badge', async () => {
  const h = harness(); await h.refresh();
  h.context.chrome.notifications.create = async () => { throw new Error('desktop unavailable'); };
  h.source.credits = credits(1); await h.refresh();
  const pending = structuredClone(h.local.pendingNotifications[0]);
  const resumed = harness(h.local); resumed.clock(START + 2 * DAY);
  resumed.source.credits = credits(1);
  resumed.source.creditsStatus = 500;
  await resumed.refresh();
  assert.equal(resumed.local.pendingNotifications.length, 1);
  assert.equal(resumed.delivered.length, 0, 'Cached private data cannot authorize delivery');
  assert.equal(resumed.badges.at(-1), '75%');
  resumed.source.creditsStatus = 200;
  await resumed.refresh(); await resumed.refresh();
  assert.equal(resumed.delivered.length, 1);
  assert.equal(resumed.delivered[0].id, pending.id);
  assert.equal(resumed.local.pendingNotifications.length, 0);
  assert.equal(resumed.badges.at(-1), '75%', 'Delivery must not revive the expired !');
});

test('an old pending Banked arrival is cancelled when the verified account changes', async () => {
  const h = harness(); await h.refresh();
  h.context.chrome.notifications.create = async () => { throw new Error('desktop unavailable'); };
  h.source.credits = credits(1); await h.refresh();
  const resumed = harness(h.local); resumed.clock(START + 2 * DAY);
  resumed.source.token = jwt('other', 'account'); resumed.source.credits = credits(1);
  await resumed.refresh();
  assert.equal(resumed.delivered.length, 0);
  assert.equal(resumed.local.pendingNotifications.length, 0);
});

test('expired unqueued Banked observations are not turned into new alerts', async () => {
  const h = harness(); await h.refresh();
  h.source.credits = credits(1); await h.refresh();
  h.local.notificationHistory = {}; h.local.pendingNotifications = [];
  const resumed = harness(h.local); resumed.clock(START + 2 * DAY);
  resumed.source.credits = credits(1); await resumed.refresh();
  assert.equal(resumed.delivered.length, 0);
  assert.equal(resumed.badges.at(-1), '75%');
});

test('reading a Banked arrival does not erase its undelivered toast across two days offline', async () => {
  const h = harness(); await h.refresh();
  h.context.chrome.notifications.create = async () => { throw new Error('desktop unavailable'); };
  h.source.credits = credits(1); await h.refresh();
  const receipt = h.context.RadarBadge.view(h.local, h.local.settings).receipt;
  assert.equal((await h.send({ type: 'ACK_VISIBLE_BADGES', receipt }, h.sender('popup'))).ok, true);
  assert.equal(h.badges.at(-1), '75%');
  assert.equal(h.local.pendingNotifications.length, 1);
  const resumed = harness(h.local); resumed.clock(START + 2 * DAY);
  resumed.source.credits = credits(1); await resumed.refresh(); await resumed.refresh();
  assert.equal(resumed.delivered.length, 1);
  assert.equal(resumed.badges.at(-1), '75%');
});

test('an old Banked queue without a valid original queue time cannot revive an expired observation', async () => {
  for (const queuedAt of [undefined, START - 1, START + DAY, START + 3 * DAY]) {
    const h = harness(); await h.refresh();
    h.context.chrome.notifications.create = async () => { throw new Error('desktop unavailable'); };
    h.source.credits = credits(1); await h.refresh();
    h.local.pendingNotifications[0].queuedAt = queuedAt;
    const resumed = harness(h.local); resumed.clock(START + 2 * DAY);
    resumed.source.credits = credits(1); await resumed.refresh();
    assert.equal(resumed.delivered.length, 0);
    assert.equal(resumed.local.pendingNotifications.length, 0);
  }
});

test('a quiet queue is cancelled on account change, opt-out, or expiry instead of ringing for an old grant', async () => {
  for (const change of ['account', 'off', 'expired']) {
    const h = harness({ settings: { quietHoursEnabled: true, quietStart: '00:00', quietEnd: '23:59', timezoneMode: 'manual', timezoneOverride: 'UTC' } });
    await h.refresh(); h.source.credits = credits(1); await h.refresh();
    if (change === 'account') h.source.token = jwt('other', 'account');
    if (change === 'off') await h.save({ notifyBankedReset: false });
    if (change === 'expired') h.clock(START + 30 * DAY);
    await h.save({ quietHoursEnabled: false }); await h.refresh();
    assert.equal(h.delivered.length, 0); assert.equal(h.local.pendingNotifications.length, 0);
  }
});

test('desktop alert opt-out preserves the baseline and popup marker, without retroactive alerts on re-enable', async () => {
  const h = harness(); await h.refresh(); await h.save({ notifyBankedReset: false });
  h.source.credits = credits(1); await h.refresh();
  assert.equal(h.delivered.length, 0); assert.equal(h.badges.at(-1), '75%!');
  await h.save({ notifyBankedReset: true }); await h.refresh(); assert.equal(h.delivered.length, 0);
  h.source.credits = credits(2); await h.refresh(); assert.equal(h.delivered.length, 1);
});

test('Banked ! expires offline exactly 24 hours after observation and is not renewed by another poll', async () => {
  const h = harness(); await h.refresh(); h.source.credits = credits(1); await h.refresh();
  const at = h.local.creditGrantState.events[0].observedAt;
  h.clock(at + DAY - 1); await h.refresh(); assert.equal(h.badges.at(-1), '75%!');
  assert.equal(h.local.creditGrantState.events[0].observedAt, at);
  const before = h.requests.length; h.clock(at + DAY);
  await h.events.alarm({ name: 'codex-reset-radar-badge-expiry' });
  assert.equal(h.badges.at(-1), '75%'); assert.equal(h.requests.length, before);
  assert.equal(h.context.RadarCreditGrants.latest(h.local.creditGrantState, h.local.accountSnapshot), null);
});

test('public and account markers coexist and expire at their own observation times', async () => {
  const h = harness({ settings: { monitorSignals: true } }); await h.refresh(); h.source.credits = credits(1); await h.refresh();
  h.clock(START + DAY / 2);
  const signal = { firstDetectedAt: START + DAY / 2, assessment: { actionable: true } };
  await h.context.updateBadge(h.local.accountSnapshot, signal, null);
  assert.equal(h.alarms.at(-1).when, START + DAY);
  h.clock(START + DAY); await h.context.updateBadge(h.local.accountSnapshot, signal, null);
  assert.equal(h.badges.at(-1), '75%!'); assert.equal(h.alarms.at(-1).when, START + DAY * 1.5);
  h.clock(START + DAY * 1.5); await h.context.updateBadge(h.local.accountSnapshot, signal, null);
  assert.equal(h.badges.at(-1), '75%');
});

test('disconnect and auth loss purge account grant notices and queues', async () => {
  for (const reason of ['disconnect', 'auth']) {
    const h = harness(); await h.refresh(); h.source.credits = credits(1); await h.refresh();
    assert.equal(h.delivered.length, 1);
    if (reason === 'disconnect') await h.save({ monitorAccount: false });
    else { h.source.usageStatus = 401; await h.refresh(); }
    assert.equal(h.local.creditGrantState, undefined); assert.equal(h.local.accountSnapshot, undefined);
    assert.equal(Object.keys(h.notifications).filter(id => id.startsWith('banked:')).length, 0);
    assert.equal(h.badges.at(-1), '');
  }
});

test('automatic alarm and manual account refresh use the same grant detector', async () => {
  const h = harness(); await h.refresh(); h.source.credits = credits(1);
  await h.events.alarm({ name: 'codex-reset-radar-poll' });
  assert.equal(h.delivered.length, 1);
  h.source.credits = credits(2);
  await h.send({ type: 'REFRESH_ACCOUNT' }, h.sender('options'));
  assert.equal(h.delivered.length, 2); assert.equal(h.badges.at(-1), '75%!');
});

test('a long shutdown starts a baseline rather than attributing an unknown old inventory to a new grant', async () => {
  const h = harness(); await h.refresh();
  h.clock(START + 31 * DAY); h.source.credits = credits(3); await h.refresh();
  assert.equal(h.local.creditGrantState.count, 3); assert.equal(h.delivered.length, 0);
  h.clock(START + 31 * DAY + 60000); h.source.credits = credits(4); await h.refresh();
  assert.equal(h.delivered.length, 1);
});

test('Chrome acceptance followed by acknowledgement failure is recovered without a second toast', async () => {
  const h = harness(); await h.refresh();
  const set = h.context.chrome.storage.local.set;
  h.context.chrome.storage.local.set = async data => {
    if (Object.keys(data.notificationHistory || {}).some(id => id.startsWith('banked:'))) throw new Error('Storage interrupted');
    return set(data);
  };
  h.source.credits = credits(1); await h.refresh();
  assert.equal(h.delivered.length, 1); assert.equal(h.local.pendingNotifications.length, 1);
  const restarted = harness(h.local);
  Object.assign(restarted.notifications, structuredClone(h.notifications));
  restarted.source.credits = credits(1); await restarted.refresh();
  assert.equal(restarted.delivered.length, 0); assert.equal(restarted.local.pendingNotifications.length, 0);
  assert.equal(Object.keys(restarted.local.notificationHistory).filter(id => id.startsWith('banked:')).length, 1);
});
