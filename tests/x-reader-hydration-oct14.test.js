const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const createdAt = new Date().toISOString();

async function readDom({ initialText, finalText, hydrateAfter = 0, media = false, prefix = [], suffix = [], postCreatedAt = createdAt, pathname = '/thsottiaux' } = {}) {
  let step = 0, elapsed = 0;
  function article(text, { id = '900', author = 'thsottiaux', at = createdAt } = {}) {
    const element = { querySelectorAll(selector) {
      const own = selector => selector === 'article[data-testid="tweet"]' ? element :
        selector === 'a' ? { getAttribute: () => `/${author}/status/${id}` } : null;
      if (selector === 'time') return [{ closest: own, getAttribute: () => at }];
      if (selector === '[data-testid="tweetText"]') return text === null ? [] : [{
        localName: 'div', closest: own, childNodes: [{ nodeType: 3, textContent: text }]
      }];
      if (selector === '[data-testid="tweetPhoto"], [data-testid="videoPlayer"]') return media ? [{ closest: own }] : [];
      if (['[data-testid="cardPoll"]', '[data-testid^="UserAvatar-Container-"] img',
        '[role="link"]:not(a)', '[data-testid="tweet-text-show-more-link"]'].includes(selector)) return [];
      throw new Error('Unexpected selector: ' + selector);
    } };
    return element;
  }
  const initial = article(initialText, { at: postCreatedAt }), final = article(finalText, { at: postCreatedAt });
  class Clock extends Date { static now() { return Date.now() + elapsed; } }
  const context = vm.createContext({ location: { origin: 'https://x.com', pathname },
    Date: Clock,
    document: { querySelectorAll: () => [...prefix.map(row => article(row.text, row)), step ? final : initial,
      ...suffix.map(row => article(row.text, row))] },
    window: { innerHeight: 900, scrollBy() { if (!hydrateAfter) step++; } },
    setTimeout: (callback, ms) => { elapsed += ms; if (hydrateAfter && elapsed >= hydrateAfter) step = 1; queueMicrotask(callback); }
  });
  const result = await vm.runInContext(fs.readFileSync(require.resolve('../src/x-reader'), 'utf8'), context);
  return { result, elapsed };
}

test('a recycled article without its own hydrated body cannot erase a collected reset announcement', async () => {
  const announced = 'Global reset landing by EOD PST time. Enjoy';
  const { result } = await readDom({ initialText: announced, finalText: null });
  assert.equal(result.rows.find(row => row.id === '900')?.text, announced);
  assert.equal(result.bodyUnavailableCount, 0);
});

test('a timestamp-only row keeps hydration waiting until its own reset body appears', async () => {
  const announced = 'Global reset landing by EOD PST time. Enjoy';
  const { result, elapsed } = await readDom({ initialText: null, finalText: announced, hydrateAfter: 3000 });
  assert.ok(elapsed >= 3000);
  assert.equal(result.rows.find(row => row.id === '900')?.text, announced);
  assert.equal(result.bodyUnavailableCount, 0);
});

test('a body that never hydrates is bounded and reported without claiming a textual post', async () => {
  const { result, elapsed } = await readDom({ initialText: null, finalText: null });
  assert.equal(result.rows.length, 0);
  assert.equal(result.bodyUnavailableCount, 1);
  assert.equal(result.bodyUnavailable[0].id, '900');
  assert.equal(result.bodyUnavailableLatestAt, Date.parse(createdAt));
  assert.equal(result.mediaOnlyCount, 0);
  assert.ok(elapsed < 24000);
});

test('a media-only article remains separate from missing text and never borrows a reset body', async () => {
  const { result, elapsed } = await readDom({ initialText: null, finalText: null, media: true });
  assert.equal(result.rows.length, 0);
  assert.equal(result.bodyUnavailableCount, 0);
  assert.equal(result.mediaOnlyCount, 1);
  assert.ok(elapsed < 24000);
});

test('direct normalization cannot accept an unloaded empty author body as fresh text evidence', () => {
  const Direct = require('../src/core/direct-x');
  for (const text of ['', '   ', '\n\t']) assert.equal(Direct.normalize([{
    id: '900', author: 'thsottiaux', url: 'https://x.com/thsottiaux/status/900', createdAt, text
  }]).length, 0);
});

test('skipping an unloaded body cannot invent adjacency across that public article', async () => {
  const { result } = await readDom({ initialText: null, finalText: null,
    prefix: [{ id: '899', author: 'someone', text: 'You owe us a banked reset' }],
    suffix: [{ id: '901', author: 'thsottiaux', text: 'OK fine Tuesday' }] });
  const Direct = require('../src/core/direct-x');
  const reply = Direct.normalize(result.rows).find(row => row.id === '901');
  assert.equal(reply.adjacentId, '900');
  assert.equal(reply.replyContext, undefined);
});

