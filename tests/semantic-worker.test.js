const test = require('node:test');
const assert = require('node:assert/strict');
const { makeWorker, json, finishPublicResume } = require('./helpers/worker');
global.RadarTime = require('../src/core/time');
global.RadarSemantic = require('../src/core/semantic');
global.RadarSignals = require('../src/core/signals');
const News = require('../src/core/news');
const Settings = require('../src/core/settings');
const NOW = Date.parse('2026-10-22T14:00:00Z');
// Host-side News.select must use the same fixture time as the worker.
test.mock.timers.enable({ apis: ['Date'], now: NOW });
const ITEM = { id: '959501', author: 'thsottiaux', createdAt: '2026-10-22T13:00:00Z',
  url: 'https://x.com/thsottiaux/status/959501', text: 'Your quota gets a fresh start after dinner.', source: { id: 'codex-lead', weight: 1 } };
const settings = { monitorAccount: false, monitorSignals: true, monitorLeadSource: true, semanticEnabled: true,
  monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false, quietHoursEnabled: false, notifyHints: true };
const clone = x => JSON.parse(JSON.stringify(x));
function worker(stored = { settings }, rows = [ITEM], category = 'forecast') {
  const w = makeWorker({ stored, fetcher: async () => json({ items: [] }) });
  w.context.Date = class extends Date { static now() { return NOW; } };
  w.order = [];
  w.context.LanguageModel = { availability: async () => 'available', create: async () => {
    w.order.push('create');
    return { prompt: async (input, config) => { const item = JSON.parse(input);
      if (config.responseConstraint.type === 'boolean') { w.order.push('scope'); return 'true'; }
      w.order.push('prompt');
      return JSON.stringify({ category, evidence: ['unrelated','cancelled'].includes(category) ? '' : item.text }); },
    destroy: () => w.order.push('destroy') };
  } };
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => {
    w.order.push('read'); return { items: rows, contextCache: {}, diagnostics: { posts: rows.length,
      timelines: ['posts', 'replies'].flatMap(kind => ['thsottiaux', 'reach_vb', 'openai'].map(author => ({ kind, author, ok: true, stopReason: 'seven-days' }))) } };
  } };
  const create = w.context.chrome.notifications.create;
  w.context.chrome.notifications.create = async (id, options) => { w.order.push(id); return create(id, options); };
  return w;
}
const start = async w => { await w.events.startup(); await finishPublicResume(w); };

test('startup collects, semantically interprets a previously unclassified phrase, and sends one qualified AI notification', async () => {
  assert.equal(RadarSignals.classifyHint(ITEM, { now: NOW }).candidate, false);
  const w = worker(); await start(w);
  assert.ok(w.notifications['hint:' + ITEM.id]);
  assert.match(w.notifications['hint:' + ITEM.id].title, /리셋 추정/);
  assert.ok(w.order.indexOf('read') < w.order.indexOf('prompt'));
  assert.ok(w.order.indexOf('prompt') < w.order.indexOf('hint:' + ITEM.id));
  assert.equal(w.local.semanticStatus.pending, 0);
  assert.equal(w.local.hintSnapshot.items[0].assessment.rule, 'semantic-reset');
  const entry = News.select(null, w.local.hintSnapshot, Settings.sanitize(settings));
  assert.equal(entry.label, '리셋 추정'); assert.equal(entry.explicit, false);
  assert.match(entry.caption, /미확정/);
  await w.context.refreshSignals();
  assert.equal(w.order.filter(x => x === 'prompt').length, 1);
  assert.equal(w.order.filter(x => x === 'hint:' + ITEM.id).length, 1);
  const restarted = worker(clone(w.local)); await start(restarted);
  assert.equal(restarted.order.filter(x => x === 'prompt').length, 0);
  assert.equal(restarted.order.filter(x => x === 'hint:' + ITEM.id).length, 0);
});

test('a new negative interpretation retracts the prior AI candidate and leaves no invented completion report', async () => {
  const w = worker(); await w.context.refreshSignals();
  const edited = { ...ITEM, text: 'No fresh quota today. The plan was cancelled.' };
  const next = worker(clone(w.local), [edited], 'cancelled');
  await next.context.refreshSignals();
  assert.equal(next.local.hintSnapshot.items.some(x => x.id === ITEM.id), false);
  assert.equal(next.local.signalSnapshot.reports.some(x => x.assessment.report === 'completed-reset'), false);
});

test('unsupported AI preserves original collection and deterministic alerts, with explicit pending status', async () => {
  const strict = { ...ITEM, id: '959502', url: 'https://x.com/thsottiaux/status/959502', text: 'More resets coming tomorrow.' };
  const incomplete = { ...ITEM, id: '959503', url: 'https://x.com/thsottiaux/status/959503', text: 'An incomplete body', truncated: true };
  const w = worker({ settings }, [strict, incomplete]); delete w.context.LanguageModel;
  await w.context.refreshSignals();
  assert.ok(w.notifications['signal:' + strict.id]);
  assert.equal(w.local.signalSnapshot.itemCount, 2, 'AI eligibility cannot discard the original collector output');
  assert.equal(w.local.semanticStatus.state, 'unsupported'); assert.equal(w.local.semanticStatus.pending, 1);
  assert.equal(w.order.includes('create'), false);
});

