const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
const NOW = Date.parse('2026-10-23T09:00:00Z');
const clone = value => JSON.parse(JSON.stringify(value));
const post = (id, text = 'We will reset Codex usage limits tomorrow.', at = NOW - 60000) => ({
  id, text, author: 'thsottiaux', createdAt: new Date(at).toISOString(),
  url: `https://x.com/thsottiaux/status/${id}`, source: { id: 'codex-lead', weight: 1 } });
function worker({ stored, rows = [post('801'), post('802')], country = 'ko-KR', storageHook } = {}) {
  const source = { rows }, clock = { at: NOW }, calls = [];
  const settings = { monitorAccount: false, semanticEnabled: false, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false, quietHoursEnabled: false };
  const w = makeWorker({ individualPublicAlerts: false, stored: stored || { settings },
    storageHook, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return clock.at; } };
  w.context.RadarI18n.setLocale(country);
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: source.rows, diagnostics: {
    posts: source.rows.length, timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai']
      .map(author => ({ kind, author, ok: true, stopReason: 'seven-days' }))) } }) };
  const create = w.context.chrome.notifications.create;
  w.context.chrome.notifications.create = async (id, opts) => { calls.push(id); return create(id, opts); };
  return { ...w, source, clock, calls };
}

test('existing installs default to one native daily toast with several source links in one daily group', async () => {
  const w = worker(); await w.context.refreshSignals();
  assert.equal(w.local.settings.dailyResetDigest, true);
  assert.deepEqual(w.calls, ['daily-reset:2026-10-23']);
  assert.match(w.notifications[w.calls[0]].message, /Tibo · 리셋 예고 · 10월 23일.*오후 5:59/);
  assert.match(w.notifications[w.calls[0]].message, /We will reset Codex usage limits tomorrow\./);
  assert.equal(w.local.pendingNotifications.length, 0);
  assert.ok(w.local.notificationHistory['signal:801']);
  assert.ok(w.local.notificationHistory['signal:802']);
  const groups = w.context.RadarDailyNews.groups(w.local, w.local.settings);
  assert.equal(groups.length, 1); assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].day, '2026-10-23');
  for (const id of ['801', '802']) {
    assert.equal((await w.send({ type: 'OPEN_NEWS', id: 'codex-lead:' + id }, w.sender('popup'))).ok, true);
    assert.equal(w.tabs.at(-1).url, `https://x.com/thsottiaux/status/${id}`);
  }
});

test('later same-day findings and worker restarts update the group without replacing or ringing the toast', async () => {
  const w = worker(); await w.context.refreshSignals();
  w.source.rows.push(post('803', 'We added a banked reset to all accounts.'));
  await w.context.refreshSignals();
  assert.equal(w.calls.length, 1);
  assert.equal(w.local.pendingNotifications.length, 0);
  assert.equal(w.context.RadarDailyNews.groups(w.local, w.local.settings)[0].items.length, 3);
  const next = worker({ stored: clone(w.local), rows: [...w.source.rows, post('804')] });
  await next.context.refreshSignals();
  assert.equal(next.calls.length, 0);
  assert.equal(next.context.RadarDailyNews.groups(next.local, next.local.settings)[0].items.length, 4);
  assert.equal(next.local.pendingNotifications.length, 0);
});

test('the daily boundary follows the selected country, with one toast for the next day', async () => {
  for (const [country, expected] of [['ko-KR', '2026-10-24'], ['en-US', '2026-10-23']]) {
    const w = worker({ country }); await w.context.refreshSignals();
    w.clock.at = Date.parse('2026-10-23T15:01:00Z');
    w.source.rows.push(post('803', undefined, w.clock.at - 1000));
    await w.context.refreshSignals();
    await finishPublicResume(w); // A long polling gap retains the desktop wake grace.
    assert.equal(w.context.RadarDailyNews.dayKey(), expected);
    assert.equal(w.calls.length, country === 'ko-KR' ? 2 : 1, country);
    assert.equal(w.context.RadarDailyNews.groups(w.local, w.local.settings).length, country === 'ko-KR' ? 2 : 1);
  }
});

test('failed native delivery remains pending and retries one combined toast without losing individual receipts', async () => {
  const w = worker(), create = w.context.chrome.notifications.create;
  w.context.chrome.notifications.create = async () => { throw Error('Windows unavailable'); };
  await w.context.refreshSignals();
  assert.equal(w.local.pendingNotifications.length, 2);
  assert.equal(w.local.dailyNewsDelivery, undefined);
  assert.equal(w.local.notificationHistory?.['signal:801'], undefined);
  w.context.chrome.notifications.create = create;
  await w.context.flushPendingNotifications(); await w.context.flushPendingNotifications();
  assert.deepEqual(w.calls, ['daily-reset:2026-10-23']);
  assert.equal(w.local.pendingNotifications.length, 0);
  assert.ok(w.local.notificationHistory['signal:802']);
});

