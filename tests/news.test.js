const test = require('node:test');
const assert = require('node:assert/strict');
global.RadarTime = require('../src/core/time.js');
global.RadarSignals = require('../src/core/signals.js');
const News = require('../src/core/news.js');
const settings = require('../src/core/settings.js').sanitize();
const { makeWorker } = require('./helpers/worker.js');
const { json } = require('./helpers/worker.js');
const post = (text, extra = {}) => ({ id: '2101352781219258527', text, author: 'thsottiaux', createdAt: new Date().toISOString(), source: { id: 'codex-lead', weight: 1 }, url: 'https://x.com/thsottiaux/status/2101352781219258527', ...extra });

test('Tuesday reply is a candidate even when its parent literally says reset', () => {
  const reply = post('OK fine. But it’s also still coming in Tuesday', { replyContext: { id: '2101352781219258526', author: 'udiWertheimer', text: 'you owe us a banked reset', url: 'https://x.com/udiWertheimer/status/2101352781219258526', relation: 'conversation-before', targetId: '2101352781219258527' } });
  const news = News.select(null, { items: [reply] }, settings);
  assert.equal(news.label, '후보');
  assert.equal(news.timing, '화요일 · 미 서부 추정\n한국 시각 미정');
  assert.equal(news.item.text, reply.text);
});

test('literal reset badge describes wording, not whether the action is confirmed', () => {
  const news = News.select(null, { items: [post('Maybe we should dust off the reset button tomorrow.')] }, settings);
  assert.equal(news.label, 'reset');
  assert.equal(news.timing, '내일 · 미 서부 추정\n한국 시각 미정');
  assert.match(news.caption, /실행 확정과는 다릅니다/);
  assert.equal(news.item.assessment.actionable, false);
  assert.equal(News.select(null, { items: [news.item] }, { ...settings, monitorSignals: false }), null);
});

test('time expression extraction preserves missing, negative, relative and twelve-hour forms', () => {
  assert.equal(News.timing('Codex limits will reset.'), '');
  assert.equal(News.timing('next Tuesday at 06:30 PM'), '다음 화요일 · 오후 6:30');
  assert.equal(News.timing('not Tuesday'), '화요일은 아님');
  assert.equal(News.timing('not until Tuesday'), '화요일 전에는 아님');
  assert.equal(News.timing('soon, but not today'), '오늘은 아님');
});

test('all Korean clocks use 오전/오후 and unpadded hours including noon and midnight', () => {
  for (const [hour, expected] of [[0, '오전 12:30'], [6, '오전 6:30'], [12, '오후 12:30'], [18, '오후 6:30']]) {
    const at = Date.UTC(2026, 8, 20, hour, 30);
    assert.equal(RadarTime.formatTime(at, 'UTC', 'ko-KR'), expected);
    assert.ok(RadarTime.formatDateTime(at, 'UTC', 'ko-KR').endsWith(expected));
  }
});

test('unified original link opens the selected candidate and still rejects an unsafe link', async () => {
  const w = makeWorker({ stored: { settings: { monitorAccount: false } } });
  await w.context.ensureSecurity();
  const item = post('Maybe we should dust off the reset button tomorrow.');
  w.local.hintSnapshot = { items: [item] };
  assert.equal((await w.send({ type: 'OPEN_NEWS' }, w.sender('popup'))).ok, true);
  assert.equal(w.tabs.at(-1).url, item.url);
  item.url = 'https://untrusted.invalid/';
  assert.equal((await w.send({ type: 'OPEN_NEWS' }, w.sender('popup'))).ok, false);
  assert.equal(w.tabs.length, 1);
});

