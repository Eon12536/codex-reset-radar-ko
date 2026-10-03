const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, FAKE_TOKEN, RAW_USAGE, json } = require('./helpers/worker');
const START = Date.parse('2026-10-03T06:00:00Z');

test('quiet reset news and Banked arrivals survive read acknowledgement, delivery failure and two worker restarts without duplicate toasts', async () => {
  let now = START, quiet = true;
  const attempts = new Map(), accepted = new Map();
  const source = { credits: { available_count: 1, credits: [{ id: 'first-credit' }] },
    posts: [{ external_id: '123', content: 'We have now reset all Codex usage limits.',
      published_at: new Date(START - 20 * 3600000).toISOString().slice(0, -1),
      metadata: { author_user_name: 'thsottiaux' } },
    { external_id: '124', content: 'Banked resets are now available.',
      published_at: new Date(START - 4 * 86400000).toISOString(),
      metadata: { author_user_name: 'reach_vb' } }] };
  function create(stored = {}) {
    const w = makeWorker({ stored: { settings: { monitorAccount: true, monitorSignals: true,
      monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false,
      quietHoursEnabled: true, notifyAdvice: false, notifyCreditExpiry: false }, ...stored },
    fetcher: async url => {
      if (url.endsWith('/auth/session')) return json({ accessToken: FAKE_TOKEN });
      if (url.endsWith('/usage')) return json(RAW_USAGE);
      if (url.endsWith('/rate-limit-reset-credits')) return json(source.credits);
      return json({ items: source.posts });
    } });
    w.context.Date = class extends Date { static now() { return now; } };
    w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => quiet };
    const deliver = w.context.chrome.notifications.create;
    w.context.chrome.notifications.create = async (id, options) => {
      const count = (attempts.get(id) || 0) + 1; attempts.set(id, count);
      if (count === 1) throw Error('Temporarily unavailable');
      accepted.set(id, (accepted.get(id) || 0) + 1);
      return deliver(id, options);
    };
    return w;
  }
  const first = create();
  await first.send({ type: 'REFRESH_ACCOUNT' }, first.sender('popup'));
  await first.context.refreshSignals();
  source.credits = { available_count: 2, credits: [{ id: 'first-credit' }, { id: 'new-credit' }] };
  await first.send({ type: 'REFRESH_ACCOUNT' }, first.sender('popup'));
  const settings = first.context.RadarSettings.sanitize(first.local.settings);
  const unread = first.context.RadarBadge.view(first.local, settings);
  assert.equal(unread.receipt.public.length, 1);
  assert.equal(unread.receipt.banked.length, 1);
  assert.equal(first.local.pendingNotifications.length, 2);
  const bankedId = unread.receipt.banked[0].id;
  assert.equal((await first.send({ type: 'ACK_VISIBLE_BADGES', receipt: unread.receipt }, first.sender('popup'))).ok, true);
  assert.equal(first.context.RadarBadge.view(first.local, settings).hasUnread, false);
  assert.equal(first.local.creditGrantState.count, 2);
  assert.equal(first.local.pendingNotifications.length, 2);
  assert.equal(accepted.size, 0);

  quiet = false;
  const second = create(structuredClone(first.local));
  await second.events.startup();
  await second.send({ type: 'REFRESH_NOW' }, second.sender('popup'));
  assert.equal(accepted.get('report:123'), 1);
  assert.equal(accepted.get(bankedId), 1);
  assert.equal(accepted.has('report:124'), false);
  assert.equal(second.local.pendingNotifications.length, 0);
  assert.equal(second.context.RadarBadge.view(second.local, settings).hasUnread, false);

  now += 10 * 60000;
  source.posts.unshift({ external_id: '125', content: 'Resets all propagated.',
    published_at: new Date(now - 60000).toISOString(), metadata: { author_user_name: 'reach_vb' } });
  const third = create(structuredClone(second.local));
  await third.events.startup();
  await third.send({ type: 'REFRESH_NOW' }, third.sender('popup'));
  assert.equal(accepted.get('report:125'), 1);
  assert.equal(accepted.size, 3);
  assert.ok([...accepted.values()].every(count => count === 1));
  assert.equal(third.context.RadarBadge.view(third.local, settings).receipt.public[0].id, '125');
  assert.equal(third.context.RadarBadge.view(third.local, settings).receipt.banked.length, 0);
});