test('startup/wake grace collects the whole batch before one daily toast, retaining quiet-hour recovery semantics', async () => {
  const w = worker(); w.local.signalSnapshot = { checkedAt: NOW - 4 * 86400000 };
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.events.startup();
  assert.equal(w.calls.length, 0); assert.equal(w.local.pendingNotifications.length, 2);
  await finishPublicResume(w);
  assert.deepEqual(w.calls, ['daily-reset:2026-10-23']);
  assert.equal(w.local.pendingNotifications.length, 0);
});

test('interrupted acknowledgement recovers a visible daily toast without another Chrome create', async () => {
  const w = worker(); w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.refreshSignals();
  const next = worker({ stored: clone(w.local) });
  next.notifications['daily-reset:2026-10-23'] = { title: 'Already accepted' };
  next.context.chrome.notifications.create = async () => assert.fail('must not replace accepted daily toast');
  await next.context.flushPendingNotifications();
  assert.ok(next.local.dailyNewsDelivery['2026-10-23']);
  assert.equal(next.local.pendingNotifications.length, 0);
});

test('retracted sources clear the visible summary; a later valid same-day post remains silent', async () => {
  const w = worker(); await w.context.refreshSignals();
  w.source.rows = [post('801', 'Lunch tomorrow.'), post('802', 'A product announcement.')];
  await w.context.refreshSignals();
  assert.equal(Object.keys(w.notifications).length, 0);
  assert.equal(w.context.RadarDailyNews.groups(w.local, w.local.settings).length, 0);
  w.source.rows.push(post('803'));
  await w.context.refreshSignals();
  assert.equal(w.calls.length, 1);
  assert.equal(w.context.RadarDailyNews.groups(w.local, w.local.settings)[0].items.length, 1);
});

test('account notices are independent, and clicking a daily toast opens one extension summary, never X tabs', async () => {
  const w = worker(); await w.context.refreshSignals();
  await w.context.createNotification('banked:account-credit', { title: 'Banked credit arrived', message: '+1' }, w.local.settings);
  assert.deepEqual(w.calls, ['daily-reset:2026-10-23', 'banked:account-credit']);
  await w.events.notificationButton('daily-reset:2026-10-23', 0);
  assert.equal(w.tabs.length, 1);
  assert.equal(w.tabs[0].url, w.runtime.getURL('src/popup/popup.html'));
});

test('clearing collected data retains only the daily cap and preference markers, preventing a second same-day toast', async () => {
  const w = worker(); await w.context.refreshSignals();
  await w.send({ type: 'CLEAR_LOCAL_DATA' }, w.sender('options'));
  assert.ok(w.local.dailyNewsDelivery['2026-10-23']);
  assert.equal(w.local.dailyNewsDelivery['2026-10-23'].ids.length, 0, 'no source identifiers survive explicit data clearing');
  assert.equal(w.local.resetFocusDefaultsSchema, 1);
  assert.equal(w.local.signalSnapshot, undefined);
  await w.context.refreshSignals();
  assert.equal(w.calls.length, 1);
});

test('the observed Day18 deadline and both canonical original links share one clean summary', async () => {
  const raw = require('./fixtures/tibo-day18-oct23.json').posts;
  const w = worker();
  const [parent, child] = w.context.RadarDirectX.normalize(raw, NOW);
  w.source.rows = [parent, w.context.RadarDirectX.conversationContext(child, { targetId: child.id, rows: raw }, NOW)];
  await w.context.refreshSignals();
  const [group] = w.context.RadarDailyNews.groups(w.local, w.local.settings);
  assert.equal(group.items.length, 2);
  assert.equal(group.times.length, 1);
  assert.match(group.times[0].text, /한국.*10\/24.*3:00.*이전/);
  assert.doesNotMatch(w.notifications[w.calls[0]].message, /원문 링크는|조용히 반영|공개 글 요약/);
  assert.match(w.notifications[w.calls[0]].title, /^리셋 예정 기한 · 한국.*10\/24.*3:00.*이전/);
  assert.equal(w.context.RadarDailyNews.headline(group), w.notifications[w.calls[0]].title);
  const parentRow = group.items.find(row => row.item.id === parent.id);
  assert.match(parentRow.timing, /10\/24.*3:00.*이전/);
  assert.equal(parentRow.timingSourceKey, 'codex-lead:' + child.id);
  assert.equal(w.context.RadarDailyNews.excerpt(parentRow), 'But yes… that’s a reset!');
  w.local.publicAlertState.entries[child.id].observedAt += 86400000;
  const originalGroup = w.context.RadarDailyNews.groups(w.local, w.local.settings).find(group => group.day === '2026-10-23');
  assert.equal(originalGroup.items.length, 2, 'publication date groups both posts despite separate detection days');
  assert.match(w.context.RadarDailyNews.headline(originalGroup), /10\/24.*3:00.*이전/);
});

