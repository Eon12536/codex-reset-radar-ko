const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../src/x-reader.js'), 'utf8');

async function readConversation(viewport, { clamp = 0, targetText, targetPost, now = Date.now() } = {}) {
  let elapsed = 0;
  const scrolls = [];
  const parent = targetPost || { id: '900', author: 'thsottiaux', text: 'Codex: that’s a reset!', at: new Date(now - 3600000).toISOString() };
  if (targetText) parent.text = targetText;
  const reply = { id: '901', author: 'thsottiaux', text: 'Landing tomorrow before 10am PST together with a small ship.', at: new Date(now - 3500000).toISOString() };
  function article(row) {
    const element = { querySelectorAll(selector) {
      const own = selector => selector === 'article[data-testid="tweet"]' ? element :
        selector === 'a' ? { getAttribute: () => `/${row.author}/status/${row.id}` } : null;
      if (selector === 'time') return [{ closest: own, getAttribute: () => row.at }];
      if (selector === '[data-testid="tweetText"]') return [{ localName: 'div', closest: own,
        childNodes: [{ nodeType: 3, textContent: row.text }] }];
      if (selector === '[data-testid="tweet-text-show-more-link"]' && row.truncated)
        return [{ closest: own, tagName: 'SPAN' }];
      return [];
    } };
    return element;
  }
  class Clock extends Date { static now() { return now + elapsed; } }
  const context = vm.createContext({ Date: Clock,
    location: { origin: 'https://x.com', pathname: `/thsottiaux/status/${parent.id}` },
    document: { querySelectorAll: () => viewport(elapsed, parent, reply, scrolls).map(article) },
    window: { innerHeight: 900, scrollBy(x, y) { scrolls.push(y); } },
    setTimeout: (callback, ms) => { elapsed += Math.max(ms, clamp); queueMicrotask(callback); }
  });
  const result = await vm.runInContext(source, context);
  return { result, elapsed, scrolls };
}

test('a loaded ordinary ancestor must not end the search before the reset parent hydrates above a timing reply', async () => {
  const [original, child] = require('./fixtures/tibo-day18-oct23.json').posts;
  const ancestor = { id: '899', author: 'thsottiaux', text: 'Thanks for your feedback.', at: '2026-10-23T04:40:00Z' };
  const { result, scrolls } = await readConversation((ms, target, ignored, moves) =>
    moves.some(y => y < 0) ? [ancestor, { ...original, at: original.createdAt }, target] : [ancestor, target],
    { targetPost: { ...child, at: child.createdAt }, now: Date.parse('2026-10-25T00:00Z') });
  assert.ok(scrolls.some(y => y < 0), 'a preceding ordinary post is not the reset parent');
  const Direct = require('../src/core/direct-x');
  global.RadarTime = require('../src/core/time');
  global.RadarSignals = require('../src/core/signals');
  const News = require('../src/core/news');
  const now = Date.parse('2026-10-25T00:00Z');
  const reply = Direct.conversationContext(Direct.normalize([child], now)[0], result, now);
  assert.equal(reply.replyContext?.id, original.id);
  const schedule = News.schedule(reply);
  assert.equal(schedule.deadlineAt, Date.parse('2026-10-23T18:00Z'));
  assert.match(schedule.text, /10\/24.*3:00.*이전/);
});

test('a reply detail reveals its rendered parent above the initial viewport before returning context', async () => {
  const { result, scrolls, elapsed } = await readConversation((ms, target, ignored, moves) => {
    const original = { ...target, id: '899', text: 'Day 18/ Codex reset day today.', at: new Date(Date.parse(target.at) - 60000).toISOString() };
    return moves.some(y => y < 0) ? [original, target] : [target];
  }, { targetText: 'Landing tomorrow before 10am PST together with a small ship.' });
  assert.ok(scrolls.some(y => y < 0), 'upward inspection is required to reveal a virtualized parent');
  assert.deepEqual(Array.from(result.rows, row => row.id), ['899', '900']);
  assert.ok(elapsed <= 18000);
});

