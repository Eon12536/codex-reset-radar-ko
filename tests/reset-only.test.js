const test = require('node:test');
const assert = require('node:assert/strict');
global.RadarTime = require('../src/core/time');
global.RadarSignals = require('../src/core/signals');
const Scope = require('../src/core/reset-scope');
const Semantic = require('../src/core/semantic');
const News = require('../src/core/news');
const Settings = require('../src/core/settings');
const { makeWorker, json } = require('./helpers/worker');
const NOW = Date.parse('2026-10-23T03:00:00Z');
// Topic-gating tests exercise per-post delivery; daily aggregation has its own integration suite.
const settings = Settings.sanitize({ dailyResetDigest: false, monitorAccount: false, monitorStatusSource: false,
  monitorHistorySource: false, monitorCommunitySource: false, quietHoursEnabled: false });
const post = (text, id = '901') => ({ id, author: 'thsottiaux', text,
  createdAt: new Date(NOW - 3600000).toISOString(), url: `https://x.com/thsottiaux/status/${id}`,
  source: { id: 'codex-lead', weight: 1 } });
const negatives = ['Burn those tokens', 'Spend those tokens!', 'New milestone to celebrate tomorrow.',
  'Introducing GPT-7.', 'ChatGPT can now use a new tool.', 'DevDay tomorrow at 10am PT.',
  'A surprise gift for Codex fans tomorrow.', 'Tuesday at 3am', 'Done', 'All fixed',
  'Reset your password tomorrow.', 'We will reset the database today.', 'Reset the context window.',
  'Claude limits will reset tomorrow.', 'I reset my brain today.', 'My work dot filed my tax documents.'];
for (const text of negatives) test('reset-only excludes unsupported topic: ' + text, async () => {
  const item = post(text);
  assert.equal(Scope.allows(item, settings), false);
  // Even a confident, exact-quote model false positive cannot bypass topical evidence.
  const api = { availability: async () => 'available', create: async () => ({
    prompt: async (_input, cfg) => cfg.responseConstraint.type === 'boolean' ? 'true' :
      JSON.stringify({ category: 'forecast', evidence: text }), destroy() {} }) };
  const result = await Semantic.judge(item, { api });
  assert.equal(result.category, 'unrelated');
  assert.equal(Semantic.hint({ ...item, semantic: result }, { now: NOW }), null);
});

for (const text of ['Global reset landing by EOD PST time. Enjoy', 'Day 13/ Le limit reset',
  'Day 17/ Bet you thought we forgot, but no, it’s reset day today.',
  'We added a banked reset to all accounts.', 'Resets all propagated. Have a good weekend!',
  'Your quota gets a fresh start after dinner.', 'A fresh allowance for everyone tomorrow.',
  'For context, we will reset Codex usage limits tomorrow.'])
  test('reset-only retains topical evidence: ' + text, () => assert.equal(Scope.allows(post(text), settings), true));

test('default filtering applies to existing installs, with an explicit legacy opt-out', () => {
  assert.equal(Settings.sanitize().resetOnly, true);
  assert.equal(Settings.sanitize({ notifyHints: true }).resetOnly, true);
  assert.equal(Settings.sanitize({ resetOnly: false }).resetOnly, false);
  assert.equal(Scope.allows(post('DevDay tomorrow.'), { resetOnly: false }), true);
  assert.equal(Scope.allows({ ...post('Service incident resolved.'), source: { id: 'openai-status' } }, { ...settings, monitorStatusSource: true }), true);
});

test('only authenticated, preceding reset context admits short confirmations and timing replies', () => {
  const parent = post('Day 13/ Le limit reset', '900');
  const item = { ...post('Done'), createdAt: new Date(NOW).toISOString() };
  const ref = { ...parent, targetId: item.id, relation: 'conversation-before' };
  for (const text of ['Done', 'Completed!', 'All done.', 'Lands tomorrow before 10am PST.', 'Tuesday 👀'])
    assert.equal(Scope.allows({ ...item, text, replyContext: ref }, settings), true, text);
  for (const patch of [{ text: 'Lunch tomorrow.' }, { relation: 'adjacent-unverified' }, { targetId: '999' },
    { url: 'https://evil.invalid/900' }, { createdAt: item.createdAt }, { truncated: true },
    { createdAt: undefined }, { author: 'somebody' }])
    assert.equal(Scope.allows({ ...item, replyContext: { ...ref, ...patch } }, settings), false, JSON.stringify(patch));
  assert.equal(Scope.allows({ ...item, text: 'I bought a new car today.', replyContext: ref }, settings), false);
});