test('concise source presentation retains original meaning and distinguishes forecasts, completion and inferred completion', () => {
  const w = worker(), daily = w.context.RadarDailyNews;
  const make = (assessment, text = 'Done.') => ({ item: { ...post('801', text), assessment } });
  assert.equal(daily.status(make({ actionable: true }, 'We will reset Codex usage limits tomorrow.')), '리셋 예고');
  assert.equal(daily.status({ ...make({}, 'Landing tomorrow before 10am PST'), timingSourceKey: 'codex-lead:802' }), '리셋 추정');
  assert.equal(daily.status(make({ report: 'completed-reset' })), '리셋 완료');
  assert.equal(daily.status(make({ report: 'completed-reset', completionLink: 'inferred' })), '리셋 추정');
  assert.equal(daily.status(make({ report: 'credit-grant' })), '리셋권 지급');
  assert.equal(daily.status(make({ rule: 'reset-poll' })), '리셋 추정');
  assert.equal(daily.status(make({ candidate: true })), '리셋 추정');
  const mixed = make({}, 'We shipped a new API. But yes… that’s a reset!');
  assert.equal(daily.brief(mixed), 'But yes… that’s a reset!');
  assert.equal(daily.brief(make({}, 'Landing tomorrow before 10am PST together with a small ship.')), 'Landing tomorrow before 10am PST');
  assert.equal(daily.brief(make({ report: 'completed-reset', completionLink: 'inferred' })), 'Done.');
  const long = daily.brief(make({}, 'Weekly limits reset tomorrow. ' + 'Details about the reset '.repeat(40)));
  assert.ok(long.length <= 180); assert.match(long, /^Weekly limits reset tomorrow\./);
  assert.equal(daily.compactTime({ text: '한국 10/24(토) 오전 3:00 이전 · 기한 · 게시일 기준' }), '한국 10/24(토) 오전 3:00 이전');
  assert.match(daily.compactTime({ text: '한국 10/24(토) 오전 3:00 전 · 기한 · 시간대 추정' }), /시간대 추정/);
  assert.equal(daily.author(mixed), 'Tibo');
  w.context.RadarI18n.setLocale('en-US');
  assert.equal(daily.status(make({ report: 'completed-reset', completionLink: 'inferred' })), 'Reset inferred');
  assert.equal(daily.compactTime({ text: 'US Eastern (ET) Fri, Oct 23 · Before 2:00 PM · Deadline · Based on publication' }), 'US Eastern (ET) Fri, Oct 23 · Before 2:00 PM');
});

test('banner headings distinguish exact instants, deadlines, multiple schedules and unknown times in the selected country', () => {
  const w = worker(), daily = w.context.RadarDailyNews;
  const row = text => ({ key: 'codex-lead:801', item: post('801', text) });
  const exact = daily.summary([row('We will reset Codex usage limits tomorrow at 10am PST.')]);
  assert.equal(exact.times[0].kind, 'instant');
  assert.match(daily.headline(exact), /^리셋 예정 · 한국.*10\/25.*3:00/);
  const deadline = daily.summary([row('Landing tomorrow by 10am PST.')]);
  assert.equal(deadline.times[0].kind, 'deadline');
  assert.match(daily.headline(deadline), /^리셋 예정 기한 · 한국.*3:00.*까지/);
  const multiple = daily.summary([row('We will reset Codex usage limits tomorrow at 10am PST.'),
    row('We will reset Codex usage limits tomorrow at 11am PST.')]);
  assert.equal(multiple.times.length, 2);
  assert.match(daily.headline(multiple), /^리셋 일정 2개 ·/);
  const unknown = row('We will reset Codex usage limits tomorrow.');
  unknown.item.assessment = { actionable: true, eventAt: NOW + 86400000 };
  assert.equal(daily.summary([unknown]).times.length, 0);
  assert.equal(daily.headline(daily.summary([unknown])), '리셋 소식 요약');
  w.context.RadarI18n.setLocale('en-US');
  const us = daily.summary([row('We will reset Codex usage limits tomorrow at 10am PST.')]);
  assert.equal(us.times[0].at, exact.times[0].at);
  assert.match(daily.headline(us), /^Reset scheduled · US Eastern.*Oct 24.*2:00 PM/);
});