test('news lists all retained candidates in time order with stable keys and no duplicates', () => {
  const items = Array.from({ length: 6 }, (_, i) => post('Tuesday at 3am', {
    id: String(100 + i), createdAt: new Date(Date.now() - i * 60000).toISOString()
  }));
  const news = News.list(null, { items: [...items, items[0]] }, settings);
  assert.deepEqual(news.map(entry => entry.key), items.map(item => 'codex-lead:' + item.id));
  assert.equal(News.select(null, { items }, settings).key, news[0].key);
  assert.equal(News.list(null, { items }, { ...settings, monitorSignals: false }).length, 0);
  assert.equal(News.list(null, { items }, { ...settings, monitorLeadSource: false }).length, 0);
  assert.equal(News.list(null, { items: [post('Tuesday at 3am', { createdAt: new Date(Date.now() - 8 * 86400000).toISOString() })] }, settings).length, 0);
});

test('each list source action opens its own stored URL and rejects forged IDs, URLs and callers', async () => {
  const w = makeWorker({ stored: { settings: { monitorAccount: false } } });
  await w.context.ensureSecurity();
  w.local.hintSnapshot = { items: [100, 101, 102, 103, 104].map(id => post('Tuesday at 3am', {
    id: String(id), url: `https://x.com/thsottiaux/status/${id}`
  })) };
  for (const id of [104, 101, 100]) {
    assert.equal((await w.send({ type: 'OPEN_NEWS', id: 'codex-lead:' + id }, w.sender('popup'))).ok, true);
    assert.equal(w.tabs.at(-1).url, `https://x.com/thsottiaux/status/${id}`);
  }
  const count = w.tabs.length;
  for (const message of [{ type: 'OPEN_NEWS', id: 'missing' }, { type: 'OPEN_NEWS', id: 104 },
    { type: 'OPEN_NEWS', id: 'https://untrusted.invalid' }, { type: 'OPEN_NEWS', id: 'x'.repeat(257) },
    { type: 'OPEN_NEWS', id: 'codex-lead:104', url: 'https://untrusted.invalid' }])
    assert.equal((await w.send(message, w.sender('popup'))).ok, false);
  assert.equal((await w.send({ type: 'OPEN_NEWS', id: 'codex-lead:104' }, w.sender('options'))).ok, false);
  w.local.hintSnapshot.items.at(-1).url = 'https://untrusted.invalid';
  assert.equal((await w.send({ type: 'OPEN_NEWS', id: 'codex-lead:104' }, w.sender('popup'))).ok, false);
  assert.equal(w.tabs.length, count);
});

test('collection retains and considers every fresh candidate for notification', async () => {
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false, quietHoursEnabled: false, notifyHints: true } },
    fetcher: async () => json({ items: Array.from({ length: 6 }, (_, i) => ({ external_id: String(100 + i),
      content: 'Tuesday at 3am', published_at: new Date(Date.now() - i * 60000).toISOString(), metadata: { author_user_name: 'thsottiaux' } })) }) });
  await w.context.refreshSignals();
  assert.equal(w.local.hintSnapshot.items.length, 6);
  assert.equal(News.list(w.local.signalSnapshot, w.local.hintSnapshot, settings).length, 6);
  assert.equal(Object.keys(w.notifications).filter(id => id.startsWith('hint:')).length, 6);
  await w.context.revalidateCachedSignals(w.context.stateEpoch);
  assert.equal(w.local.hintSnapshot.items.length, 6);
});


test('reset kind distinguishes banked credits, ordinary quota resets and unspecified metaphors', () => {
  const kind = text => global.RadarSignals.resetKind({text});
  assert.equal(kind('We are loading a banked reset into all accounts.'), 'banked');
  assert.equal(kind('We have reset all Codex usage limits.'), 'ordinary');
  assert.equal(kind('Codex limits will reset tomorrow.'), 'ordinary');
  assert.equal(kind('I promised a reset for Tuesday.'), 'unknown');
  assert.equal(kind('Burn those tokens'), 'unknown');
  assert.equal(kind('Are we getting a banked reset?'), 'unknown');
  assert.equal(kind('No banked resets today.'), 'unknown');
  assert.equal(kind('We reset all limits. We also added a banked reset.'), 'both');
  assert.equal(global.RadarSignals.resetKind({text:'Tuesday',replyContext:{text:'banked reset please'}}), 'unknown');
});