test('an ordinary preceding post without a rendered reset ancestor never supplies a reset schedule', async () => {
  const { result, elapsed, scrolls } = await readConversation((ms, target) => [
    { ...target, id: '899', text: 'Thanks for your feedback.', at: new Date(Date.parse(target.at) - 60000).toISOString() }, target
  ], { targetText: 'Landing tomorrow before 10am PST together with a small ship.' });
  const Direct = require('../src/core/direct-x');
  const reply = Direct.conversationContext(Direct.normalize([result.rows.at(-1)])[0], result);
  assert.equal(reply.replyContext, undefined);
  assert.ok(scrolls.length > 0 && scrolls.length <= 6);
  assert.ok(elapsed <= 18000);
});

test('parent recovery cannot invent a relationship when parent and target never render together', async () => {
  const { result, elapsed } = await readConversation((ms, target, ignored, moves) => {
    const original = { ...target, id: '899', text: 'Day 18/ Codex reset day today.', at: new Date(Date.parse(target.at) - 60000).toISOString() };
    return moves.at(-1) < 0 ? [original] : [target];
  }, { targetText: 'Landing tomorrow before 10am PST together with a small ship.' });
  assert.deepEqual(Array.from(result.rows, row => row.id), ['900']);
  assert.ok(elapsed <= 18000);
});

test('detail reader retains a timing reply seen before its viewport is recycled', async () => {
  const { result, elapsed } = await readConversation((ms, parent, reply) => ms < 1000 ? [parent, reply] : [parent]);
  assert.deepEqual(Array.from(result.followUps, row => row.id), ['901']);
  assert.deepEqual(Array.from(result.rows, row => row.id), ['900']);
  assert.ok(elapsed <= 18000);
});

test('detail reader retains a reply appearing briefly during parent hydration', async () => {
  const { result, elapsed } = await readConversation((ms, parent, reply) => ms >= 3000 && ms < 4000 ? [parent, reply] : [parent]);
  assert.deepEqual(Array.from(result.followUps, row => row.id), ['901']);
  assert.deepEqual(Array.from(result.rows, row => row.id), ['900']);
  assert.ok(elapsed <= 18000);
});

test('detail reader waits within its remaining budget for late timing reply hydration', async () => {
  const { result, elapsed } = await readConversation((ms, parent, reply) => ms >= 9500 ? [parent, reply] : [parent], { clamp: 1000 });
  assert.deepEqual(Array.from(result.followUps, row => row.id), ['901']);
  assert.deepEqual(Array.from(result.rows, row => row.id), ['900']);
  assert.ok(elapsed >= 9500 && elapsed <= 18000);
});

test('an earlier ordinary self-reply cannot stop the search for a late timing reply', async () => {
  const { result, elapsed } = await readConversation((ms, parent, reply) => [parent,
    { ...reply, id: '905', text: 'Thanks for the feedback!' }, ...(ms >= 9500 ? [reply] : [])], { clamp: 1000 });
  assert.ok(result.followUps.some(row => row.id === '901'));
  assert.deepEqual(Array.from(result.rows, row => row.id), ['900']);
  assert.ok(elapsed >= 9500 && elapsed <= 18000);
});

test('a complete timing body replaces a previously truncated discovery lead', async () => {
  const { result } = await readConversation((ms, parent, reply) => [parent,
    ms < 3000 ? { ...reply, text: 'A quick update…', truncated: true } : reply]);
  const timing = result.followUps.find(row => row.id === '901');
  assert.equal(timing?.text, 'Landing tomorrow before 10am PST together with a small ship.');
  assert.equal(timing?.truncated, false);
});

test('a later truncated viewport cannot erase an already complete timing body', async () => {
  const { result } = await readConversation((ms, parent, reply) => [parent,
    ms < 1000 ? reply : { ...reply, text: 'A quick update…', truncated: true }]);
  const timing = result.followUps.find(row => row.id === '901');
  assert.equal(timing?.text, 'Landing tomorrow before 10am PST together with a small ship.');
  assert.equal(timing?.truncated, false);
});

test('discovery never promotes later comments into parent evidence or borrows another author', async () => {
  const { result, elapsed } = await readConversation((ms, parent, reply) => [parent,
    { ...reply, id: '902', author: 'someone' },
    { ...reply, id: '903', at: new Date(Date.parse(parent.at) - 1000).toISOString() },
    { ...reply, id: '904', at: new Date(Date.parse(parent.at) + 3 * 86400000).toISOString() }]);
  assert.deepEqual(Array.from(result.followUps, row => row.id), []);
  assert.deepEqual(Array.from(result.rows, row => row.id), ['900']);
  assert.ok(elapsed <= 18000);
});