test('a later confirmed time appears in the popup headline without a second same-day native banner', async () => {
  const w = worker(); await w.context.refreshSignals();
  assert.equal(w.notifications[w.calls[0]].title, '리셋 소식 요약');
  w.source.rows.push(post('803', 'We will reset Codex usage limits tomorrow at 10am PST.'));
  await w.context.refreshSignals();
  const group = w.context.RadarDailyNews.groups(w.local, w.local.settings)[0];
  assert.match(w.context.RadarDailyNews.headline(group), /^리셋 예정 · 한국.*3:00/);
  assert.equal(w.calls.length, 1);
});

test('concurrent public deliveries serialize the native daily cap', async () => {
  const w = worker(); w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.refreshSignals();
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => false };
  await Promise.all([w.context.deliverNotification('signal:801', {}), w.context.deliverNotification('signal:802', {})]);
  assert.deepEqual(w.calls, ['daily-reset:2026-10-23']);
});

test('a reply discovered on a later day supplies the original daily banner time after the active forecast expires, without a new alert', async () => {
  const raw = clone(require('./fixtures/tibo-day18-oct23.json').posts);
  raw[1].text = 'We will reset Codex usage limits tomorrow at 10am PST.'; // Synthetic exact-time variant.
  const w = worker();
  const [parent, child] = w.context.RadarDirectX.normalize(raw, NOW);
  w.source.rows = [parent];
  await w.context.refreshSignals();
  assert.equal(w.context.RadarDailyNews.groups(w.local, w.local.settings)[0].times.length, 0);
  w.clock.at = Date.parse('2026-10-25T09:00:00Z');
  w.source.rows = [parent, w.context.RadarDirectX.conversationContext(child, { targetId: child.id, rows: raw }, w.clock.at)];
  await w.context.refreshSignals(); await finishPublicResume(w);
  assert.ok(!w.local.signalSnapshot.activeSignals.some(item => item.id === child.id));
  assert.equal(w.local.signalSnapshot.timingReplies.length, 1);
  const groups = w.context.RadarDailyNews.groups(w.local, w.local.settings);
  const original = groups.find(group => group.day === '2026-10-23');
  assert.equal(original.items.length, 2, 'reply stays on its publication day despite later discovery');
  assert.match(w.context.RadarDailyNews.headline(original), /10\/24.*3:00/);
  assert.equal(w.context.RadarDailyNews.status(original.items.find(row => row.item.id === parent.id)), '리셋 예고');
  assert.equal(w.calls.length, 1, 'historical timing evidence cannot become a fresh forecast alert');
  const archived = groups.flatMap(group => group.items).find(row => row.item.id === child.id);
  assert.equal((await w.send({ type: 'OPEN_NEWS', id: archived.key }, w.sender('popup'))).ok, true);
  const retainedOnly = w.context.RadarNews.list({ ...w.local.signalSnapshot, signal: null, activeSignals: [] },
    { ...w.local.hintSnapshot, items: w.local.hintSnapshot.items.filter(item => item.id !== child.id) }, w.local.settings)
    .find(row => row.item.id === child.id);
  assert.equal(retainedOnly.archivedTiming, true, 'timing survives even when older hints leave the visible candidate list');
  assert.equal(w.context.dailyNewsEnabled(retainedOnly, w.local.settings, w.local), false);
  const next = worker({ stored: clone(w.local), rows: w.source.rows }); next.clock.at = w.clock.at;
  await next.events.startup();
  assert.match(next.context.RadarDailyNews.headline(next.context.RadarDailyNews.groups(next.local, next.local.settings)
    .find(group => group.day === '2026-10-23')), /10\/24.*3:00/);
  w.source.rows[1] = { ...w.source.rows[1], text: 'The reset has been cancelled.' };
  await w.context.refreshSignals();
  assert.equal(w.local.signalSnapshot.timingReplies.length, 0);
  assert.equal(w.context.RadarDailyNews.groups(w.local, w.local.settings).find(group => group.day === '2026-10-23').times.length, 0);
});

test('legacy per-post mode remains explicit and does not leave a daily notification behind', async () => {
  const w = worker(); await w.context.refreshSignals();
  await w.context.saveSettings({ ...w.local.settings, dailyResetDigest: false });
  assert.equal(w.notifications['daily-reset:2026-10-23'], undefined);
  w.source.rows.push(post('803'));
  await w.context.refreshSignals();
  assert.deepEqual(w.calls, ['daily-reset:2026-10-23', 'signal:803']);
});

