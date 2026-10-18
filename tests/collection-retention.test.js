const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
const NOW = Date.parse('2026-10-18T02:00:00Z');
const post = (id = '401', text = 'Day 13 / Le limit reset') => ({ id, author: 'thsottiaux', text,
  url: `https://x.com/thsottiaux/status/${id}`, createdAt: '2026-10-17T16:20:57Z' });
function worker(stored = {}) {
  const w = makeWorker({ stored: { ...stored, settings: { ...stored.settings, monitorAccount: false,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false,
    quietHoursEnabled: false, notifyResetHints: true } }, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  return w;
}
const diagnostics = () => ({ posts: 1, timelines: ['posts', 'replies'].flatMap(kind =>
  ['thsottiaux', 'reach_vb', 'openai'].map(author => ({ author, kind, ok: true, stopReason: 'seven-days' }))) });

test('public archive rejects private/untrusted/stale/oversized data and never restores fabricated reply metadata', () => {
  const w = worker(); const d = w.context.RadarDirectX;
  const kept = d.archivePosts([post(), { ...post('402'), author: 'someone', url: 'https://x.com/someone/status/402' },
    { ...post('403'), url: 'https://x.com/i/chat' }, { ...post('404'), createdAt: '2026-10-01T00:00:00Z' },
    { ...post('405'), replyContext: { text: 'Codex reset', relation: 'conversation-before' }, cookie: 'PRIVATE' }]);
  assert.equal(kept.length, 2);
  assert.ok(kept.every(item => !item.cookie && !item.replyContext));
  const many = Array.from({ length: 480 }, (_, i) => ({ ...post(String(i + 1000)), text: '한'.repeat(6000) }));
  const bounded = d.archivePosts(many);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= 1000000);
  assert.ok(bounded.length < many.length);
  assert.equal(d.archivePosts([post(), { ...post(), text: 'Updated public text' }])[0].text, 'Updated public text');
});

test('a full archive always admits newer posts and invalid newer rows cannot crowd out valid evidence', () => {
  const d = worker().context.RadarDirectX;
  const old = Array.from({ length: 160 }, (_, i) => ({ ...post(String(1000 + i)), createdAt: '2026-10-16T00:00:00Z' }));
  const fresh = post('5000');
  assert.ok(d.archivePosts([...old, fresh]).some(item => item.id === fresh.id));
  const invalid = Array.from({ length: 200 }, (_, i) => ({ ...post(String(6000 + i)), createdAt: '2099-01-01T00:00:00Z' }));
  assert.ok(d.archivePosts([...invalid, ...old, fresh]).some(item => item.id === fresh.id));
});

test('checkpoint writes survive interruption and a new service worker restores an unclassified stored post', async () => {
  const first = worker();
  first.context.RadarDirectX = { ...first.context.RadarDirectX, read: async (_signal, options) => {
    await options.onCheckpoint({ posts: [post()], contextCache: {} });
    throw new Error('X_TIMEOUT');
  } };
  await first.events.startup();
  assert.equal(first.local.directXPendingPosts[0].id, '401');
  const next = worker(first.local);
  next.context.RadarDirectX = { ...next.context.RadarDirectX, read: async (_signal, options) => {
    assert.equal(options.retainedPosts[0].id, '401');
    return { items: next.context.RadarDirectX.restorePosts(options.retainedPosts), contextCache: {}, diagnostics: diagnostics() };
  } };
  await next.events.startup(); await finishPublicResume(next);
  assert.ok(next.local.hintSnapshot.items.some(item => item.id === '401'));
  assert.ok(next.notifications['hint:401']);
  const history = JSON.stringify(next.local.notificationHistory);
  await next.events.startup(); await finishPublicResume(next);
  assert.equal(JSON.stringify(next.local.notificationHistory), history);
});

test('a successful scan records classification stages and a category toggle still cancels a pending alert', async () => {
  const w = worker();
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({
    items: w.context.RadarDirectX.normalize([post(), post('402', 'An unrelated ordinary post')]), diagnostics: diagnostics(), contextCache: {} }) };
  await w.events.startup();
  assert.equal(w.local.signalSnapshot.leadStatus.classification.hints, 1);
  assert.equal(w.local.signalSnapshot.leadStatus.classification.other, 1);
  const result = await w.send({ type: 'SAVE_SETTINGS', settings: { ...w.local.settings, monitorSignals: false } }, w.sender('options'));
  assert.equal(result.ok, true);
  assert.equal(w.local.settings.monitorSignals, false);
  assert.equal(w.local.directXPendingPosts, undefined);
  await finishPublicResume(w);
  assert.equal(w.notifications['hint:401'], undefined);
});

test('turning monitoring off during a scan prevents a late checkpoint from restoring deleted public data', async () => {
  const w = worker(); let options, entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async (_signal, value) => {
    options = value; entered(); await blocked;
    return { items: w.context.RadarDirectX.normalize([post()]), diagnostics: diagnostics(), contextCache: {} };
  } };
  const scan = w.context.refreshSignals();
  await started;
  const result = await w.send({ type: 'SAVE_SETTINGS', settings: { ...w.local.settings, monitorSignals: false } }, w.sender('options'));
  assert.equal(result.ok, true);
  await options.onCheckpoint({ posts: [post()], contextCache: { secret: {} } });
  release(); await scan;
  assert.equal(w.local.directXPendingPosts, undefined);
  assert.equal(w.local.directXContextCache, undefined);
  assert.ok(!w.local.signalSnapshot?.activeSignals?.length);
});

test('worker initialization prunes an expired raw archive even when the network fails', async () => {
  const w = worker({ directXPendingPosts: [{ ...post(), createdAt: '2026-10-01T00:00:00Z' }] });
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => { throw new Error('X_TIMEOUT'); } };
  await w.events.startup();
  assert.equal(w.local.directXPendingPosts.length, 0);
});

test('extension update reclassifies a stored previously unclassified post and keeps notification receipts intact', async () => {
  const receipt = { observedAt: NOW - 3600000, publishedAt: Date.parse(post().createdAt), expiresAt: NOW + 3600000 };
  const w = worker({ directXPendingPosts: [post()], seenSignalIds: ['401'],
    publicAlertState: { entries: { '401': receipt } }, hintSnapshot: { items: [] } });
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async (_signal, options) => ({
    items: w.context.RadarDirectX.restorePosts(options.retainedPosts), diagnostics: diagnostics(), contextCache: {} }) };
  await w.events.installed({ reason: 'update' }); await finishPublicResume(w);
  assert.ok(w.notifications['hint:401']);
  assert.equal(w.local.publicAlertState.entries['401'].observedAt, receipt.observedAt);
  const history = JSON.stringify(w.local.notificationHistory);
  await w.events.installed({ reason: 'update' }); await finishPublicResume(w);
  assert.equal(JSON.stringify(w.local.notificationHistory), history);
});
