const test = require('node:test');
const assert = require('node:assert/strict');
global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
const News = require('../src/core/news');
const Settings = require('../src/core/settings');
const Schedule = require('../src/core/schedule');
const Security = require('../src/core/security');
const Alerts = require('../src/core/public-alerts');
const { makeWorker } = require('./helpers/worker');
const post = (text, author = 'thsottiaux', extra = {}) => ({ id: '811', author, text,
  source: { id: 'codex-lead', weight: 1 }, createdAt: new Date().toISOString(),
  url: `https://x.com/${author}/status/811`, ...extra });

test('all three authors support dated events and launch clues without a fixed clock', () => {
  for (const author of ['OpenAI', 'thsottiaux', 'reach_vb']) for (const [text, topic] of [
    ['Join us for OpenAI DevDay on October 6.', 'event'],
    ['See you at Dev Day tomorrow!', 'event'],
    // Public @thsottiaux posts 2102996313780736363 and 2103375711797211460, observed 2026-09-28.
    ["Can't wait for DevDay next Tuesday. Some really fun stuff.", 'event'],
    ['Been a bit quiet here because internal Slack has been hilarious lately and because we are all locked in on DevDay. Tuesday will be fun.', 'event'],
    ['Introducing GPT-7.', 'launch'], ['This is GPT-7.', 'launch'],
    ['A new Codex release is coming tomorrow.', 'launch'],
    ['Something new is coming. Stay tuned 👀', 'launch'],
    ['We are launching a new model next week.', 'launch']
  ]) {
    const item = post(text, author), hint = Signals.classifyHint(item);
    assert.equal(hint.topic, topic, author + ': ' + text);
    assert.equal(hint.actionable, false);
    assert.equal(hint.eventAt, null);
    assert.equal(Signals.classify(item).actionable, false);
    assert.equal(Schedule.reconcile({}, [item]).events.length, 0);
    const news = News.select(null, { items: [item] }, Settings.sanitize());
    assert.equal(news.label, topic === 'event' ? '행사' : '출시');
    assert.equal(news.kindLabel, '리셋 미확인');
    assert.equal(Security.evidenceUrl(item), item.url);
  }
});

test('unrelated posts, stale events, untrusted authors and quoted-only product clues are excluded', () => {
  for (const text of ['Lunch tomorrow.', 'My flight tomorrow.', 'DevDay recap from last week.',
    'Claude launches tomorrow.', 'Password reset tomorrow.', 'The new Codex release is not coming.',
    'Our incident investigation is ongoing.', 'Codex launched yesterday.', '👀'])
    assert.equal(Signals.classifyHint(post(text)).candidate, false, text);
  assert.equal(Signals.classifyHint(post('DevDay tomorrow', 'someone')).candidate, false);
  assert.equal(Signals.classifyHint(post('DevDay tomorrow', 'OpenAI', { createdAt: new Date(Date.now() - 8 * 86400000).toISOString() })).candidate, false);
});

test('new ChatGPT capabilities announced with can now are launch news without becoming reset alerts', () => {
  for (const author of ['OpenAI', 'thsottiaux', 'reach_vb']) for (const text of [
    'One more thing, you can now build and deploy MCP servers right through ChatGPT.',
    'You can now deploy plugins in ChatGPT.',
    'Now everyone can use the new ChatGPT feature.'
  ]) {
    const item = post(text, author);
    const hint = Signals.classifyHint(item);
    assert.equal(hint.topic, 'launch');
    assert.equal(hint.actionable, false);
    assert.equal(Signals.classify(item).actionable, false);
    assert.equal(News.select(null, { items: [item] }, Settings.sanitize()).label, '출시');
  }
  for (const text of ['You can use ChatGPT for coding.', 'You can now order lunch.',
    'You cannot now deploy plugins in ChatGPT.', 'Yesterday you could deploy plugins in ChatGPT.'])
    assert.equal(Signals.classifyHint(post(text)).candidate, false, text);
});

test('dotted model versions remain in their announcement sentence without merging unrelated sentences', () => {
  for (const author of ['OpenAI', 'thsottiaux', 'reach_vb']) for (const text of [
    'GPT-6.1 Sol is now available.', 'GPT-5.6 Luna is rolling out today.',
    'GPT-6.1.2 is launching tomorrow.', 'The GPT-6.1 release is coming soon.'
  ]) {
    const item = post(text, author);
    assert.equal(Signals.classifyHint(item).topic, 'launch', text);
    assert.equal(Signals.classify(item).actionable, false, text);
    assert.equal(News.select(null, { items: [item] }, Settings.sanitize()).label, '출시');
  }
  for (const text of ['GPT-6.1 is not available.', 'GPT-6.1 was released yesterday.',
    'We like GPT-6.1. Lunch is available now.', 'We like GPT-6.1. My flight is coming tomorrow.'])
    assert.equal(Signals.classifyHint(post(text)).candidate, false, text);
});

