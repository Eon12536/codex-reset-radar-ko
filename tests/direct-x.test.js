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

test('Day20 short reset root collects the midnight reply through DOM checkpoints and closes its owned tab', async () => {
  const NOW = Date.parse('2026-10-26T05:00Z');
  const parent = { ...row('9900001', 'thsottiaux', 'Day 20/ Rest and reset'), createdAt: '2026-10-25T03:39:00Z' };
  const child = { ...row('9900002', 'thsottiaux', 'By midnight PST'), createdAt: '2026-10-25T03:40:00Z' };
  const checkpoints = [];
  const r = reader({ now: NOW, withNews: true, postFail: true, replyFail: true, scriptRunner: async url => {
    return (await domRead([[article(parent), article(child)]], { pathname: new URL(url).pathname })).result;
  } });
  const result = await r.core.read(new AbortController().signal, { resetTargets: [parent], onCheckpoint: value => checkpoints.push(value) });
  assert.equal(result.items.find(item => item.id === child.id)?.replyContext?.id, parent.id);
  assert.ok(checkpoints.some(value => value.timingReplies.some(item => item.id === child.id)));
  assert.equal(r.calls.filter(call => call[0] === 'create').length, 1);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('a delayed quote card on a dusted completion is rechecked, retained and linked without leaving the reader tab', async () => {
  const NOW = Date.parse('2026-10-15T07:00:00Z');
  const root = { ...row('2110595484180214059', 'thsottiaux', 'The reports of my reset button being lost are greatly exaggerated\n\nDay 10/ Reset'), createdAt: '2026-10-15T04:55:51Z' };
  const timing = { ...row('2110595554036400151', 'thsottiaux', 'Landing within the next 2 hours'), createdAt: '2026-10-15T04:56:07Z' };
  const done = { ...row('2110618732666257557', 'thsottiaux', 'Done and dusted'), createdAt: '2026-10-15T06:28:13Z' };
  const r = reader({ now: NOW, withNews: true, timeline: { rows: [root, timing, done] }, conversation: url => {
    if (url.endsWith('/' + done.id)) return { targetId: done.id, rows: [{ ...done, quotedPost: timing }] };
    if (url.endsWith('/' + timing.id)) return { targetId: timing.id, rows: [root, timing] };
    return { targetId: root.id, rows: [root] };
  } });
  const result = await r.core.read(new AbortController().signal);
  const observed = result.items.find(item => item.id === done.id);
  assert.equal(observed?.quotedPost?.text, timing.text, 'reloaded quote card must replace missing timeline quote');
  assert.equal(observed.replyContext?.id, timing.id);
  assert.ok(r.calls.some(call => call[0] === 'update' && call[1].url.includes('/' + done.id)));
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

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

function reader({ permission = true, finalUrl = POST_PAGE, normalizeUrl = url => url, fail = false, timeline, originalTimeline, postFail = false, replyFail = false, conversation, authors = ['thsottiaux'], vbTimeline, active = false, activateOnScript = false, build = 'fixture-build', now, conversationDelayMs = 0, timelineDelayMs = 0, scriptRunner, withNews = false } = {}) {
  const calls = [];
  const session = {}, local = {}, alarms = new Map();
  let url = finalUrl, elapsed = 0;
  const chrome = { runtime: { getManifest: () => ({ version: build }) }, permissions: { contains: async value => { calls.push(['permission', value]); return permission; } },
    storage: { local: { get: async key => ({ [key]: local[key] }), set: async value => Object.assign(local, structuredClone(value)), remove: async key => { delete local[key]; } }, session: { get: async key => ({ [key]: session[key] }), set: async value => Object.assign(session, structuredClone(value)), remove: async key => { delete session[key]; } } },
    alarms: { create: async (name, options) => alarms.set(name, options), clear: async name => alarms.delete(name) },
    tabs: { create: async options => { calls.push(['create', options]); url = normalizeUrl(finalUrl === POST_PAGE ? options.url : finalUrl); return { id: 33, windowId: 1, active }; },
      get: async () => ({ id: 33, windowId: 1, status: 'complete', url, active }), remove: async id => calls.push(['remove', id]),
      update: async (id, options) => { calls.push(['update', options]); url = normalizeUrl(options.url); },
      onUpdated: { addListener() {}, removeListener() {} } },
    scripting: { executeScript: async value => { const current = new URL(chromeUrl());
      const url = current.origin + current.pathname.replace(/\/$/, '').replace(/^\/thsottiaux/i, '/thsottiaux').replace(/^\/openai/i, '/OpenAI');
      if (url.includes('/status/')) elapsed += conversationDelayMs;
      else elapsed += timelineDelayMs;
      calls.push(['script', value]); if (activateOnScript === true || activateOnScript === calls.filter(c => c[0] === 'script').length) active = true; if (fail || (postFail && url === POST_PAGE) || (replyFail && url === PAGE)) throw new Error('mock failure');
      if (scriptRunner) return [{ frameId: 0, result: await scriptRunner(url) }];
      return [{ frameId: 0, result: url.startsWith('https://x.com/OpenAI') ? { rows: [row('789', 'OpenAI', 'Join us for DevDay tomorrow')] } : url.startsWith('https://x.com/reach_vb') ? vbTimeline || {rows: [row('456','reach_vb','Reset should be reflected for everyone')]} : [PAGE, POST_PAGE].includes(url)
        ? (url === POST_PAGE ? originalTimeline || timeline : timeline) || { rows: [row('123', 'thsottiaux', 'Maybe dust off the reset button next Tuesday.')], pages: 8, stopReason: 'no-more-loaded' }
        : (typeof conversation === 'function' ? conversation(url) : conversation) || { rows: [row('123', 'thsottiaux', 'Maybe dust off the reset button next Tuesday.')], targetId: '123' } }]; } } };
  const chromeUrl = () => url;
  const Clock = now === undefined && !conversationDelayMs && !timelineDelayMs ? Date : class extends Date { static now() { return (now ?? Date.now()) + elapsed; } };
  const context = vm.createContext({ chrome, URL, AbortController, AbortSignal, Date: Clock, crypto: require('node:crypto').webcrypto, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(require.resolve('../src/core/signals'), 'utf8'), context);
  if (withNews) {
    vm.runInContext(fs.readFileSync(require.resolve('../src/core/time'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(require.resolve('../src/core/news'), 'utf8'), context);
  }
  vm.runInContext(fs.readFileSync(require.resolve('../src/core/tab-owner'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/core/direct-x'), 'utf8'), context);
  return { core: { ...context.RadarDirectX, read: (signal, options = {}) => context.RadarDirectX.read(signal, {authors, ...options}) }, calls };
}

test('a transient context refresh failure preserves verified completion evidence across a reader restart', async () => {
  const NOW = Date.parse('2026-10-28T01:00:00Z');
  const parent = { ...row('90001', 'thsottiaux', 'We will reset all Codex usage limits tonight.'), createdAt: '2026-10-27T20:00:00Z' };
  const done = { ...row('90002', 'thsottiaux', 'Done'), createdAt: '2026-10-27T21:00:00Z' };
  const first = reader({ now: NOW, timeline: { rows: [parent, done] }, conversation: url => url.endsWith('/90002')
    ? { targetId: done.id, rows: [parent, done] } : { targetId: parent.id, rows: [parent] } });
  const initial = await first.core.read(new AbortController().signal);
  assert.equal(initial.items.find(item => item.id === done.id).replyContext.id, parent.id);
  const next = reader({ now: NOW + 7 * 3600000, timeline: { rows: [parent, done] },
    conversation: () => { throw new Error('Temporary X loading failure'); } });
  const result = await next.core.read(new AbortController().signal, {
    contextCache: initial.contextCache, retainedPosts: initial.retainedPosts });
  assert.equal(result.items.find(item => item.id === done.id).replyContext?.id, parent.id);
  assert.ok(result.contextCache[done.id].result, 'a failed recheck must not erase previously verified evidence');
  assert.equal(next.core.restorePosts(result.retainedPosts, result.contextCache, NOW + 7 * 3600000)
    .find(item => item.id === done.id).replyContext?.id, parent.id);
  assert.ok(result.diagnostics.conversationFailures > 0, 'cached evidence must not disguise a failed live check');
  assert.deepEqual(next.calls.at(-1), ['remove', 33]);
});

test('a completion whose parent loads later is retried within the next poll rather than cached for six hours', async () => {
  const NOW = Date.parse('2026-10-28T01:00:00Z');
  const parent = { ...row('90101', 'thsottiaux', 'We will reset all Codex usage limits tonight.'), createdAt: '2026-10-27T20:00:00Z' };
  const done = { ...row('90102', 'thsottiaux', 'Done'), createdAt: '2026-10-27T21:00:00Z' };
  const first = reader({ now: NOW, timeline: { rows: [parent, done] }, conversation: url => url.endsWith('/90102')
    ? { targetId: done.id, rows: [done] } : { targetId: parent.id, rows: [parent] } });
  const initial = await first.core.read(new AbortController().signal);
  assert.equal(initial.items.find(item => item.id === done.id).replyContext, undefined);
  const next = reader({ now: NOW + 10 * 60000, timeline: { rows: [parent, done] }, conversation: url => url.endsWith('/90102')
    ? { targetId: done.id, rows: [parent, done] } : { targetId: parent.id, rows: [parent] } });
  const result = await next.core.read(new AbortController().signal, {
    contextCache: initial.contextCache, retainedPosts: initial.retainedPosts });
  assert.equal(result.items.find(item => item.id === done.id).replyContext?.id, parent.id);
  assert.ok(next.calls.some(call => call[0] === 'update' && call[1].url.includes('/90102')));
  assert.deepEqual(next.calls.at(-1), ['remove', 33]);
});

test('target-only rechecks keep verified context but edited or different visible parents invalidate it', async () => {
  const NOW = Date.parse('2026-10-28T01:00:00Z');
  const parent = { ...row('90301', 'thsottiaux', 'We will reset all Codex usage limits tonight.'), createdAt: '2026-10-27T20:00:00Z' };
  const done = { ...row('90302', 'thsottiaux', 'Done'), createdAt: '2026-10-27T21:00:00Z' };
  const first = reader({ now: NOW, timeline: { rows: [done] }, conversation: () => ({ targetId: done.id, rows: [parent, done] }) });
  const initial = await first.core.read(new AbortController().signal);
  const variants = [
    { rows: [done], expected: parent.id },
    { rows: [{ ...parent, text: 'The product launch is cancelled.' }, done], expected: undefined },
    { rows: [{ ...parent, id: '90303', url: 'https://x.com/thsottiaux/status/90303', text: 'The report is ready.' }, done], expected: undefined },
    { rows: [{ ...done, text: 'Nevermind, no reset.' }], expected: undefined }
  ];
  for (const variant of variants) {
    const next = reader({ now: NOW + 7 * 3600000, timeline: { rows: [done] },
      conversation: () => ({ targetId: done.id, rows: variant.rows }) });
    const result = await next.core.read(new AbortController().signal, {
      contextCache: structuredClone(initial.contextCache), retainedPosts: initial.retainedPosts });
    assert.equal(result.items.find(item => item.id === done.id).replyContext?.id, variant.expected);
    assert.deepEqual(next.calls.at(-1), ['remove', 33]);
  }
});

test('a failed recheck after an extension update does not certify the old no-parent verdict under the new version', async () => {
  const NOW = Date.parse('2026-10-28T01:00:00Z');
  const done = { ...row('90402', 'thsottiaux', 'Done'), createdAt: '2026-10-27T21:00:00Z' };
  const parent = { ...row('90401', 'thsottiaux', 'We will reset all Codex usage limits tonight.'), createdAt: '2026-10-27T20:00:00Z' };
  const first = reader({ now: NOW, build: 'old-version', timeline: { rows: [done] },
    conversation: () => ({ targetId: done.id, rows: [done] }) });
  const initial = await first.core.read(new AbortController().signal);
  const failed = reader({ now: NOW + 60000, build: 'new-version', timeline: { rows: [done] },
    conversation: () => { throw new Error('Temporary failure'); } });
  const partial = await failed.core.read(new AbortController().signal, { contextCache: initial.contextCache });
  const recovered = reader({ now: NOW + 120000, build: 'new-version', timeline: { rows: [done] },
    conversation: () => ({ targetId: done.id, rows: [parent, done] }) });
  const result = await recovered.core.read(new AbortController().signal, { contextCache: partial.contextCache });
  assert.equal(result.items.find(item => item.id === done.id).replyContext?.id, parent.id);
});

test('brief propagation and named-clock follow-ups are read even without an initial quote card', async () => {
  const NOW = Date.parse('2026-10-28T01:00:00Z');
  const parent = { ...row('90501', 'thsottiaux', 'We will reset all Codex usage limits tonight.'), createdAt: '2026-10-27T20:00:00Z' };
  for (const text of ['All propagated.', 'Fully rolled out.', 'By midnight PST', 'By noon PST']) {
    const child = { ...row('90502', 'thsottiaux', text), createdAt: '2026-10-27T21:00:00Z' };
    const r = reader({ now: NOW, timeline: { rows: [child] },
      conversation: () => ({ targetId: child.id, rows: [parent, child] }) });
    const result = await r.core.read(new AbortController().signal);
    assert.equal(result.items.find(item => item.id === child.id).replyContext?.id, parent.id, text);
    assert.deepEqual(r.calls.at(-1), ['remove', 33]);
  }
});

test('direct scan retrieves the reset headline context for a short EOD reply, including cached reads, then closes its tab', async () => {
  const parent = { ...row('101', 'thsottiaux', 'Day 13/ Le limit reset'), createdAt: new Date(Date.now() - 60000).toISOString() };
  const reply = row('102', 'thsottiaux', 'Landing sometime today by EOD PST');
  const r = reader({ timeline: { rows: [parent, reply] }, conversation: url => url.endsWith('/102')
    ? { targetId: reply.id, rows: [parent, reply] } : { targetId: parent.id, rows: [parent] } });
  const result = await r.core.read(new AbortController().signal);
  const item = result.items.find(item => item.id === reply.id);
  assert.equal(item.replyContext?.relation, 'conversation-before');
  assert.equal(item.replyContext?.id, parent.id);
  assert.equal(Signals.classify(item).confidence, 'high');
  assert.equal(Signals.classify(item).actionable, true);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
  const cached = await r.core.read(new AbortController().signal, { contextCache: result.contextCache });
  assert.equal(Signals.classify(cached.items.find(item => item.id === reply.id)).actionable, true);
  assert.equal(r.calls.filter(call => call[0] === 'create').length, 2);
  assert.equal(r.calls.filter(call => call[0] === 'remove').length, 2);
});

test('direct reader never requests permissions or creates a tab before opt-in', async () => {
  const r = reader({ permission: false });
  await assert.rejects(r.core.read(new AbortController().signal), /PERMISSION/);
  assert.deepEqual(r.calls.map(c => c[0]), ['permission']);
});

test('a visible reset older than two days still gets its timing checked within the seven-day archive', async () => {
  const NOW = Date.parse('2026-10-24T06:00:00Z');
  const parent = { ...row('7001', 'thsottiaux', 'Day 17/ It is reset day today.'), createdAt: new Date(NOW - 3 * 86400000).toISOString() };
  const child = { ...row('7002', 'thsottiaux', 'Lands tomorrow before 10am PST.'), createdAt: new Date(Date.parse(parent.createdAt) + 60000).toISOString() };
  const r = reader({ now: NOW, postFail: true, replyFail: true, conversation: url => url.endsWith('/' + parent.id)
    ? { targetId: parent.id, rows: [parent], followUps: [child] } : { targetId: child.id, rows: [parent, child] } });
  const result = await r.core.read(new AbortController().signal, { resetTargets: [parent] });
  assert.equal(result.items.find(item => item.id === child.id)?.replyContext?.id, parent.id);
  assert.equal(result.diagnostics.resetFollowUps.find(check => check.id === parent.id)?.verified, 1);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('several visible reset roots from the same author are checked once each per scan', async () => {
  const NOW = Date.parse('2026-10-24T06:00:00Z');
  const parents = [7101, 7102, 7103].map((id, i) => ({ ...row(String(id), 'thsottiaux', 'Codex reset day today.'),
    createdAt: new Date(NOW - (4 - i) * 3600000).toISOString() }));
  const r = reader({ now: NOW, timeline: { rows: parents }, originalTimeline: { rows: parents }, conversation: url => {
    const parent = parents.find(item => url.endsWith('/' + item.id));
    return { targetId: parent.id, rows: [parent], followUps: [] };
  } });
  const result = await r.core.read(new AbortController().signal, { resetTargets: parents });
  const checks = result.diagnostics.resetFollowUps.filter(check => parents.some(parent => parent.id === check.id));
  assert.equal(new Set(checks.map(check => check.id)).size, 3);
  assert.equal(checks.length, 3);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('a timeline checks its next unvisited root after the newest known reset was already checked', async () => {
  const NOW = Date.parse('2026-10-24T06:00:00Z');
  const parents = [7201, 7202].map((id, i) => ({ ...row(String(id), 'thsottiaux', 'Codex reset day today.'),
    createdAt: new Date(NOW - (3 - i) * 3600000).toISOString() }));
  const r = reader({ now: NOW, timeline: { rows: parents }, originalTimeline: { rows: parents }, conversation: url => {
    const parent = parents.find(item => url.endsWith('/' + item.id));
    return { targetId: parent.id, rows: [parent], followUps: [] };
  } });
  const result = await r.core.read(new AbortController().signal, { resetTargets: [parents[1]] });
  assert.deepEqual(Array.from(result.diagnostics.resetFollowUps, check => check.id).sort(), ['7201', '7202']);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('the latest reset timing is verified before slow bulk timelines consume the scan budget', async () => {
  const NOW = Date.parse('2026-10-23T09:00:00Z');
  const [parent, child] = require('./fixtures/tibo-day18-oct23.json').posts;
  const r = reader({ authors: ['thsottiaux', 'reach_vb', 'openai'], now: NOW, timelineDelayMs: 45000,
    timeline: { rows: [parent] }, conversation: url => url.endsWith('/' + parent.id)
      ? { targetId: parent.id, rows: [parent], followUps: [child] } : { targetId: child.id, rows: [parent, child] } });
  const result = await r.core.read(new AbortController().signal);
  assert.equal(result.items.find(item => item.id === child.id)?.replyContext?.id, parent.id);
  const navigation = r.calls.filter(call => call[0] === 'update').map(call => call[1].url.split('#')[0]);
  assert.ok(navigation.indexOf(parent.url) < navigation.indexOf('https://x.com/reach_vb'), 'latest reset check precedes the next bulk timeline');
  assert.equal(r.calls.filter(call => call[0] === 'create').length, 1);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('a known reset permalink is checked first even when both profile timelines fail, using the actual bundled DOM reader', async () => {
  const NOW = Date.parse('2026-10-23T09:00:00Z');
  const [parent, child] = require('./fixtures/tibo-day18-oct23.json').posts;
  const question = { ...row('9003', 'someone', 'When will Codex reset?'), createdAt: parent.createdAt };
  const checkpoints = [];
  const r = reader({ now: NOW, withNews: true, postFail: true, replyFail: true, scriptRunner: async url => {
    const frames = [[article(parent), article(child), article(question)]];
    return (await domRead(frames, { pathname: new URL(url).pathname })).result;
  } });
  const result = await r.core.read(new AbortController().signal, { onCheckpoint: value => checkpoints.push(value), resetTargets: [{ ...parent,
    id: 'feed:' + parent.id, author: 'Tibo', url: parent.url + '?s=20' }] });
  assert.equal(r.calls.find(call => call[0] === 'create')[1].url.split('#')[0], parent.url);
  assert.equal(result.items.find(item => item.id === child.id)?.replyContext?.id, parent.id);
  assert.equal(result.diagnostics.resetFollowUps[0].state, 'verified');
  assert.equal(result.diagnostics.timelines.every(timeline => !timeline.ok), true);
  assert.ok(checkpoints.some(value => value.timingReplies.some(item => item.id === child.id)), 'the real DOM reader, context verifier and timing validator publish the reply checkpoint together');
  assert.equal(r.calls.filter(call => call[0] === 'create').length, 1);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('late reset ancestor recovery reaches the banner through DOM collection, verification and checkpoints, then closes the owned tab', async t => {
  const NOW = Date.parse('2026-10-25T00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const [parent, child] = require('./fixtures/tibo-day18-oct23.json').posts;
  const ordinary = { ...parent, id: '899', url: 'https://x.com/thsottiaux/status/899',
    text: 'Thanks for the feedback.', createdAt: '2026-10-23T04:40:00Z' };
  const checkpoints = [];
  const r = reader({ now: NOW, withNews: true, postFail: true, replyFail: true, scriptRunner: async url => {
    const snapshots = url.endsWith('/' + child.id)
      ? [[article(ordinary), article(child)], [article(ordinary), article(parent), article(child)]]
      : [[article(parent), article(child)]];
    return (await domRead(snapshots, { pathname: new URL(url).pathname, timerDelay: 1000,
      hydrateAt: url.endsWith('/' + child.id) ? 4000 : 0 })).result;
  } });
  const result = await r.core.read(new AbortController().signal, { resetTargets: [parent],
    onCheckpoint: value => checkpoints.push(value) });
  assert.equal(result.diagnostics.resetFollowUps[0].verified, 1);
  assert.equal(result.diagnostics.readerBuild, 'fixture-build');
  const saved = checkpoints.find(value => value.timingReplies.length);
  assert.ok(saved, 'a verified timing reply must be persisted before bulk timeline failures');
  global.RadarSignals = Signals;
  const News = require('../src/core/news');
  const rows = News.list({ timingReplies: saved.timingReplies }, { items: [result.items.find(item => item.id === parent.id)] },
    { monitorSignals: true, monitorLeadSource: true, resetOnly: true });
  const visible = rows.find(item => item.item.id === parent.id);
  assert.equal(visible.timingSchedule.deadlineAt, Date.parse('2026-10-23T18:00Z'));
  assert.match(visible.timing, /10\/24.*3:00.*이전/);
  assert.equal(r.calls.filter(call => call[0] === 'create').length, 1);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('a standalone timing post with no visible parent is retained as inferred display evidence and closes its reader', async () => {
  const NOW = Date.parse('2026-10-25T13:00Z');
  const [parent, child] = require('./fixtures/tibo-day18-oct23.json').posts;
  const checkpoints = [];
  const r = reader({ now: NOW, withNews: true, postFail: true, replyFail: true, conversation: url =>
    url.endsWith('/' + parent.id) ? { targetId: parent.id, rows: [parent], followUps: [child] } : { targetId: child.id, rows: [child] } });
  const result = await r.core.read(new AbortController().signal, { resetTargets: [parent], onCheckpoint: value => checkpoints.push(value) });
  const check = result.diagnostics.resetFollowUps[0];
  assert.equal(check.verified, 0, 'standalone context must not inflate verified conversation counts');
  assert.equal(check.inferred, 1);
  assert.equal(check.state, 'inferred');
  assert.ok(checkpoints.some(value => value.timingReplies.some(item => item.id === child.id && item.assessment.timingLink === 'inferred')));
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('a failed permalink check retains its actual failure trace without promoting URL metadata into collected evidence', async () => {
  const NOW = Date.parse('2026-10-23T09:00:00Z');
  const [parent] = require('./fixtures/tibo-day18-oct23.json').posts;
  const r = reader({ now: NOW, fail: true });
  await assert.rejects(r.core.read(new AbortController().signal, { resetTargets: [parent] }), error => {
    assert.equal(error.diagnostics.posts, 0);
    assert.equal(error.diagnostics.resetFollowUps[0].id, parent.id);
    assert.equal(error.diagnostics.resetFollowUps[0].state, 'failed');
    return true;
  });
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('a timing reply absent from both timelines is discovered below the reset parent, independently verified, and its reader closed', async () => {
  const NOW = Date.parse('2026-10-23T09:00:00Z');
  const [parent, child] = require('./fixtures/tibo-day18-oct23.json').posts;
  const unrelated = { ...child, id: '9001', url: 'https://x.com/thsottiaux/status/9001', text: 'Lunch tomorrow at 11am PST.' };
  const foreign = { ...child, id: '9002', author: 'someone', url: 'https://x.com/someone/status/9002' };
  const r = reader({ now: NOW, timeline: { rows: [parent] }, conversation: url => url.endsWith('/' + parent.id)
    ? { targetId: parent.id, rows: [parent], followUps: [child, unrelated, foreign] }
    : url.endsWith('/' + child.id) ? { targetId: child.id, rows: [parent, child] }
      : { targetId: unrelated.id, rows: [unrelated] } });
  const result = await r.core.read(new AbortController().signal);
  const discovered = result.items.find(item => item.id === child.id);
  assert.equal(discovered.replyContext.id, parent.id);
  assert.equal(Signals.classify(discovered, { now: NOW }).actionable, true);
  assert.equal(result.items.some(item => item.id === foreign.id), false);
  assert.equal(result.items.find(item => item.id === unrelated.id)?.replyContext, undefined);
  const checked = result.diagnostics.resetFollowUps.find(check => check.id === parent.id);
  assert.equal(checked.children.find(item => item.id === child.id)?.state, 'verified');
  assert.equal(checked.children.find(item => item.id === child.id)?.parentId, parent.id);
  assert.equal(checked.children.find(item => item.id === unrelated.id)?.state, 'parent-missing');
  assert.ok(checked.children.length <= 3);
  assert.equal(result.diagnostics.contextPending, 0);
  assert.equal(r.calls.filter(call => call[0] === 'create').length, 1);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
  assert.ok(result.retainedPosts.some(item => item.id === child.id));
  const restored = r.core.restorePosts(result.retainedPosts, result.contextCache, NOW);
  assert.equal(restored.find(item => item.id === child.id).replyContext.id, parent.id);
});

test('fresh reset conversations and unverified clock replies are retried after five minutes instead of six hours', async () => {
  const NOW = Date.parse('2026-10-23T09:00:00Z');
  const [parent, child] = require('./fixtures/tibo-day18-oct23.json').posts;
  let ready = false;
  const r = reader({ now: NOW, timeline: { rows: [parent, child] }, conversation: url => url.endsWith('/' + child.id)
    ? { targetId: child.id, rows: ready ? [parent, child] : [child] } : { targetId: parent.id, rows: [parent] } });
  const first = await r.core.read(new AbortController().signal);
  assert.equal(first.items.find(item => item.id === child.id).replyContext, undefined);
  for (const entry of Object.values(first.contextCache)) entry.checkedAt -= 6 * 60000;
  ready = true;
  const next = await r.core.read(new AbortController().signal, { contextCache: first.contextCache });
  assert.equal(next.items.find(item => item.id === child.id).replyContext.id, parent.id);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('a changed parent invalidates the cached relationship before the six-hour child cache expires', async () => {
  const NOW = Date.parse('2026-10-23T09:00:00Z');
  const [parent, child] = require('./fixtures/tibo-day18-oct23.json').posts;
  const timeline = { rows: [parent, child] };
  const r = reader({ now: NOW, timeline, conversation: url => url.endsWith('/' + child.id)
    ? { targetId: child.id, rows: [timeline.rows[0], child] } : { targetId: parent.id, rows: [timeline.rows[0]] } });
  const first = await r.core.read(new AbortController().signal);
  assert.equal(first.items.find(item => item.id === child.id).replyContext.id, parent.id);
  timeline.rows[0] = { ...parent, text: 'Lunch tomorrow.' };
  const next = await r.core.read(new AbortController().signal, { contextCache: first.contextCache, retainedPosts: first.retainedPosts });
  assert.equal(next.items.find(item => item.id === child.id).replyContext, undefined);
  assert.equal(Signals.classify(next.items.find(item => item.id === child.id), { now: NOW }).actionable, false);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
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

test('same-account path canonicalization keeps all timelines and conversation collection working', async () => {
  const r = reader({ authors: ['thsottiaux', 'reach_vb', 'openai'], normalizeUrl: value => {
    const url = new URL(value);
    url.pathname = url.pathname.toLowerCase() + '/';
    return url.href;
  } });
  const { items, diagnostics } = await r.core.read(new AbortController().signal);
  assert.equal(diagnostics.timelines.length, 6);
  assert.equal(diagnostics.timelines.every(timeline => timeline.ok), true);
  assert.ok(items.some(item => item.author === 'OpenAI'));
  assert.ok(diagnostics.conversations > 0);
  assert.equal(diagnostics.cleanupError, undefined);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('canonicalization never permits a changed reader nonce, query, origin or public account', async () => {
  for (const change of [url => { url.hash = ''; }, url => { url.hash = 'radar-x-reader=00000000-0000-4000-8000-000000000099'; },
    url => { url.search = '?redirect=1'; }, url => { url.hostname = 'x.com.evil.test'; },
    url => { url.pathname = '/reach_vb/'; }, url => { url.pathname = '/i/chat/'; }]) {
    const r = reader({ normalizeUrl: value => { const url = new URL(value); change(url); return url.href; } });
    await assert.rejects(r.core.read(new AbortController().signal), /X_PAGE_UNAVAILABLE/);
    assert.equal(r.calls.some(call => call[0] === 'script'), false);
  }
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

test('a selected scan tab is closed without reading or navigating it again', async () => {
  const r = reader({ active: true });
  await assert.rejects(r.core.read(new AbortController().signal), /UNAVAILABLE/);
  assert.equal(r.calls.some(c => ['script', 'update'].includes(c[0])), false);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('activation during a scan stops later navigation and closes the owned tab', async () => {
  const r = reader({ activateOnScript: true });
  await assert.rejects(r.core.read(new AbortController().signal), /UNAVAILABLE/);
  assert.equal(r.calls.filter(c => c[0] === 'script').length, 1);
  assert.equal(r.calls.some(c => c[0] === 'update'), false);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
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
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
  assert.equal(result.diagnostics.cleanupError, undefined);
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
  assert.deepEqual(manifest.optional_host_permissions, ['https://x.com/*', 'https://t.me/*']);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.permissions.includes('tabs'), false);
  assert.equal(manifest.host_permissions.includes('https://x.com/*'), false);
  const source = fs.readFileSync(require.resolve('../src/x-reader'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|document\.cookie|localStorage|sessionStorage|\.innerHTML\s*=/);
});

function article(post, { quoted = false, emoji = false, moreText, moreQuoted = false, quotePost, pollOptions = [], quotedPoll = false, wrapped = false, statusHref } = {}) {
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
      : selector === '[role="link"]:not(a)' ? isQuote ? {} : wrapped ? { contains: element => element === node } : null
      : selector === 'a' ? { getAttribute: () => statusHref || `/${post.author}/status/${post.id}` } : null;
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
  const directions = [];
  class Clock extends Date { static now() { return Date.now() + elapsed; } }
  const location = { origin: 'https://x.com', pathname };
  const context = vm.createContext({ location, Date: Clock,
    document: { querySelectorAll: () => snapshots[Math.min(step, snapshots.length - 1)] },
    window: { innerHeight: 900, scrollBy(x, y) { scrolls++; directions.push(y); if (!hydrateAt && y > 0) step++; if (navigate) location.pathname = '/i/chat'; } },
    setTimeout: (fn, ms) => { elapsed += timerDelay ? Math.max(timerDelay, ms) : 0;
      if (hydrateAt && elapsed >= hydrateAt) step = 1;
      queueMicrotask(fn); } });
  const result = await vm.runInContext(fs.readFileSync(require.resolve('../src/x-reader'), 'utf8'), context);
  return { result, scrolls, directions, elapsed };
}

test('a public parent wrapped in a clickable outer container is read without borrowing quote cards', async () => {
  const [parent, child] = require('./fixtures/tibo-day18-oct23.json').posts;
  const { result } = await domRead([[article(parent, { wrapped: true, quoted: true }), article(child)]],
    { pathname: '/thsottiaux/status/' + child.id });
  const checked = Direct.conversationContext(Direct.normalize([child])[0], result);
  assert.equal(checked.replyContext?.id, parent.id);
  assert.equal(checked.replyContext?.text, parent.text);
});

test('absolute and shared public timestamp links keep the rendered reset parent identity', async () => {
  const [parent, child] = require('./fixtures/tibo-day18-oct23.json').posts;
  for (const statusHref of [parent.url, parent.url + '?s=20', `/${parent.author}/status/${parent.id}/?s=20#source`]) {
    const { result } = await domRead([[article(parent, { statusHref }), article(child)]],
      { pathname: '/thsottiaux/status/' + child.id });
    assert.equal(Direct.conversationContext(Direct.normalize([child])[0], result).replyContext?.id, parent.id, statusHref);
  }
});

test('canonical trailing slashes do not hide rendered posts or exact conversation targets', async () => {
  const post = row('123', 'OpenAI', 'Global reset today');
  for (const pathname of ['/openai/', '/OpenAI/with_replies/', '/OpenAI/status/123/']) {
    const { result } = await domRead([[article(post)]], { pathname });
    assert.equal(result.rows.length, 1, pathname);
    assert.equal(result.rows[0].id, '123');
    assert.notEqual(result.stopReason, 'wrong-page');
  }
});

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
  assert.ok(read.directions.length > 0 && read.directions.every(y => y < 0));
  assert.ok(read.elapsed >= 4000);
  assert.deepEqual(Array.from(read.result.rows, item => item.id), [parent.id, target.id]);
  const item = Direct.conversationContext(Direct.normalize([target], Date.parse(fixture.observedAt))[0], read.result, Date.parse(fixture.observedAt));
  assert.equal(Signals.reports([item], { now: Date.parse(fixture.observedAt) })[0].assessment.grantStage, 'timing');
});

test('an EOD-only timeline reply is enriched from the real public conversation', async () => {
  const fixture = require('./fixtures/reset-grant-oct8.json');
  const [parent, target] = fixture.posts;
  const r = reader({ now: Date.parse(fixture.observedAt), timeline: { rows: [target] }, conversation: { targetId: target.id, rows: [parent, target] } });
  const scan = await r.core.read(new AbortController().signal);
  assert.equal(scan.diagnostics.conversations, 1);
  assert.equal(Signals.reports(scan.items, { now: Date.parse(fixture.observedAt) })[0].assessment.grantStage, 'timing');
});

test('an initially missing EOD parent is retried on the next poll instead of cached for six hours', async () => {
  const fixture = require('./fixtures/reset-grant-oct8.json');
  const [parent, target] = fixture.posts;
  let hydrated = false;
  const r = reader({ now: Date.parse(fixture.observedAt), timeline: { rows: [target] }, conversation: () => ({ targetId: target.id, rows: hydrated ? [parent, target] : [target] }) });
  const first = await r.core.read(new AbortController().signal);
  assert.equal(Signals.reports(first.items, { now: Date.parse(fixture.observedAt) }).length, 0);
  const cache = JSON.parse(JSON.stringify(first.contextCache));
  cache[target.id].checkedAt = Date.parse(fixture.observedAt) - 15 * 60000;
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

test('conversation lookups drain beyond three replies in one scan and reuse verified context across polls', async () => {
  const posts = Array.from({ length: 7 }, (_, i) => row(String(800 + i), 'thsottiaux', 'Tuesday 👀'));
  const parent = { ...row('700', 'someone', 'Could you reset Codex limits?'), createdAt: new Date(Date.now() - 3600000).toISOString() };
  const r = reader({ timeline: { rows: posts }, conversation: url => {
    const item = posts.find(post => post.url === url);
    return { targetId: item.id, rows: [parent, item] };
  } });
  let cache = {}, result;
  for (const expected of [0, 0]) {
    result = await r.core.read(new AbortController().signal, { contextCache: cache });
    cache = result.contextCache;
    assert.equal(result.diagnostics.contextPending, expected);
  }
  assert.equal(result.items.filter(item => item.replyContext?.id === '700').length, 7);
  assert.equal(r.calls.filter(call => call[0] === 'update' && call[1].url.includes('/status/')).length, 7);
  assert.ok(Object.values(cache).every(entry => entry.result.rows.length === 2));
});

test('pending conversations survive disappearing timeline rows and a new reader after checkpoints', async () => {
  const posts = Array.from({ length: 7 }, (_, i) => row(String(1800 + i), 'thsottiaux', 'Tuesday 👀'));
  const parent = { ...row('1700', 'someone', 'Could you reset Codex limits?'), createdAt: new Date(Date.now() - 3600000).toISOString() };
  let checkpoint;
  const conversation = url => {
    const item = posts.find(post => post.url === url);
    return { targetId: item.id, rows: [parent, item] };
  };
  const first = reader({ timeline: { rows: posts }, conversation, conversationDelayMs: 26000 });
  const partial = await first.core.read(new AbortController().signal, { onCheckpoint: async value => { checkpoint = structuredClone(value); } });
  assert.equal(checkpoint.posts.length, 7);
  assert.equal(partial.diagnostics.contextPending, 4, "deadline still bounds a slow scan");
  assert.deepEqual(first.calls.at(-1), ["remove",33]);
  const next = reader({ timeline: { rows: [row('1900', 'thsottiaux', 'Unrelated update')] }, conversation });
  const second = await next.core.read(new AbortController().signal, { contextCache: checkpoint.contextCache,
    retainedPosts: checkpoint.posts, onCheckpoint: async value => { checkpoint = structuredClone(value); } });
  assert.equal(second.diagnostics.contextPending, 0);
  const third = await next.core.read(new AbortController().signal, { contextCache: checkpoint.contextCache, retainedPosts: checkpoint.posts });
  assert.equal(third.diagnostics.contextPending, 0);
  assert.equal(third.items.filter(item => item.replyContext?.id === parent.id).length, 7);
  assert.deepEqual(next.calls.at(-1), ['remove', 33]);
});

test('25 fast conversation checks finish within one scan and the single owned tab closes', async () => {
  const posts = Array.from({length:25},(_,i)=>row(String(3800+i),'thsottiaux','Tuesday 👀'));
  const parent = {...row('3700','thsottiaux','A reset is coming tomorrow.'),createdAt:new Date(Date.now()-60000).toISOString()};
  const r = reader({timeline:{rows:posts},conversation:url=>{
    const item=posts.find(post=>post.url===url); return {targetId:item.id,rows:[parent,item]};
  }});
  const result = await r.core.read(new AbortController().signal);
  assert.equal(result.diagnostics.conversations,25);
  assert.equal(result.diagnostics.contextPending,0);
  assert.equal(r.calls.filter(call=>call[0]==='create').length,1);
  assert.deepEqual(r.calls.at(-1),['remove',33]);
});

test('a timeline checkpoint preserves newly read reset evidence before cancellation interrupts the scan', async () => {
  const item = row('2200', 'thsottiaux', 'A reset is coming tomorrow.');
  const controller = new AbortController(); let checkpoint;
  const r = reader({ timeline: { rows: [item] } });
  await assert.rejects(r.core.read(controller.signal, { onCheckpoint: async value => {
    checkpoint = structuredClone(value); controller.abort();
  } }));
  assert.equal(checkpoint.posts[0].id, item.id);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('checkpoint storage failure is reported while retaining current evidence and closing the owned tab', async () => {
  const item = row('2400', 'thsottiaux', 'An ordinary public post');
  const r = reader({ timeline: { rows: [item] } });
  const result = await r.core.read(new AbortController().signal, { onCheckpoint: async () => { throw new Error('quota'); } });
  assert.equal(result.items[0].id, item.id);
  assert.equal(result.diagnostics.checkpointError, true);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('reset and deadline replies receive priority without permanently starving other conversations', async () => {
  const posts = Array.from({ length: 6 }, (_, i) => row(String(2800 + i), 'thsottiaux', 'Tuesday 👀'));
  const reset = { ...row('2700', 'thsottiaux', 'Landing sometime today by EOD PST'), createdAt: new Date(Date.now() - 60000).toISOString() };
  const parent = { ...row('2600', 'thsottiaux', 'Day 13 / Le limit reset'), createdAt: new Date(Date.now() - 120000).toISOString() };
  const r = reader({ timeline: { rows: [...posts, reset] }, conversation: url => {
    const item = [...posts, reset].find(post => post.url === url);
    return { targetId: item.id, rows: item === reset ? [parent, item] : [item] };
  } });
  const first = await r.core.read(new AbortController().signal);
  assert.equal(Signals.classify(first.items.find(item => item.id === reset.id)).actionable, true);
  let result = first;
  for (let i = 0; i < 2; i++) result = await r.core.read(new AbortController().signal, { contextCache: result.contextCache });
  assert.equal(result.diagnostics.contextPending, 0);
});

test('a pre-update no-parent verdict is re-read under the current context schema', async () => {
  const item = row('3200', 'thsottiaux', 'Landing sometime today by EOD PST');
  const parent = { ...row('3100', 'thsottiaux', 'Day 13 / Le limit reset'), createdAt: new Date(Date.now() - 60000).toISOString() };
  let hydrated = false;
  const r = reader({ timeline: { rows: [item] }, conversation: () => ({ targetId: item.id, rows: hydrated ? [parent, item] : [item] }) });
  const first = await r.core.read(new AbortController().signal);
  first.contextCache[item.id].schema = 0;
  hydrated = true;
  const next = await r.core.read(new AbortController().signal, { contextCache: first.contextCache });
  assert.equal(next.diagnostics.conversations, 1);
  assert.equal(Signals.classify(next.items[0]).actionable, true);
});

test('a real extension version change invalidates a previous no-parent cache immediately', async () => {
  const item = row('3400', 'thsottiaux', 'Landing sometime today by EOD PST');
  const parent = { ...row('3300', 'thsottiaux', 'Day 13 / Le limit reset'), createdAt: new Date(Date.now() - 60000).toISOString() };
  const previous = reader({ build: '0.2.89', timeline: { rows: [item] }, conversation: { targetId: item.id, rows: [item] } });
  const old = await previous.core.read(new AbortController().signal);
  const updated = reader({ build: '0.2.90', timeline: { rows: [item] }, conversation: { targetId: item.id, rows: [parent, item] } });
  const current = await updated.core.read(new AbortController().signal, { contextCache: old.contextCache });
  assert.equal(current.diagnostics.conversations, 1);
  assert.notEqual(current.contextCache[item.id].schema, old.contextCache[item.id].schema);
  assert.equal(Signals.classify(current.items[0]).actionable, true);
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

test('Telegram missing ID is checked after primary timelines using one owned tab and only the X body is retained', async () => {
  const missed = row('2114599388454481930', 'thsottiaux', 'Not enough resets');
  const r = reader({ conversation: url => url.endsWith('/' + missed.id) ?
    { targetId: missed.id, rows: [missed] } : { targetId: '123', rows: [row('123', 'thsottiaux', 'Other update')] } });
  const attempts = [];
  const result = await r.core.read(new AbortController().signal, { telegramLeads: Promise.resolve({ state: 'ok', ids: [missed.id] }),
    onTelegramAttempt: async id => attempts.push(id) });
  assert.equal(result.diagnostics.telegram.recovered, 1);
  assert.equal(result.items.find(item => item.id === missed.id)?.text, missed.text);
  assert.deepEqual(attempts, [missed.id]);
  const updates = r.calls.filter(call => call[0] === 'update').map(call => call[1].url);
  assert.ok(updates.findIndex(url => url.includes('/with_replies')) < updates.findIndex(url => url.includes('/status/' + missed.id)));
  assert.equal(r.calls.filter(call => call[0] === 'create').length, 1);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('Telegram claim without an exact matching Tibo X article is never promoted into evidence', async () => {
  const id = '2114599388454481930';
  const r = reader({ conversation: () => ({ targetId: id, rows: [row(id, 'reach_vb', 'Reset is done')] }) });
  const result = await r.core.read(new AbortController().signal, { telegramLeads: Promise.resolve({ state: 'ok', ids: [id] }) });
  assert.equal(result.diagnostics.telegram.recovered, 0);
  assert.ok(!result.items.some(item => item.id === id));
  assert.equal(r.calls.filter(call => call[0] === 'create').length, 1);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('recently attempted missing Telegram IDs do not trigger repeated reader navigation', async () => {
  const id = '2114599388454481930';
  const r = reader();
  const result = await r.core.read(new AbortController().signal, { telegramLeads: Promise.resolve({ state: 'ok', ids: [id] }),
    telegramAttempts: { [id]: Date.now() } });
  assert.equal(result.diagnostics.telegram.missing, 1);
  assert.equal(result.diagnostics.telegram.attempted, 0);
  assert.ok(!r.calls.some(call => call[0] === 'update' && call[1].url.includes('/status/' + id)));
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('a Telegram lead older than seven days is verified on X and sent only to history', async () => {
  const now = Date.now(), id = '2110595484180214059';
  const old = { ...row(id, 'thsottiaux', 'Day 10/ Reset'), createdAt: new Date(now - 10 * 86400000).toISOString() };
  const r = reader({ now, conversation: url => url.endsWith('/' + id) ? { targetId: id, rows: [old] } :
    { targetId: '123', rows: [row('123', 'thsottiaux', 'Other update')] } });
  const history = [];
  const result = await r.core.read(new AbortController().signal, { telegramLeads: Promise.resolve({ state: 'ok', ids: [id] }),
    onTelegramHistory: async item => { history.push(item); return true; } });
  assert.equal(history[0]?.id, id);
  assert.equal(result.diagnostics.telegram.recovered, 1);
  assert.ok(!result.items.some(item => item.id === id), 'historical post must not enter live alert processing');
  assert.equal(r.calls.filter(call => call[0] === 'create').length, 1);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('history-only recovery verifies older direct links without another timeline scan and closes its sole reader', async () => {
  const now = Date.now(), id = '2110595484180214059';
  const old = { ...row(id, 'thsottiaux', 'Day 10/ Reset'), createdAt: new Date(now - 10 * 86400000).toISOString() };
  const r = reader({ now, conversation: url => url.endsWith('/' + id) ? { targetId: id, rows: [old] } : { rows: [] } });
  const saved = [];
  const result = await r.core.read(new AbortController().signal, { historyOnly: true,
    telegramLeads: Promise.resolve({ state: 'ok', ids: [id] }), onTelegramHistory: async item => { saved.push(item.id); return true; } });
  assert.deepEqual(saved, [id]);
  assert.equal(result.diagnostics.telegram.recovered, 1);
  assert.equal(result.items.length, 0);
  assert.equal(r.calls.filter(call => call[0] === 'create').length, 1);
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
  assert.ok(!r.calls.some(call => call[0] === 'update' && /with_replies/.test(call[1].url)));
});

test('history-only recovery opens no tab if every lead is already saved', async () => {
  const id = '2110595484180214059', r = reader();
  await r.core.read(new AbortController().signal, { historyOnly: true, knownHistoryIds: [id],
    telegramLeads: Promise.resolve({ state: 'ok', ids: [id] }) });
  assert.equal(r.calls.filter(call => call[0] === 'create').length, 0);
});

test('historical recovery reports an inaccessible target and closes the reader', async () => {
  const id = '2110595484180214059', r = reader({ conversation: () => ({ targetId: id, rows: [], stopReason: 'target-missing' }) });
  const result = await r.core.read(new AbortController().signal, { historyOnly: true,
    telegramLeads: Promise.resolve({ state: 'ok', ids: [id] }) });
  assert.equal(result.diagnostics.telegram.attempted, 1);
  assert.equal(result.diagnostics.telegram.recovered, 0);
  assert.equal(result.diagnostics.telegram.error, 'no-posts');
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('historical recovery reports an unloaded body instead of silent success', async () => {
  const id = '2110595484180214059', r = reader({ conversation: () => ({ targetId: id, rows: [], bodyUnavailableCount: 1 }) });
  const result = await r.core.read(new AbortController().signal, { historyOnly: true,
    telegramLeads: Promise.resolve({ state: 'ok', ids: [id] }) });
  assert.equal(result.diagnostics.telegram.error, 'body-unavailable');
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
});

test('a new live scan interrupts historical recovery before opening its own tab', async () => {
  const id = '2110595484180214059';
  let started;
  const reached = new Promise(resolve => { started = resolve; });
  const r = reader({ scriptRunner: async url => {
    if (url.endsWith('/' + id)) { started(); return new Promise(() => {}); }
    return { rows: [row('123', 'thsottiaux', 'Normal recent public post')] };
  } });
  const history = r.core.read(new AbortController().signal, { historyOnly: true,
    telegramLeads: Promise.resolve({ state: 'ok', ids: [id] }) });
  await reached;
  const live = r.core.read(new AbortController().signal);
  await assert.rejects(history);
  const result = await live;
  assert.equal(result.items[0].id, '123');
  const actions = r.calls.filter(call => ['create', 'remove'].includes(call[0])).map(call => call[0]);
  assert.deepEqual(actions, ['create', 'remove', 'create', 'remove']);
});

test('slow reset follow-ups leave time for all timelines and report deferred checks', async () => {
  const NOW = Date.now();
  const parents = [8101, 8102, 8103].map((id, i) => ({ ...row(String(id), 'thsottiaux', 'Codex reset day today.'),
    createdAt: new Date(NOW - (4 - i) * 3600000).toISOString() }));
  const children = parents.flatMap((parent, i) => Array.from({ length: 3 }, (_, j) => ({ ...row(String(8200 + i * 3 + j), 'thsottiaux', 'By midnight PST'), createdAt: new Date(Date.parse(parent.createdAt) + (j + 1) * 60000).toISOString() })));
  const r = reader({ authors: Array.from(Direct.AUTHORS), now: NOW, conversationDelayMs: 20000, timelineDelayMs: 20000,
    timeline: { rows: parents }, conversation: url => {
      const parent = parents.find(item => url.endsWith('/' + item.id));
      if (parent) return { targetId: parent.id, rows: [parent], followUps: children.filter(child => Date.parse(child.createdAt) > Date.parse(parent.createdAt) && Date.parse(child.createdAt) - Date.parse(parent.createdAt) < 3600000) };
      const child = children.find(item => url.endsWith('/' + item.id));
      const owner = parents.find(item => Date.parse(child.createdAt) > Date.parse(item.createdAt) && Date.parse(child.createdAt) - Date.parse(item.createdAt) < 3600000);
      return { targetId: child.id, rows: [owner, child] };
    } });
  const result = await r.core.read(new AbortController().signal, { resetTargets: parents, retainedPosts: parents });
  assert.equal(result.diagnostics.timelines.length, 6);
  assert.ok(result.diagnostics.timelines.every(t => t.ok));
  assert.ok(result.diagnostics.deferredResetChecks > 0);
  assert.ok(result.diagnostics.conversationFailures > 0);
  assert.ok(parents.every(parent => result.items.some(item => item.id === parent.id)));
  assert.deepEqual(r.calls.at(-1), ['remove', 33]);
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
