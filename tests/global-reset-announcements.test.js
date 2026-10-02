const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
const Direct = require('../src/core/direct-x');
const News = require('../src/core/news');
const Settings = require('../src/core/settings');
const { makeWorker, json } = require('./helpers/worker');
const fixture = require('./fixtures/tibo-global-reset-2026-10-02.json');
const now = Date.parse(fixture.observedAt);
const item = { ...fixture.post, source: { id: 'codex-lead', weight: 1 } };

test('the independently discovered global reset landing announcement is visible as an explicit reset', () => {
  const [normalized] = Direct.normalize([fixture.post], now);
  const assessment = Signals.classify(normalized, { now });
  assert.equal(assessment.actionable, true);
  assert.equal(assessment.confidence, 'high');
  assert.equal(Signals.classifyHint(normalized, { now }).candidate, false);
  const news = News.list({ activeSignals: [{ ...normalized, assessment }] }, {}, Settings.sanitize(), { now });
  assert.equal(news[0]?.item.id, fixture.post.id);
  assert.equal(news[0]?.label, 'reset');
  assert.equal(news[0]?.kind, 'unknown');
  assert.equal(News.schedule(item).instant, Date.parse('2026-10-02T18:00:00Z'));
  for (const file of ['../src/core/signals', '../src/core/direct-x', '../src/x-reader', '../src/background'])
    assert.ok(!fs.readFileSync(require.resolve(file), 'utf8').includes(item.id), file);
});

test('forthcoming reset delivery verbs work for all monitored authors, including compact follow-ups', () => {
  for (const author of ['thsottiaux', 'reach_vb', 'OpenAI']) for (const text of [
    'Global reset landing tomorrow 10am PST for all paid ChatGPT accounts.',
    'Another reset lands tomorrow morning.', 'Resets are arriving next week.',
    'The reset is rolling out later today.', 'More resets happening on Friday.',
    'Global reset will be landing tomorrow.'
  ]) assert.equal(Signals.classify({ ...item, author, text }, { now }).actionable, true, author + ': ' + text);
});

test('the independently observed VB calendar announcement is reset news rather than a product-time clue', () => {
  // Visible wording from https://x.com/reach_vb/status/2105868331039510878.
  // The existing fixture timestamp is used only as a deterministic test clock.
  const text = 'GPT 6.1 Sol is now a good, cheap AND fast model, sir!\n\nAlso, global reset on Friday, 2nd October - 10AM PT\n\nEnjoy!!';
  for (const author of ['thsottiaux', 'reach_vb', 'OpenAI']) {
    const post = { ...item, author, text };
    assert.equal(Signals.classify(post, { now }).actionable, true, author);
    assert.equal(Signals.classifyHint(post, { now }).candidate, false, author);
    assert.equal(Signals.resetKind(post), 'unknown');
    assert.equal(News.schedule(post).instant, Date.parse('2026-10-02T17:00:00Z'));
  }
  for (const text of ['Reset on Friday.', 'Another global reset is on next Friday.', 'And resets are on Tuesday.'])
    assert.equal(Signals.classify({ ...item, text }, { now }).actionable, true, text);
  for (const text of ['Global reset on Friday never happened.', 'Global reset on Friday was a success.',
    'Global reset on Friday did not happen.', 'Previous global reset on Friday.',
    'I heard global reset on Friday.', 'Maybe global reset on Friday.', 'Global reset on Friday?',
    'Global reset on Friday, if we can.', 'Global reset on Friday was cancelled.',
    'Banked reset on Friday.', 'I asked for a global reset on Friday.'])
    assert.equal(Signals.classify({ ...item, text }, { now }).actionable, false, text);
  assert.equal(Signals.classify({ ...item, author: 'someone', text: 'Global reset on Friday.' }, { now }).actionable, false);
});

test('a dated VB reset announcement follows the official-reset notification path even when hints are off', async () => {
  const post = { external_id: '815', content: 'Also, global reset on Friday, 2nd October - 10AM PT',
    published_at: new Date().toISOString(), metadata: { author_user_name: 'reach_vb' } };
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false, quietHoursEnabled: false, notifyHints: false } },
    fetcher: async () => json({ items: [post] }) });
  await w.context.refreshSignals();
  assert.ok(w.local.signalSnapshot.activeSignals.some(signal => signal.id === '815'));
  assert.ok(w.notifications['signal:815']);
  assert.equal(w.notifications['hint:815'], undefined);
  const accepted = w.local.notificationHistory['signal:815'];
  await w.context.refreshSignals();
  assert.equal(w.local.notificationHistory['signal:815'], accepted);
});