test('AI off removes cached decisions, pending candidates and retry alarm', async () => {
  const w = worker(); await w.context.refreshSignals();
  await w.context.chrome.alarms.create('codex-reset-radar-semantic-retry', { delayInMinutes: 1 });
  await w.context.saveSettings({ ...settings, semanticEnabled: false });
  assert.equal(w.local.semanticState, undefined); assert.equal(w.local.semanticStatus, undefined);
  assert.equal(w.local.hintSnapshot.items.some(x => x.assessment.rule === 'semantic-reset'), false);
  const prompts = w.order.filter(x => x === 'prompt').length;
  await w.context.refreshSignals();
  assert.equal(w.order.filter(x => x === 'prompt').length, prompts);
});

test('turning monitoring off during inference cannot restore cleared public data or issue a toast', async () => {
  const w = worker(); await w.context.ensureSecurity();
  let entered;
  const running = new Promise(resolve => { entered = resolve; });
  w.context.LanguageModel.create = async () => ({ prompt: (input, { signal }) => {
    entered(); return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  }, destroy() {} });
  const refresh = w.context.refreshSignals(); await running;
  await w.context.saveSettings({ ...settings, monitorSignals: false });
  await refresh;
  assert.equal(w.local.semanticState, undefined);
  assert.equal((w.local.hintSnapshot?.items || []).length, 0);
  assert.equal(w.notifications['hint:' + ITEM.id], undefined);
});

test('a post first interpreted after the original alert window still gets one qualified AI alert', async () => {
  const original = worker(); delete original.context.LanguageModel;
  await original.context.refreshSignals();
  assert.equal(original.notifications['hint:' + ITEM.id], undefined);
  const later = worker(clone(original.local));
  later.context.Date = class extends Date { static now() { return NOW + 2 * 86400000; } };
  await later.context.refreshSignals();
  assert.ok(later.local.pendingNotifications.some(x => x.id === 'hint:' + ITEM.id), 'late interpretation is queued with renewed eligibility');
  await finishPublicResume(later);
  assert.ok(later.notifications['hint:' + ITEM.id], 'late first successful AI interpretation alerts after the resume collection fence');
  await later.context.refreshSignals();
  assert.equal(later.order.filter(x => x === 'hint:' + ITEM.id).length, 1);
});

test('AI retry consumes stored public posts without X tabs, network collection, or false collection success', async () => {
  const w = worker(); delete w.context.LanguageModel;
  await w.context.refreshSignals();
  const priorSnapshot = clone(w.local.signalSnapshot);
  const next = worker(clone(w.local));
  next.context.RadarDirectX.read = async () => { throw new Error('must not crawl X on AI retry'); };
  await next.events.alarm({name:'codex-reset-radar-semantic-retry'});
  assert.equal(next.requests.length, 0);
  assert.equal(next.tabs.length, 0);
  assert.equal(next.local.semanticStatus.pending, 0);
  assert.equal(next.local.signalSnapshot.checkedAt, priorSnapshot.checkedAt);
  assert.deepEqual(next.local.signalSnapshot.leadStatus, priorSnapshot.leadStatus);
  assert.ok(next.notifications['hint:' + ITEM.id]);
  await next.events.alarm({name:'codex-reset-radar-semantic-retry'});
  assert.equal(next.order.filter(x=>x === 'hint:' + ITEM.id).length, 1);
});

test('source failure cannot leave an available model incorrectly labelled unprepared', async () => {
  const w = worker({settings:{...settings,monitorDirectX:false}});
  w.context.fetch = async () => { throw new Error('source unavailable'); };
  w.context.RadarDirectX.read = async () => { throw new Error('X unavailable'); };
  await w.context.refreshSignals();
  assert.equal(w.local.semanticStatus.state, 'available');
  assert.equal(w.local.signalError.message, 'Public sources unavailable');
});

test('a source outage after restart rearms retained AI work without reporting collection success', async () => {
  const first = worker(); delete first.context.LanguageModel;
  await first.context.refreshSignals();
  const next = worker(clone(first.local));
  next.context.fetch = async () => { throw new Error('offline'); };
  next.context.RadarDirectX.read = async () => { throw new Error('offline'); };
  await next.context.refreshSignals();
  assert.ok(await next.context.chrome.alarms.get('codex-reset-radar-semantic-retry'));
  const failedSnapshot = clone(next.local.signalSnapshot);
  await next.events.alarm({name:'codex-reset-radar-semantic-retry'});
  assert.equal(next.local.semanticStatus.pending, 0);
  assert.equal(next.local.signalError.message, 'Public sources unavailable');
  assert.equal(next.local.signalSnapshot.checkedAt, failedSnapshot.checkedAt);
});

