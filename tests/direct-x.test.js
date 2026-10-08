const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Direct = require('../src/core/direct-x');
global.RadarTime = require('../src/core/time');
const Signals = require('../src/core/signals');
const PAGE = 'https://x.com/thsottiaux/with_replies';
const POST_PAGE = 'https://x.com/thsottiaux';
const row = (id, author, text) => ({ id, author, text, url: `https://x.com/${author}/status/${id}`, createdAt: new Date().toISOString() });

test('the supplied real reply needs surrounding reset context and remains uncertain', () => {
  const reply = row('2101352781219258527', 'thsottiaux', 'OK fine. But it’s also still coming in Tuesday');
  const parent = row('2101093319501664368', 'udiWertheimer', 'you owe us a banked reset');
  parent.createdAt = new Date(Date.now() - 3600000).toISOString();
  const item = Direct.normalize([parent, reply])[0];
  assert.equal(Signals.classifyHint(item).candidate, true);
  assert.equal(Signals.classify(item).actionable, false);
  assert.equal(item.replyContext.relation, 'adjacent-unverified');
  assert.equal(Signals.classifyHint(Direct.normalize([reply])[0]).candidate, false);
  assert.equal(Signals.classifyHint(Direct.normalize([{ ...parent, text: 'A product launch on Tuesday.' }, reply])[0]).candidate, false);
});

test('only bounded recent Tibo posts and validated public status URLs survive normalization', () => {
  const good = row('123', 'thsottiaux', 'Maybe dust off the reset button next Tuesday.');
  const invalid = [null, { ...good, id: 123 }, { ...good, author: {} }, { ...good, url: 'https://x.com/i/chat' },
    { ...good, url: 'https://x.com.evil.test/thsottiaux/status/123' }, { ...good, createdAt: 'bad date' },
    { ...good, createdAt: new Date(Date.now() - 15 * 86400000).toISOString() },
    { ...good, createdAt: new Date(Date.now() + 86400000).toISOString() }];
  assert.equal(Direct.normalize(invalid).length, 0);
  assert.equal(Direct.normalize(Array.from({ length: 200 }, (_, i) => ({ ...good, id: String(i + 1), url: `https://x.com/thsottiaux/status/${i + 1}`, text: 'a'.repeat(7000) }))).length, 160);
  assert.equal(Direct.normalize([{ ...good, text: 'a'.repeat(7000) }])[0].text.length, 6000);
});