test('delivery wording cannot promote speculation, hearsay, old news, other products or Banked credits', () => {
  for (const text of [
    'Maybe a global reset landing tomorrow.', 'Is a global reset landing tomorrow?',
    'No global reset landing tomorrow.', 'Global reset is not landing tomorrow.',
    'I heard a global reset landing tomorrow.', 'Gia said global reset landing tomorrow.',
    'A global reset landed yesterday. A new product is arriving tomorrow.',
    'Global reset landing tomorrow, but cancelled.', 'Global reset landing tomorrow if we can.',
    'Global password reset landing tomorrow.', 'Git reset landing tomorrow.',
    'Banked reset credits landing tomorrow.', 'A global reset. The new product is landing tomorrow.'
  ]) assert.equal(Signals.classify({ ...item, text }, { now }).actionable, false, text);
  for (const change of [{ author: 'someone' }, { source: { id: 'github-community' } }])
    assert.equal(Signals.classify({ ...item, ...change }, { now }).actionable, false);
});

test('a frozen public feed cannot hide a fresh original post collected directly from X', async () => {
  const fresh = { ...fixture.post, createdAt: new Date().toISOString() };
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorDirectX: true,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false,
    quietHoursEnabled: false, notifyHints: false } }, fetcher: async () => json({ items: [
      { external_id: '120', content: 'Old product news.', published_at: '2026-09-06T21:51:18', metadata: { author_user_name: 'thsottiaux' } }
    ] }) });
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => ({ items: Direct.normalize([fresh]),
    diagnostics: { posts: 1, pages: 6, timelines: ['posts', 'replies'].flatMap(kind =>
      ['thsottiaux', 'reach_vb', 'openai'].map(author => ({ author, kind, ok: true, stopReason: 'seven-days' }))) } }) };
  await w.context.refreshSignals();
  assert.ok(w.local.signalSnapshot.activeSignals.some(signal => signal.id === fresh.id));
  assert.ok(w.notifications['signal:' + fresh.id]);
  const history = JSON.stringify(w.local.notificationHistory);
  await w.context.refreshSignals();
  assert.equal(JSON.stringify(w.local.notificationHistory), history);
});

test('previously observed but unclassified recent originals become visible without duplicating sent alerts', async () => {
  const fresh = { ...item, createdAt: new Date().toISOString() };
  const w = makeWorker({ stored: { settings: { monitorAccount: false, monitorStatusSource: false,
    monitorHistorySource: false, monitorCommunitySource: false, quietHoursEnabled: false },
    seenSignalIds: [fresh.id], publicAlertState: { entries: { [fresh.id]: { observedAt: Date.now() - 60000,
      publishedAt: Date.parse(fresh.createdAt), expiresAt: Date.now() + 3600000, catchUp: false } } } },
    fetcher: async () => json({ items: [{ external_id: fresh.id, content: fresh.text,
      published_at: fresh.createdAt, metadata: { author_user_name: fresh.author } }] }) });
  await w.context.refreshSignals();
  assert.ok(w.notifications['signal:' + fresh.id]);
  const accepted = w.local.notificationHistory['signal:' + fresh.id];
  await w.context.refreshSignals();
  assert.equal(w.local.notificationHistory['signal:' + fresh.id], accepted);
});

test('unrelated later prose does not erase an explicit reset clock, while actual timing qualifiers remain unresolved', () => {
  for (const prose of ['Speeds recovered after the load spike.', 'We tested this before launch.', 'This improved by a lot.'])
    assert.equal(News.schedule({ ...item, text: 'Global reset landing tomorrow 10am PST. ' + prose }).instant,
      Date.parse('2026-10-02T18:00:00Z'), prose);
  for (const text of ['Global reset landing tomorrow after 10am PST.', 'Global reset landing tomorrow by 10am PST.',
    'Global reset landing tomorrow until 10am PST.', 'Global reset landing tomorrow 10am PST, but not confirmed.',
    'Global reset landing tomorrow 10am PST or Friday 11am PST.'])
    assert.equal(News.schedule({ ...item, text }).instant, undefined, text);
});