test('a deterministic reset alert is delivered before model startup can block', async () => {
  const strict = { ...ITEM, text:'More resets coming tomorrow.' };
  const w = worker({settings}, [strict]);
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  w.context.LanguageModel.create = async () => {
    entered(); await gate;
    return {prompt:async()=> 'false', destroy() {}};
  };
  const refreshing = w.context.refreshSignals();
  await ready;
  assert.ok(w.notifications['signal:' + strict.id], 'an existing rule alert cannot wait for native AI startup');
  release(); await refreshing;
});

test('a new AI candidate is delivered while older backlog inference is still blocked', async () => {
  const older = { ...ITEM, id:'959502', url:'https://x.com/thsottiaux/status/959502', text:'I sent my accountant the documents.', createdAt:'2026-10-22T12:00:00Z' };
  const w = worker({settings}, [older, ITEM]);
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; });
  w.context.LanguageModel.create = async () => ({ prompt:async (input, config) => {
    const item = JSON.parse(input);
    if (item.text === older.text) { entered(); return new Promise(resolve => { release = () => resolve('false'); }); }
    return config.responseConstraint.type === 'boolean' ? 'true' : JSON.stringify({category:'forecast',evidence:item.text});
  }, destroy() {} });
  const refreshing = w.context.refreshSignals(); await ready;
  assert.ok(w.notifications['hint:' + ITEM.id], 'new positive evidence is delivered at checkpoint');
  assert.equal(w.local.semanticStatus.pending, 1);
  release(); await refreshing;
  assert.equal(w.local.semanticStatus.pending, 0);
  assert.equal(w.order.filter(x=>x === 'hint:' + ITEM.id).length, 1);
});

test('a long X scan defers inference instead of exceeding the service-worker event budget', async () => {
  const w = worker();
  const read = w.context.RadarDirectX.read;
  w.context.RadarDirectX.read = async (...args) => {
    const value = await read(...args);
    w.context.Date = class extends Date { static now() { return NOW + 250000; } };
    return value;
  };
  await w.context.refreshSignals();
  assert.equal(w.order.includes('create'), false);
  assert.equal(w.local.semanticStatus.pending, 1);
  const alarm = await w.context.chrome.alarms.get('codex-reset-radar-semantic-retry');
  assert.ok(alarm.when >= NOW + 280000);
  await w.events.alarm({name:'codex-reset-radar-semantic-retry'});
  assert.equal(w.local.semanticStatus.pending, 0);
});

test('a manual fresh-post request during AI retry is neither swallowed nor returned as undefined', async () => {
  const first = worker(); delete first.context.LanguageModel;
  await first.context.refreshSignals();
  const w = worker(clone(first.local));
  let entered, release;
  const ready = new Promise(resolve=>{entered=resolve;});
  const gate = new Promise(resolve=>{release=resolve;});
  w.context.LanguageModel.create = async()=>{entered();await gate;return {prompt:async()=> 'false',destroy(){}};};
  const retry = w.events.alarm({name:'codex-reset-radar-semantic-retry'});
  await ready;
  const manual = w.send({type:'REFRESH_SIGNALS'},w.sender('popup'));
  release(); await retry;
  const result = await manual;
  assert.equal(result.ok,true);
  assert.equal(result.semanticOnly,undefined);
  assert.equal(w.order.filter(x=>x==='read').length,1,'fresh collection actually runs after the in-flight AI retry');
});

test('a second AI retry cannot swallow fresh collection while the mutation lock is released', async () => {
  const vm = require('node:vm');
  const w = worker(); await w.context.ensureSecurity();
  let finishA, finishB, releaseMutation, reads = 0;
  w.context.fixtureJobA = new Promise(resolve => { finishA = resolve; });
  w.context.fixtureJobB = new Promise(resolve => { finishB = resolve; });
  w.context.fixtureMutation = new Promise(resolve => { releaseMutation = resolve; });
  w.context.runSignalRefresh = async () => { reads++; return {ok:true,fresh:true}; };
  vm.runInContext(`semanticOnlyJob = true; signalJob = fixtureJobA.finally(() => {
    signalJob = null; semanticOnlyJob = false; mutations = fixtureMutation;
  });`, w.context);
  const fresh = w.context.refreshSignals();
  await new Promise(setImmediate);
  finishA({ok:true,semanticOnly:true});
  await new Promise(setImmediate);
  vm.runInContext(`semanticOnlyJob = true; signalJob = fixtureJobB.finally(() => {
    signalJob = null; semanticOnlyJob = false;
  });`, w.context);
  releaseMutation();
  await new Promise(setImmediate);
  finishB({ok:true,semanticOnly:true});
  const result = await fresh;
  assert.equal(result.fresh,true,'fresh collection must run even when another AI-only retry wins the lock');
  assert.equal(reads,1);
});