async function directRead({ missingOnly = false, qualityRows = false, qualityMetadata, reportedCount = 1, conversationResult, contextCache = {}, extraTimelineRows = [] } = {}) {
  const publicPost = { id: '900', author: 'thsottiaux', text: 'Global reset landing by EOD PST time. Enjoy',
    createdAt, url: 'https://x.com/thsottiaux/status/900' };
  let url;
  const missing = { rows: qualityRows ? [...extraTimelineRows, publicPost] : [], bodyUnavailableCount: reportedCount,
    bodyUnavailable: qualityMetadata ?? [{ id: '900', author: 'thsottiaux', createdAt }] };
  const owner = { tab: { windowId: 1 }, url: value => value, cleanup: async () => true,
    open: async value => { url = value; return { id: 20 }; }, navigate: async (id, value) => { url = value; } };
  const chrome = { permissions: { contains: async () => true },
    tabs: { get: async () => ({ id: 20, windowId: 1, url, status: 'complete', active: false, pinned: false }),
      onUpdated: { addListener() {}, removeListener() {} } },
    scripting: { executeScript: async () => [{ frameId: 0, result: missingOnly || url.endsWith('/with_replies') ? missing :
      url.includes('/status/') ? conversationResult?.(publicPost) ?? { rows: [publicPost], targetId: '900' } : { rows: [...extraTimelineRows, publicPost] } }] }
  };
  const context = vm.createContext({ URL, Date, chrome, setTimeout, clearTimeout,
    RadarTabOwner: { create: () => owner } });
  vm.runInContext(fs.readFileSync(require.resolve('../src/core/direct-x'), 'utf8'), context);
  return context.RadarDirectX.read(new AbortController().signal, { authors: ['thsottiaux'], contextCache });
}

test('a later body-unavailable timeline cannot erase the same complete announcement from an earlier timeline', async () => {
  const read = await directRead();
  assert.equal(read.items.length, 1);
  assert.equal(read.items[0].text, 'Global reset landing by EOD PST time. Enjoy');
  assert.equal(read.diagnostics.bodyUnavailableCount, 0);
  assert.equal(read.diagnostics.timelines[1].bodyUnavailableCount, 1);
});

test('an entirely body-unavailable direct scan fails with its specific reason instead of reporting healthy freshness', async () => {
  const Direct = require('../src/core/direct-x');
  await assert.rejects(directRead({ missingOnly: true }), /X_BODY_UNAVAILABLE/);
  assert.equal(Direct.failureReason(new Error('X_BODY_UNAVAILABLE')), 'body-unavailable');
});

test('stale, invalid and beyond-tolerance future unloaded articles cannot strand current-range collection', async () => {
  for (const postCreatedAt of [new Date(Date.now() - 8 * 86400000).toISOString(),
    new Date(Date.now() + 6 * 60000).toISOString(), '1970-01-01T00:00:00.000Z', 'not-a-date']) {
    const { result } = await readDom({ initialText: null, finalText: null, postCreatedAt,
      suffix: [{ id: '901', author: 'thsottiaux', text: 'Day 8/ Reset' }] });
    assert.equal(result.rows.length, 1, postCreatedAt);
    assert.equal(result.bodyUnavailableCount, 0, postCreatedAt);
    assert.equal(result.bodyUnavailableLatestAt, null, postCreatedAt);
  }
});

test('explicit outdated or invalid missing-body metadata is excluded rather than revived as count-only failure', async () => {
  for (const at of [new Date(Date.now() - 8 * 86400000).toISOString(),
    new Date(Date.now() + 6 * 60000).toISOString(), '1970-01-01T00:00:00.000Z', 'not-a-date']) {
    const result = await directRead({ qualityRows: true,
      qualityMetadata: [{ id: '901', author: 'thsottiaux', createdAt: at }] });
    assert.equal(result.diagnostics.bodyUnavailableCount, 0, at);
    assert.equal(result.diagnostics.bodyUnavailableLatestAt, null, at);
    assert.equal(result.diagnostics.timelines.every(t => t.ok), true, at);
  }
});

test('only current explicit missing bodies and genuinely count-only residuals keep quality incomplete', async () => {
  const stale = { id: '901', author: 'thsottiaux', createdAt: new Date(Date.now() - 8 * 86400000).toISOString() };
  const current = { id: '902', author: 'thsottiaux', createdAt };
  const mixed = await directRead({ qualityRows: true, qualityMetadata: [stale, current], reportedCount: 2 });
  assert.equal(mixed.diagnostics.bodyUnavailableCount, 1);
  assert.deepEqual(Array.from(mixed.diagnostics.bodyUnavailable, item => item.id), ['902']);
  const anonymous = await directRead({ qualityRows: true, qualityMetadata: [], reportedCount: 1 });
  assert.equal(anonymous.diagnostics.bodyUnavailableCount, 1);
  assert.equal(anonymous.diagnostics.bodyUnavailable.length, 0);
});