test('short teaser replies require exact preceding launch/event context', () => {
  const item = post('👀');
  const context = { id: '810', targetId: item.id, relation: 'conversation-before', text: 'Our next ChatGPT release is coming.', url: 'https://x.com/OpenAI/status/810' };
  assert.equal(Signals.classifyHint({ ...item, replyContext: context }).topic, 'launch');
  for (const change of [{ relation: 'adjacent-unverified' }, { targetId: '999' }, { text: 'New ChatGPT release was last week.' }])
    assert.equal(Signals.classifyHint({ ...item, replyContext: { ...context, ...change } }).candidate, false);
});

test('actual reset promises and banked grants retain their existing priority', () => {
  const promised = post('At DevDay tomorrow we will reset Codex usage limits.', 'OpenAI');
  const assessment = Signals.classify(promised);
  assert.equal(assessment.actionable, true);
  assert.equal(Signals.classifyHint(promised).candidate, false);
  assert.equal(News.select({ activeSignals: [{ ...promised, assessment }] }, null, Settings.sanitize()).label, 'reset');
  const grant = post('At DevDay we gave everyone a banked reset.', 'reach_vb');
  assert.equal(News.select({ reports: [grant] }, { items: [grant] }, Settings.sanitize()).label, 'Banked');
});

test('profile URLs survive projections while unsafe image locations are rejected', () => {
  const avatarUrl = 'https://pbs.twimg.com/profile_images/123/example_normal.jpg';
  for (const text of ['DevDay tomorrow', 'We gave everyone a banked reset.', 'Resets all propagated.']) {
    const item = post(text, 'OpenAI', { avatarUrl });
    assert.equal(News.select({ reports: [item] }, { items: [item] }, Settings.sanitize()).item.avatarUrl, avatarUrl);
  }
  for (const value of ['https://pbs.twimg.com.evil.test/profile_images/123/x.png', 'https://pbs.twimg.com/media/x.jpg',
    'https://pbs.twimg.com/profile_images/123/x.svg', 'https://pbs.twimg.com/profile_images/123/x.png?token=x', 'data:image/png;base64,AA', 'javascript:alert(1)'])
    assert.equal(Signals.avatarUrl(value), null);
});

test('new event classification does not re-notify old or already observed tweets', () => {
  const old = post('DevDay tomorrow', 'OpenAI', { createdAt: new Date(Date.now() - 4 * 86400000).toISOString() });
  assert.equal(Signals.classifyHint(old).candidate, true);
  assert.equal(Alerts.allowed(old, Alerts.observe(null, [old])), false);
  const item = post('Introducing GPT-7', 'OpenAI');
  assert.equal(Alerts.allowed(item, Alerts.observe(null, [item], { knownIds: [item.id] })), false);
  assert.equal(Alerts.allowed(item, Alerts.observe(null, [item]), { ['hint:' + item.id]: Date.now() }), false);
});

test('product notifications follow candidate opt-in and explicitly say reset unconfirmed', async () => {
  const item = post('Introducing GPT-7', 'OpenAI');
  const worker = makeWorker({ stored: { settings: { monitorSignals: true, monitorLeadSource: true, notifyHints: true, quietHoursEnabled: false } } });
  await worker.context.maybeNotifyHint(item);
  assert.equal(worker.notifications['hint:811'].title, 'OpenAI 출시·행사 소식 · 리셋 미확인');
  assert.match(worker.notifications['hint:811'].message, /리셋 확정이 아닙니다/);
  const off = makeWorker({ stored: { settings: { monitorSignals: true, monitorLeadSource: true, notifyHints: false } } });
  await off.context.maybeNotifyHint(item);
  assert.equal(Object.keys(off.notifications).length, 0);
});

test('dated events retain their date and clock events keep the event badge', () => {
  const dateOnly = News.select(null, { items: [post('Join us for DevDay on October 6.')] }, Settings.sanitize());
  assert.equal(dateOnly.timing, 'October 6');
  const timed = News.select(null, { items: [post('Join us for OpenAI DevDay tomorrow at 10am PT.', 'OpenAI')] }, Settings.sanitize());
  assert.equal(timed.label, '행사');
  assert.match(timed.timing, /한국/);
});