test('reset polls count bounded public choices, not arbitrary model labels', () => {
  const poll = { ...post('To calibrate'), pollOptions: ['Great release', 'Needs a reset'] };
  assert.equal(Scope.allows(poll, settings), true);
  for (const pollOptions of [['Great release', 'Needs a password reset'], ['Great release', 'No reset'], ['red', 'blue']])
    assert.equal(Scope.allows({ ...poll, pollOptions }, settings), false);
});

function worker(stored = { settings }, rows = []) {
  const w = makeWorker({ stored, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  w.context.LanguageModel = { availability: async () => 'available', create: async () => ({
    prompt: async (input, cfg) => cfg.responseConstraint.type === 'boolean' ? 'true' :
      JSON.stringify({ category: 'forecast', evidence: JSON.parse(input).text }), destroy() {} }) };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: rows, diagnostics: {
    posts: rows.length, timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai']
      .map(author => ({ kind, author, ok: true, stopReason: 'seven-days' }))) } }) };
  return w;
}

test('mixed collection keeps raw observations but displays and notifies only reset evidence despite forced AI positives', async () => {
  const rows = [...negatives.map((text, i) => post(text, String(910 + i))),
    post('We will reset Codex usage limits tomorrow.', '990'),
    post('We added a banked reset to all accounts.', '991')];
  const w = worker({ settings }, rows);
  await w.context.refreshSignals();
  assert.equal(w.local.signalSnapshot.leadStatus.directScan.posts, rows.length);
  const news = w.context.RadarNews.list(w.local.signalSnapshot, w.local.hintSnapshot, settings);
  assert.deepEqual(Array.from(news, item => item.item.id).sort(), ['990', '991']);
  assert.deepEqual(Object.keys(w.notifications).sort(), ['report:991', 'signal:990']);
  assert.equal(w.local.hintSnapshot.events.length, 0);
  assert.equal(w.local.semanticStatus.pending, 0);
  assert.equal(w.local.signalSnapshot.reports[0].assessment.report, 'credit-grant');
});

test('upgrade removes unrelated cached rows, pending and visible toasts without sending them again', async () => {
  const old = post('Burn those tokens', '901');
  const legacy = worker({ settings: { ...settings, resetOnly: false } }, [old]);
  legacy.context.RadarTime = { ...legacy.context.RadarTime, isQuietHours: () => true };
  await legacy.context.refreshSignals();
  assert.equal(legacy.local.pendingNotifications.length, 1);
  delete legacy.local.settings.resetOnly; // Existing installs have no saved value yet.
  const next = worker(structuredClone(legacy.local));
  next.notifications['hint:901'] = { title: 'Old unrelated toast' };
  assert.equal(next.context.RadarBadge.view(next.local, settings, { now: NOW }).publicItems.length, 0,
    'stale cached hints cannot mark the badge even before worker initialization');
  await next.context.ensureSecurity();
  assert.equal(next.local.hintSnapshot.items.length, 0);
  assert.equal(next.local.pendingNotifications.length, 0);
  assert.equal(next.notifications['hint:901'], undefined);
  assert.equal(next.context.RadarNews.list(next.local.signalSnapshot, next.local.hintSnapshot, settings).length, 0);
  await next.context.flushPendingNotifications();
  assert.equal(Object.keys(next.notifications).length, 0);
});

test('turning on reset-only clears legacy event and celebration schedules while preserving reset alerts', async () => {
  const rows = [post('DevDay tomorrow at 10am PT.', '901'), post('New milestone to celebrate tomorrow.', '902'),
    post('This celebration is moved to tomorrow.', '903'), post('We will reset Codex usage limits tomorrow.', '990')];
  rows[1].createdAt = new Date(NOW - 7200000).toISOString();
  rows[2].inReplyToId = '902';
  const w = worker({ settings: { ...settings, resetOnly: false, semanticEnabled: false } }, rows);
  await w.context.refreshSignals();
  assert.ok(Object.keys(w.notifications).some(id => id.startsWith('event:')));
  assert.ok(w.local.scheduleSnapshot.events.some(event => event.original.id === '902'));
  await w.context.saveSettings({ ...w.local.settings, resetOnly: true });
  assert.equal(w.local.hintSnapshot.events.length, 0);
  assert.equal(w.local.scheduleSnapshot.events.some(event => event.original.id === '902'), false);
  assert.deepEqual(Object.keys(w.notifications), ['signal:990']);
});