test('optional general event mode also drains its daily queue, including a same-day cancellation', async () => {
  const w = worker({ stored: { settings: { monitorAccount: false, semanticEnabled: false, resetOnly: false,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false,
    notifyHints: true, quietHoursEnabled: false } }, rows: [post('801', 'OpenAI livestream tomorrow at 10am PT.')] });
  await w.context.refreshSignals();
  assert.equal(w.calls.length, 1);
  w.source.rows.push(post('802', 'OpenAI livestream tomorrow at 10am PT has been cancelled.', NOW));
  await w.context.refreshSignals(); await w.context.flushPendingNotifications();
  assert.equal(w.calls.length, 1);
  assert.equal(w.local.pendingNotifications.length, 0);
});

test('premature old-version history does not swallow an authorized pending daily delivery', async () => {
  const w = worker(); w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.refreshSignals();
  w.local.notificationHistory = { 'signal:801': NOW - 1000 };
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => false };
  await w.context.flushPendingNotifications();
  assert.deepEqual(w.calls, ['daily-reset:2026-10-23']);
  assert.equal(w.local.pendingNotifications.length, 0);
});

test('a changed deadline removes stale native text without creating another daily toast', async () => {
  const w = worker(); await w.context.refreshSignals();
  w.source.rows[0] = { ...w.source.rows[0], text: 'We will reset Codex usage limits next Tuesday.' };
  await w.context.refreshSignals();
  assert.equal(w.calls.length, 1);
  assert.equal(w.notifications['daily-reset:2026-10-23'], undefined);
  assert.ok(w.context.RadarDailyNews.groups(w.local, w.local.settings)[0].items.some(row => /next Tuesday/.test(row.item.text)));
});

test('a legitimately queued daily summary retries after its one-day observation expires', async () => {
  const w = worker({ rows: [post('801', 'We will reset Codex usage limits next Tuesday.'), post('802', 'We will reset Codex usage limits next Tuesday.')] });
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => true };
  await w.context.refreshSignals();
  assert.equal(w.local.pendingNotifications.length, 2);
  w.clock.at += 2 * 86400000;
  w.context.RadarTime = { ...w.context.RadarTime, isQuietHours: () => false };
  await w.context.flushPendingNotifications();
  assert.deepEqual(w.calls, ['daily-reset:2026-10-25']);
  assert.equal(w.local.pendingNotifications.length, 0);
});

test('adding a verified timing reply does not silently remove an already accepted daily summary', async () => {
  const [parent, child] = require('./fixtures/tibo-day18-oct23.json').posts;
  const source = { ...parent, source: { id: 'codex-lead', weight: 1 } };
  const w = worker({ rows: [source] });
  await w.context.refreshSignals();
  assert.ok(w.notifications['daily-reset:2026-10-23']);
  w.source.rows.push({ ...child, source: source.source,
    replyContext: { ...parent, relation: 'conversation-before', targetId: child.id } });
  await w.context.refreshSignals();
  assert.ok(w.notifications['daily-reset:2026-10-23'], 'display enrichment must not erase the accepted Windows notification');
  assert.deepEqual(w.calls, ['daily-reset:2026-10-23'], 'keep the once-per-day policy');
});

test('public diagnostics survive later account and test deliveries and expose the daily slot', async () => {
  const w = worker();
  w.context.chrome.notifications.getPermissionLevel = async () => 'granted';
  await w.context.refreshSignals();
  const publicDelivery = clone(w.local.notificationPublicDelivery);
  assert.equal(publicDelivery.status, 'accepted');
  w.clock.at += 60000;
  await w.context.sendNativeNotification('recovery:fixture', { title: 'Account', message: 'Quota' });
  await w.context.sendNativeNotification('radar-test', { title: 'Test', message: 'Test' });
  let status = await w.context.notificationStatus();
  assert.deepEqual(clone(status.publicDelivery), publicDelivery);
  assert.equal(status.realDelivery.at, w.clock.at);
  assert.equal(status.delivery.test, true);
  assert.equal(status.dailySummary.handled, true);
  assert.equal(status.dailySummary.day, '2026-10-23');
  assert.equal(status.publicDelivery.id, undefined);
  w.context.chrome.notifications.create = async () => { throw Error('unavailable'); };
  await assert.rejects(w.context.sendNativeNotification('signal:fixture', { title: 'Public', message: 'News' }));
  status = await w.context.notificationStatus();
  assert.equal(status.publicDelivery.status, 'failed');
  assert.equal(status.publicDelivery.reason, 'unavailable');
});