function reader({ permission = true, finalUrl = POST_PAGE, fail = false, timeline, originalTimeline, postFail = false, replyFail = false, conversation, authors = ['thsottiaux'], vbTimeline, active = false, activateOnScript = false } = {}) {
  const calls = [];
  const session = {}, local = {}, alarms = new Map();
  let url = finalUrl;
  const chrome = { permissions: { contains: async value => { calls.push(['permission', value]); return permission; } },
    storage: { local: { get: async key => ({ [key]: local[key] }), set: async value => Object.assign(local, structuredClone(value)), remove: async key => { delete local[key]; } }, session: { get: async key => ({ [key]: session[key] }), set: async value => Object.assign(session, structuredClone(value)), remove: async key => { delete session[key]; } } },
    alarms: { create: async (name, options) => alarms.set(name, options), clear: async name => alarms.delete(name) },
    tabs: { create: async options => { calls.push(['create', options]); url = finalUrl === POST_PAGE ? options.url : finalUrl; return { id: 33, windowId: 1, active }; },
      get: async () => ({ id: 33, windowId: 1, status: 'complete', url, active }), remove: async id => calls.push(['remove', id]),
      update: async (id, options) => { calls.push(['update', options]); url = options.url; },
      onUpdated: { addListener() {}, removeListener() {} } },
    scripting: { executeScript: async value => { const url = new URL(chromeUrl()).origin + new URL(chromeUrl()).pathname;
      calls.push(['script', value]); if (activateOnScript === true || activateOnScript === calls.filter(c => c[0] === 'script').length) active = true; if (fail || (postFail && url === POST_PAGE) || (replyFail && url === PAGE)) throw new Error('mock failure');
      return [{ frameId: 0, result: url.startsWith('https://x.com/OpenAI') ? { rows: [row('789', 'OpenAI', 'Join us for DevDay tomorrow')] } : url.startsWith('https://x.com/reach_vb') ? vbTimeline || {rows: [row('456','reach_vb','Reset should be reflected for everyone')]} : [PAGE, POST_PAGE].includes(url)
        ? (url === POST_PAGE ? originalTimeline || timeline : timeline) || { rows: [row('123', 'thsottiaux', 'Maybe dust off the reset button next Tuesday.')], pages: 8, stopReason: 'no-more-loaded' }
        : (typeof conversation === 'function' ? conversation(url) : conversation) || { rows: [row('123', 'thsottiaux', 'Maybe dust off the reset button next Tuesday.')], targetId: '123' } }]; } } };
  const chromeUrl = () => url;
  const context = vm.createContext({ chrome, URL, Date, crypto: require('node:crypto').webcrypto, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(require.resolve('../src/core/tab-owner'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/core/direct-x'), 'utf8'), context);
  return { core: { ...context.RadarDirectX, read: (signal, options = {}) => context.RadarDirectX.read(signal, {authors, ...options}) }, calls };
}

test('direct reader never requests permissions or creates a tab before opt-in', async () => {
  const r = reader({ permission: false });
  await assert.rejects(r.core.read(new AbortController().signal), /PERMISSION/);
  assert.deepEqual(r.calls.map(c => c[0]), ['permission']);
});

test('reader uses only its own inactive fixed-URL tab and a bundled isolated script, then closes it', async () => {
  const r = reader(); const { items, diagnostics } = await r.core.read(new AbortController().signal);
  assert.equal(items[0].id, '123');
  assert.equal(r.calls.find(c => c[0] === 'create')[1].url.split('#')[0], POST_PAGE);
  assert.match(r.calls.find(c => c[0] === 'create')[1].url, /#radar-x-reader=[a-f0-9-]{36}$/);
  assert.equal(r.calls.find(c => c[0] === 'create')[1].active, false);
  const script = r.calls.find(c => c[0] === 'script')[1];
  assert.equal(script.world, 'ISOLATED'); assert.equal(script.target.tabId, 33);
  assert.deepEqual(Array.from(script.files), ['src/x-reader.js']);
  assert.equal(diagnostics.pages, 16);
  assert.equal(diagnostics.timelines.length, 2);
  assert.equal(diagnostics.conversations, 1);
  assert.deepEqual(r.calls.filter(c => c[0] === 'update').map(c => c[1].url.split('#')[0]), [PAGE, 'https://x.com/thsottiaux/status/123']);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('clock-only Tibo replies trigger a bounded product conversation lookup', async () => {
  const reply = row('123', 'thsottiaux', '10am');
  const parent = row('122', 'someone', 'When is the new ChatGPT release?');
  parent.createdAt = new Date(Date.parse(reply.createdAt) - 60000).toISOString();
  const r = reader({ timeline: { rows: [reply], pages: 1 },
    conversation: { targetId: '123', rows: [parent, reply] } });
  const result = await r.core.read(new AbortController().signal);
  assert.equal(result.diagnostics.conversations, 1);
  assert.equal(result.items[0].replyContext.id, '122');
  assert.equal(Signals.classifyHint(result.items[0]).rule, 'product-time');
});

test('reader refuses redirected pages and leaves a tab navigated elsewhere by the user intact', async () => {
  const r = reader({ finalUrl: 'https://x.com/i/chat' });
  await assert.rejects(r.core.read(new AbortController().signal), /UNAVAILABLE/);
  assert.equal(r.calls.some(c => ['script', 'remove'].includes(c[0])), false);
});

test('failed execution closes only the tab the reader created', async () => {
  const r = reader({ fail: true });
  await assert.rejects(r.core.read(new AbortController().signal), /mock failure/);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('automatic X home/timeline redirects do not accumulate inactive scan tabs across repeated polls', async () => {
  for (const finalUrl of ['https://x.com/home', 'https://x.com/i/timeline', 'https://x.com/home/?from=login', 'https://x.com/THSOTTIAUX/']) {
    const r = reader({ finalUrl });
    for (let i = 0; i < 3; i++) await assert.rejects(r.core.read(new AbortController().signal), /UNAVAILABLE/);
    assert.equal(r.calls.filter(c => c[0] === 'create').length, 3);
    assert.equal(r.calls.filter(c => c[0] === 'remove').length, 3, 'each failed scan must close its own automatically redirected tab');
  }
});

test('a scan tab activated by the user is left open and never read or navigated again', async () => {
  const r = reader({ active: true });
  await assert.rejects(r.core.read(new AbortController().signal), /UNAVAILABLE/);
  assert.equal(r.calls.some(c => ['script', 'update', 'remove'].includes(c[0])), false);
});

test('activation during a scan stops later navigation and preserves the tab the user selected', async () => {
  const r = reader({ activateOnScript: true });
  await assert.rejects(r.core.read(new AbortController().signal), /UNAVAILABLE/);
  assert.equal(r.calls.filter(c => c[0] === 'script').length, 1);
  assert.equal(r.calls.some(c => ['update', 'remove'].includes(c[0])), false);
});

test('user activation leaves earlier collected posts available and reports an incomplete scan', async () => {
  const r = reader({ authors: ['thsottiaux', 'reach_vb'], activateOnScript: 2 });
  const result = await r.core.read(new AbortController().signal);
  assert.deepEqual(Array.from(result.items, item => item.id), ['123']);
  assert.equal(result.diagnostics.stopReason, 'partial');
  assert.equal(result.diagnostics.timelines.length, 2);
  assert.equal(result.diagnostics.timelines[1].ok, false);
  assert.equal(r.calls.filter(c => c[0] === 'script').length, 2);
  assert.equal(r.calls.filter(c => c[0] === 'update').length, 1);
  assert.equal(r.calls.some(c => c[0] === 'remove'), false);
});

test('already cancelled reads do not create a tab', async () => {
  const r = reader(); const controller = new AbortController(); controller.abort();
  await assert.rejects(r.core.read(controller.signal));
  assert.equal(r.calls.some(c => c[0] === 'create'), false);
});

test('both monitored authors get independent original and reply scans', async () => {
  const r=reader({authors:['thsottiaux','reach_vb']});
  const {items,diagnostics}=await r.core.read(new AbortController().signal);
  assert.deepEqual(new Set(items.map(x=>x.author)),new Set(['thsottiaux','reach_vb']));
  assert.equal(diagnostics.timelines.length,4);
  assert.deepEqual(Array.from(diagnostics.timelines,t=>t.author+':'+t.kind),['thsottiaux:posts','reach_vb:posts','thsottiaux:replies','reach_vb:replies']);
  assert.equal(diagnostics.stopReason,'all-timelines');
});

test('VB DOM timeline and conversations retain the correct author', async () => {
  const post=row('567','reach_vb','We will reset Codex limits');
  const {result}=await domRead([[article(post)]],{pathname:'/reach_vb/with_replies'});
  assert.equal(Direct.normalize(result.rows)[0].author,'reach_vb');
  const conversation=await domRead([[article(post)]],{pathname:'/reach_vb/status/567'});
  assert.equal(conversation.result.targetId,'567');
});

test('X access is optional, with no broad tab access or persistent content script', () => {
  const manifest = require('../manifest.json');
  assert.deepEqual(manifest.optional_permissions, ['scripting']);
  assert.deepEqual(manifest.optional_host_permissions, ['https://x.com/*']);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.permissions.includes('tabs'), false);
  assert.equal(manifest.host_permissions.includes('https://x.com/*'), false);
  const source = fs.readFileSync(require.resolve('../src/x-reader'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|document\.cookie|localStorage|sessionStorage|\.innerHTML\s*=/);
});

function article(post, { quoted = false, emoji = false, moreText, moreQuoted = false, quotePost, pollOptions = [], quotedPoll = false } = {}) {
  let expanded = false;
  const textNode = text => ({ nodeType: 3, textContent: text });
  const node = { querySelectorAll(selector) {
    if (selector === '[role="link"]:not(a)') return quotePost ? [{ querySelector(selector) {
      if (selector === 'time') return { getAttribute: () => quotePost.createdAt };
      if (selector === '[data-testid="tweetText"]') return { childNodes: [textNode(quotePost.text)] };
      if (selector === '[data-testid="User-Name"]') return { childNodes: [textNode('Tibo@' + quotePost.author)] };
      return null;
    } }] : [];
    const parent = isQuote => selector => selector === 'article[data-testid="tweet"]' ? node
      : selector === '[role="link"]:not(a)' ? isQuote ? {} : null
      : selector === 'a' ? { getAttribute: () => `/${post.author}/status/${post.id}` } : null;
    if (selector === '[data-testid="cardPoll"]') return pollOptions.length ? [{ closest: parent(quotedPoll),
      querySelectorAll: () => pollOptions.map(label => ({ querySelector: () => ({ childNodes: [textNode(label)] }) })) }] : [];
    if (selector === '[data-testid^="UserAvatar-Container-"] img') return post.avatarUrl ? [{
      closest: selector => selector === 'a' ? { getAttribute: () => '/' + post.author } : parent(false)(selector),
      getAttribute: () => post.avatarUrl
    }] : [];
    if (selector === 'time') return [{ closest: parent(false), getAttribute: () => post.createdAt }];
    if (selector === '[data-testid="tweet-text-show-more-link"]') return !expanded && moreText ? [{ tagName: 'BUTTON', closest: parent(moreQuoted), click() { expanded = true; post = { ...post, text: moreText }; } }] : [];
    if (selector === '[data-testid="tweetText"]') {
      const body = { localName: 'div', closest: parent(false), childNodes: [textNode(post.text),
        { localName: 'deepl-twitter-tweet-link', childNodes: [textNode('unrelated translated reset Tuesday')] }] };
      if (emoji) body.childNodes.push({ nodeName: 'IMG', getAttribute: () => '👀' });
      const quote = { localName: 'div', closest: parent(true), childNodes: [textNode('Codex will reset tomorrow.')] };
      return quoted ? [quote, body] : [body];
    }
    throw new Error(`Unexpected selector: ${selector}`);
  } };
  return node;
}

async function domRead(snapshots, { pathname = '/thsottiaux/with_replies', navigate = false, timerDelay = 0, hydrateAt = 0 } = {}) {
  let step = 0, scrolls = 0, elapsed = 0;
  class Clock extends Date { static now() { return Date.now() + elapsed; } }
  const location = { origin: 'https://x.com', pathname };
  const context = vm.createContext({ location, Date: Clock,
    document: { querySelectorAll: () => snapshots[Math.min(step, snapshots.length - 1)] },
    window: { innerHeight: 900, scrollBy() { scrolls++; step++; if (navigate) location.pathname = '/i/chat'; } },
    setTimeout: (fn, ms) => { elapsed += timerDelay ? Math.max(timerDelay, ms) : 0;
      if (hydrateAt && elapsed >= hydrateAt) step = 1;
      queueMicrotask(fn); } });
  const result = await vm.runInContext(fs.readFileSync(require.resolve('../src/x-reader'), 'utf8'), context);
  return { result, scrolls, elapsed };
}

test('public poll choices are read separately from the body without voting or borrowing a quote poll', async () => {
  const options = ['👌 (great release)', '🫨 (needs a reset)'];
  for (const quotedPoll of [false, true]) {
    const input = row('800', 'thsottiaux', 'To calibrate');
    const { result } = await domRead([[article(input, { pollOptions: options, quotedPoll })]]);
    const item = Direct.normalize(result.rows)[0];
    assert.equal(item.text, 'To calibrate');
    assert.deepEqual(Array.from(item.pollOptions || []), quotedPoll ? [] : options);
    assert.equal(Signals.classifyHint(item).candidate, !quotedPoll);
    assert.equal(Signals.classify(item).actionable, false);
  }
});

test('rendered quote evidence stays separate from the author body and resolves via the original timeline', async () => {
  const parent = row('122', 'thsottiaux', 'Pro 500 did not get the reset. Investigating.');
  parent.createdAt = new Date(Date.now() - 3600000).toISOString();
  const fixed = row('123', 'thsottiaux', 'All fixed.');
  const { result } = await domRead([[article(fixed, { quotePost: parent }), article(parent)]]);
  const items = Direct.linkQuotedContexts(Direct.normalize(result.rows));
  assert.equal(items[0].text, fixed.text);
  assert.equal(items[0].replyContext.id, parent.id);
  assert.equal(Signals.reports(items)[0].assessment.updateStatus, 'resolved');
});

test('scroll collection preserves virtualized early rows and catches a later Tuesday reply with its parent', async () => {
  const parent = row('122', 'udiWertheimer', 'you owe us a banked reset');
  const reply = row('123', 'thsottiaux', 'OK fine. But it’s also still coming in Tuesday');
  const snapshots = [[article(row('120', 'thsottiaux', 'Mind sharing your instructions?'))],
    [article(parent), article(reply)], [article(reply)], [article(row('125', 'thsottiaux', 'Other news'))]];
  const { result, scrolls } = await domRead(snapshots);
  assert.equal(result.rows.length, 4);
  assert.ok(scrolls > 1 && scrolls <= 24);
  const found = Direct.normalize(result.rows).find(item => item.id === '123');
  assert.equal(found.replyContext.id, '122');
  assert.equal(Signals.classifyHint(found).candidate, true);
});

test('DOM extraction ignores quoted and translated bodies and retains original emoji alt text', async () => {
  const { result } = await domRead([[article(row('123', 'thsottiaux', 'Tuesday '), { quoted: true, emoji: true })]]);
  assert.equal(result.rows[0].text, 'Tuesday 👀');
  assert.equal(result.rows[0].url, 'https://x.com/thsottiaux/status/123');
});

test('conversation read includes preceding posts but excludes comments after the requested Tibo reply', async () => {
  const { result, scrolls } = await domRead([[article(row('121', 'someone', 'Codex reset please')),
    article(row('123', 'thsottiaux', 'Tuesday')), article(row('124', 'someone', 'banked reset'))]], { pathname: '/thsottiaux/status/123' });
  assert.deepEqual(Array.from(result.rows, row => row.id), ['121', '123']);
  assert.equal(result.targetId, '123'); assert.equal(scrolls, 0);
});

test('the real EOD reply waits for its preceding grant to hydrate before reading conversation context', async () => {
  const fixture = require('./fixtures/reset-grant-oct8.json');
  const [parent, target] = fixture.posts;
  const read = await domRead([[article(target)], [article(parent), article(target),
    article(row('999', 'someone', 'Loading a banked reset for everyone'))]], {
    pathname: '/thsottiaux/status/' + target.id, timerDelay: 1000, hydrateAt: 4000
  });
  assert.equal(read.scrolls, 0);
  assert.ok(read.elapsed >= 4000);
  assert.deepEqual(Array.from(read.result.rows, item => item.id), [parent.id, target.id]);
  const item = Direct.conversationContext(Direct.normalize([target], Date.parse(fixture.observedAt))[0], read.result, Date.parse(fixture.observedAt));
  assert.equal(Signals.reports([item], { now: Date.parse(fixture.observedAt) })[0].assessment.grantStage, 'timing');
});

test('an EOD-only timeline reply is enriched from the real public conversation', async () => {
  const fixture = require('./fixtures/reset-grant-oct8.json');
  const [parent, target] = fixture.posts;
  const r = reader({ timeline: { rows: [target] }, conversation: { targetId: target.id, rows: [parent, target] } });
  const scan = await r.core.read(new AbortController().signal);
  assert.equal(scan.diagnostics.conversations, 1);
  assert.equal(Signals.reports(scan.items, { now: Date.parse(fixture.observedAt) })[0].assessment.grantStage, 'timing');
});

test('an initially missing EOD parent is retried on the next poll instead of cached for six hours', async () => {
  const fixture = require('./fixtures/reset-grant-oct8.json');
  const [parent, target] = fixture.posts;
  let hydrated = false;
  const r = reader({ timeline: { rows: [target] }, conversation: () => ({ targetId: target.id, rows: hydrated ? [parent, target] : [target] }) });
  const first = await r.core.read(new AbortController().signal);
  assert.equal(Signals.reports(first.items, { now: Date.parse(fixture.observedAt) }).length, 0);
  const cache = JSON.parse(JSON.stringify(first.contextCache));
  cache[target.id].checkedAt = Date.now() - 15 * 60000;
  hydrated = true;
  const next = await r.core.read(new AbortController().signal, { contextCache: cache });
  assert.equal(next.diagnostics.conversations, 1);
  assert.equal(Signals.reports(next.items, { now: Date.parse(fixture.observedAt) })[0].assessment.grantStage, 'timing');
});

test('reader stops on user navigation and never reads private or unrelated paths', async () => {
  const rows = [[article(row('123', 'thsottiaux', 'Tuesday'))]];
  const moved = await domRead(rows, { navigate: true });
  assert.equal(moved.result.rows.length, 0); assert.equal(moved.scrolls, 1);
  const privatePage = await domRead(rows, { pathname: '/i/chat' });
  assert.equal(privatePage.result.rows.length, 0); assert.equal(privatePage.scrolls, 0);
});

test('dates alone qualify only with reset context on the exact conversation, never as a forecast', () => {
  const item = Direct.normalize([row('123', 'thsottiaux', 'Tuesday 👀')])[0];
  const before = row('121', 'someone', 'Could you reset Codex limits?');
  before.createdAt = new Date(Date.now() - 60000).toISOString();
  const result = { targetId: '123', rows: [before, row('123', 'thsottiaux', 'Tuesday 👀')] };
  const enriched = Direct.conversationContext(item, result);
  assert.equal(Signals.classifyHint(item).candidate, false);
  assert.equal(enriched.replyContext.relation, 'conversation-before');
  assert.equal(Signals.classifyHint(enriched).candidate, true);
  assert.equal(Signals.classifyHint(enriched).eventAt, null);
  assert.equal(Signals.classify(enriched).actionable, false);
  assert.equal(Signals.classifyHint({ ...enriched, text: 'The product release is Tuesday.' }).candidate, false);
  assert.equal(Signals.classifyHint({ ...enriched, text: 'We will not reset on Tuesday.' }).candidate, false);
  assert.equal(Direct.conversationContext(item, { ...result, targetId: '999' }).replyContext, undefined);
  assert.equal(Direct.conversationContext(item, { ...result, rows: [result.rows[1], before] }).replyContext, undefined);
});

test('cross-viewport adjacency is not invented and a verified unrelated conversation removes weak context', () => {
  const p = row('122', 'someone', 'banked reset');
  const r = row('123', 'thsottiaux', 'OK fine Tuesday');
  assert.equal(Direct.normalize([p, { ...r, adjacentId: '' }])[0].replyContext, undefined);
  const weak = Direct.normalize([p, r])[0];
  assert.ok(weak.replyContext);
  assert.equal(Direct.conversationContext(weak, { targetId: '123', rows: [r] }).replyContext, undefined);
});

test('direct read enriches a timeline reply from its public conversation and returns bounded diagnostics', async () => {
  const p = row('122', 'someone', 'banked reset please');
  const r = row('123', 'thsottiaux', 'Tuesday');
  const read = reader({ timeline: { rows: [r], pages: 9, stopReason: 'scan-limit' }, conversation: { targetId: '123', rows: [p, r] } });
  const result = await read.core.read(new AbortController().signal);
  assert.equal(result.diagnostics.posts, 1); assert.equal(result.diagnostics.contexts, 1);
  assert.equal(result.items[0].replyContext.id, '122');
  assert.equal(Signals.classifyHint(result.items[0]).candidate, true);
  assert.deepEqual(read.calls.at(-1), ['remove', 33]);
});

test('the user-supplied reply verified on X is recovered without hardcoding it in production', () => {
  const fixture = require('./fixtures/tibo-tuesday-conversation.json');
  const now = Date.parse('2026-09-20T07:00:00Z');
  const item = Direct.normalize([fixture.rows[1]], now)[0];
  assert.equal(Signals.classifyHint(item, { now }).candidate, false);
  const enriched = Direct.conversationContext(item, fixture, now);
  assert.equal(Signals.classifyHint(enriched, { now }).candidate, true);
  assert.equal(Signals.classifyHint(enriched, { now }).eventAt, null);
  for (const name of ['../src/x-reader', '../src/core/direct-x', '../src/core/signals'])
    assert.doesNotMatch(fs.readFileSync(require.resolve(name), 'utf8'), /2101352781219258527/);
});

test('original posts and replies are collected independently and merged without hiding the original reset', async () => {
  const promise = row('900', 'thsottiaux', 'I promised a reset for Tuesday.');
  const burn = row('901', 'thsottiaux', 'Burn those tokens');
  const r = reader({ originalTimeline: { rows: [promise], pages: 2 }, timeline: { rows: [burn], pages: 4 } });
  const { items, diagnostics } = await r.core.read(new AbortController().signal);
  assert.deepEqual(new Set(items.map(item => item.id)), new Set(['900', '901']));
  assert.equal(diagnostics.timelines[0].kind, 'posts');
  assert.equal(diagnostics.timelines[1].kind, 'replies');
  assert.equal(diagnostics.stopReason, 'all-timelines');
  assert.ok(Signals.classify(items.find(item => item.id === '900')).actionable);
});

test('one failed timeline preserves the other result and explicitly marks partial collection', async () => {
  for (const flags of [{ postFail: true }, { replyFail: true }]) {
    const r = reader(flags);
    const result = await r.core.read(new AbortController().signal);
    assert.equal(result.items.length, 1);
    assert.equal(result.diagnostics.stopReason, 'partial');
    assert.equal(result.diagnostics.timelines.filter(t => !t.ok).length, 1);
    assert.deepEqual(r.calls.at(-1), ['remove', 33]);
  }
});

test('long original posts are expanded before classification and quote controls are untouched', async () => {
  const text = 'We are loading a banked reset into all accounts.';
  const own = await domRead([[article(row('123', 'thsottiaux', 'New models are out.'), { moreText: text })]], { pathname: '/thsottiaux' });
  assert.equal(own.result.rows[0].text, text);
  assert.equal(own.result.rows[0].truncated, false);
  assert.equal(own.result.expanded, 1);
  assert.equal(Signals.reports(Direct.normalize(own.result.rows)).length, 1);
  const quote = await domRead([[article(row('123', 'thsottiaux', 'New models are out.'), { moreText: text, moreQuoted: true })]]);
  assert.equal(quote.result.rows[0].text, 'New models are out.');
  assert.equal(quote.result.expanded, 0);
});


test('slow background timers return collected posts before the worker timeout', async () => {
  const snapshots = Array.from({length: 14}, (_, i) => [article(row(String(700 + i), 'thsottiaux', i ? 'Other news' : 'We are loading a banked reset into all accounts.'))]);
  const { result, elapsed } = await domRead(snapshots, { pathname: '/thsottiaux', timerDelay: 3000 });
  assert.equal(result.stopReason, 'time-budget');
  assert.ok(elapsed < 28000);
  assert.ok(Signals.reports(Direct.normalize(result.rows)).some(item => item.id === '700'));
});

test('a recycled truncated row cannot overwrite an already expanded original post', async () => {
  const post = row('999', 'thsottiaux', 'New models are out.');
  const full = 'New models are out. We are loading a banked reset into all accounts.';
  const { result } = await domRead([[article(post, { moreText: full })], [article(post, { moreText: full })]], { pathname: '/thsottiaux' });
  assert.equal(result.rows[0].text, full);
  assert.equal(result.rows[0].truncated, false);
});

test('partial scan diagnostics identify which reading stage failed', async () => {
  const result = await reader({postFail:true}).core.read(new AbortController().signal);
  const failed = result.diagnostics.timelines.find(t => !t.ok);
  assert.equal(failed.kind, 'posts');
  assert.equal(failed.stage, 'reading');
  assert.equal(failed.error, 'page-unavailable');
});

test('conversation lookups advance past the first three replies and reuse verified context across polls', async () => {
  const posts = Array.from({ length: 7 }, (_, i) => row(String(800 + i), 'thsottiaux', 'Tuesday 👀'));
  const parent = { ...row('700', 'someone', 'Could you reset Codex limits?'), createdAt: new Date(Date.now() - 3600000).toISOString() };
  const r = reader({ timeline: { rows: posts }, conversation: url => {
    const item = posts.find(post => post.url === url);
    return { targetId: item.id, rows: [parent, item] };
  } });
  let cache = {}, result;
  for (const expected of [4, 1, 0]) {
    result = await r.core.read(new AbortController().signal, { contextCache: cache });
    cache = result.contextCache;
    assert.equal(result.diagnostics.contextPending, expected);
  }
  assert.equal(result.items.filter(item => item.replyContext?.id === '700').length, 7);
  assert.equal(r.calls.filter(call => call[0] === 'update' && call[1].url.includes('/status/')).length, 7);
  assert.ok(Object.values(cache).every(entry => entry.result.rows.length === 2));
});

test('an unrelated conversation is cached too, but edited tweet text causes a new lookup', async () => {
  const item = row('123', 'thsottiaux', 'Tuesday 👀');
  const r = reader({ timeline: { rows: [item] }, conversation: () => ({ targetId: '123', rows: [item] }) });
  const first = await r.core.read(new AbortController().signal);
  const second = await r.core.read(new AbortController().signal, { contextCache: first.contextCache });
  assert.equal(second.diagnostics.conversations, 0);
  item.text = 'Wednesday 👀';
  const third = await r.core.read(new AbortController().signal, { contextCache: second.contextCache });
  assert.equal(third.diagnostics.conversations, 1);
});

test('a temporary three-scroll loading stall no longer hides a later reset announcement', async () => {
  const first = article(row('123', 'thsottiaux', 'Other news'));
  const reset = article(row('124', 'thsottiaux', 'Resets all propagated.'));
  const { result } = await domRead([[first], [first], [first], [first], [reset]]);
  assert.ok(result.rows.some(item => item.id === '124'));
});

test('a reset beyond the former twelve-scroll limit is collected within the expanded bound', async () => {
  const snapshots = Array.from({ length: 16 }, (_, i) => [article(row(String(800 + i), 'thsottiaux', i === 15 ? 'Resets all propagated.' : 'Other news'))]);
  const { result, scrolls } = await domRead(snapshots);
  assert.ok(result.rows.some(item => item.id === '815'));
  assert.ok(scrolls <= 24);
});


test('OpenAI joins independent posts and replies scans without dropping Tibo or VB', async () => {
  const r = reader({ authors: Array.from(Direct.AUTHORS) });
  const { items, diagnostics } = await r.core.read(new AbortController().signal);
  assert.deepEqual(new Set(items.map(x => x.author.toLowerCase())), new Set(['thsottiaux', 'reach_vb', 'openai']));
  assert.equal(diagnostics.timelines.length, 6);
  assert.equal(diagnostics.timelines.filter(t => t.author === 'openai' && t.ok).length, 2);
  assert.equal(diagnostics.stopReason, 'all-timelines');
});

test('OpenAI mixed-case paths and profile photos survive DOM collection and normalization', async () => {
  const avatarUrl = 'https://pbs.twimg.com/profile_images/123/verified_normal.jpg';
  const post = { ...row('789', 'OpenAI', 'Join us at DevDay tomorrow.'), avatarUrl };
  const { result } = await domRead([[article(post)]], { pathname: '/OpenAI/with_replies' });
  assert.equal(Direct.normalize(result.rows)[0].avatarUrl, avatarUrl);
  const conversation = await domRead([[article(post)]], { pathname: '/OpenAI/status/789' });
  assert.equal(conversation.result.targetId, '789');
  assert.equal(Direct.normalize([{ ...post, avatarUrl: 'https://evil.test/avatar.jpg' }])[0].avatarUrl, null);
});