test('conversation missing-body diagnostics include a preceding public parent but exclude comments after the target', async () => {
  const parent = { id: '899', author: 'someone', text: null };
  const comment = { id: '901', author: 'otherperson', text: null };
  const before = await readDom({ initialText: 'Confirmed', finalText: 'Confirmed',
    prefix: [parent], suffix: [comment], pathname: '/thsottiaux/status/900' });
  assert.deepEqual(Array.from(before.result.bodyUnavailable, row => row.id), ['899']);
  const after = await readDom({ initialText: 'Confirmed', finalText: 'Confirmed',
    suffix: [comment], pathname: '/thsottiaux/status/900' });
  assert.equal(after.result.bodyUnavailableCount, 0);
  assert.equal(after.result.rows.length, 1);
});

test('a target-only conversation with an unloaded preceding body remains pending and is retried instead of cached for six hours', async () => {
  let conversations = 0;
  const pendingConversation = post => { conversations++; return { targetId: post.id, rows: [post],
    bodyUnavailableCount: 1, bodyUnavailable: [{ id: '899', author: 'someone', createdAt }] }; };
  const first = await directRead({ conversationResult: pendingConversation });
  assert.equal(first.diagnostics.bodyUnavailableCount, 1);
  assert.equal(first.diagnostics.conversationFailures, 1);
  assert.equal(first.diagnostics.contextPending, 1);
  assert.equal(first.diagnostics.conversations, 0);
  assert.equal(first.contextCache['900'].result, undefined);
  const second = await directRead({ conversationResult: pendingConversation, contextCache: first.contextCache });
  assert.equal(conversations, 2);
  assert.equal(second.diagnostics.contextPending, 1);
});

test('a previously unloaded conversation completes after its parent body loads on the next read', async () => {
  const first = await directRead({ conversationResult: post => ({ targetId: post.id, rows: [post],
    bodyUnavailableCount: 1, bodyUnavailable: [{ id: '899', author: 'someone', createdAt }] }) });
  const second = await directRead({ contextCache: first.contextCache, conversationResult: post => ({
    targetId: post.id, rows: [{ id: '899', author: 'someone', text: 'Codex limits will reset', createdAt,
      url: 'https://x.com/someone/status/899' }, post] }) });
  assert.equal(second.diagnostics.bodyUnavailableCount, 0);
  assert.equal(second.diagnostics.conversationFailures, 0);
  assert.equal(second.diagnostics.contextPending, 0);
  assert.equal(second.diagnostics.conversations, 1);
  assert.equal(second.items[0].replyContext.id, '899');
  assert.equal(second.contextCache['900'].result.rows.length, 2);
});

test('an exact complete timeline body does not become a missing-body failure when its conversation row is unloaded', async () => {
  const known = { id: '899', author: 'thsottiaux', text: 'Existing public body', createdAt,
    url: 'https://x.com/thsottiaux/status/899' };
  const result = await directRead({ extraTimelineRows: [known], qualityRows: true, qualityMetadata: [], reportedCount: 0,
    conversationResult: post => ({ targetId: post.id, rows: [post], bodyUnavailableCount: 1,
      bodyUnavailable: [{ id: known.id, author: known.author, createdAt: known.createdAt }] }) });
  assert.equal(result.diagnostics.bodyUnavailableCount, 0);
  assert.equal(result.diagnostics.conversationFailures, 0);
  assert.equal(result.diagnostics.contextPending, 1);
  assert.equal(result.contextCache['900'].result, undefined);
  assert.equal(result.items.find(item => item.id === '900').replyContext, undefined);
});

test('a matching ID alone cannot hide an unknown author or timestamp behind a different complete body', async () => {
  const known = { id: '899', author: 'thsottiaux', text: 'Existing public body', createdAt,
    url: 'https://x.com/thsottiaux/status/899' };
  for (const missing of [{ id: known.id, author: 'reach_vb', createdAt },
    { id: known.id, author: known.author, createdAt: new Date(Date.parse(createdAt) - 1).toISOString() }]) {
    const result = await directRead({ extraTimelineRows: [known], qualityRows: true, qualityMetadata: [], reportedCount: 0,
      conversationResult: post => ({ targetId: post.id, rows: [post], bodyUnavailableCount: 1, bodyUnavailable: [missing] }) });
    assert.equal(result.diagnostics.bodyUnavailableCount, 1);
    assert.equal(result.diagnostics.conversationFailures, 1);
    assert.equal(result.contextCache['900'].result, undefined);
  }
});
