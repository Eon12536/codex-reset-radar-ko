const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { makeWorker } = require('./helpers/worker');
const source = fs.readFileSync(require.resolve('../src/core/direct-x'), 'utf8');
const KEY = 'directXScanTabV1';
const PAGE = 'https://x.com/thsottiaux';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const lease = (extra = {}) => ({ id: 7, windowId: 1, startedAt: Date.now() - 60000, expiresAt: Date.now() + 120000, urls: [PAGE], claimed: false, ...extra });

function browser({ stored, tab, failRemove = false, failGet = false, failSet = false, script, create, created, getStored } = {}) {
  const session = stored ? { [KEY]: structuredClone(stored) } : {};
  const tabs = new Map(tab ? [[tab.id, { status: 'complete', active: false, pinned: false, windowId: 1, ...tab }]] : []);
  const alarms = new Map(), calls = [], listeners = {}, timers = new Set();
  let nextId = 10, maxTabs = tabs.size;
  const faults = { failRemove, failGet, failSet };
  const chrome = {
    permissions: { contains: async () => true },
    storage: { session: {
      get: async key => { await getStored?.(); return structuredClone({ [key]: session[key] }); },
      set: async value => { if (faults.failSet) throw new Error('Storage failed'); Object.assign(session, structuredClone(value)); },
      remove: async key => { delete session[key]; }
    } },
    alarms: { create: async (name, value) => alarms.set(name, value), clear: async name => alarms.delete(name) },
    tabs: {
      create: async options => {
        await create?.();
        const tab = { id: nextId++, windowId: 1, status: 'complete', pinned: false, ...options };
        calls.push(['create', tab.id]); tabs.set(tab.id, tab); maxTabs = Math.max(maxTabs, tabs.size); await created?.(tab.id); return { ...tab };
      },
      get: async id => {
        if (faults.failGet) throw new Error('Temporary tab API failure');
        if (!tabs.has(id)) throw new Error('No tab with id: ' + id);
        return { ...tabs.get(id) };
      },
      update: async (id, options) => { calls.push(['update', id]); Object.assign(tabs.get(id), options); },
      remove: async id => { calls.push(['remove', id]); if (faults.failRemove) throw new Error('Temporary removal failure'); tabs.delete(id); },
      onUpdated: { addListener() {}, removeListener() {} },
      onActivated: { addListener: fn => { listeners.activate = fn; } }
    },
    scripting: { executeScript: async options => {
      calls.push(['script', options.target.tabId]); await script?.(options.target.tabId);
      return [{ frameId: 0, result: { rows: [{ id: '123', author: 'thsottiaux', text: 'Hello', createdAt: new Date().toISOString(), url: PAGE + '/status/123' }] } }];
    } }
  };
  function load() {
    const context = vm.createContext({ chrome, URL, Date,
      setTimeout: (fn, delay) => { const timer = setTimeout(fn, delay); timer.unref(); timers.add(timer); return timer; },
      clearTimeout: timer => { clearTimeout(timer); timers.delete(timer); }
    });
    vm.runInContext(source, context);
    return context.RadarDirectX;
  }
  return { load, session, tabs, alarms, calls, faults, listeners, maxTabs: () => maxTabs,
    stopWorker: () => { for (const timer of timers) clearTimeout(timer); timers.clear(); } };
}
const read = core => core.read(new AbortController().signal, { authors: ['thsottiaux'] });

test('concurrent direct scans share one tab and remove the session ownership record afterwards', async () => {
  const reached = deferred(), gate = deferred();
  const b = browser({ script: async () => { reached.resolve(); await gate.promise; } }), core = b.load();
  const first = read(core), second = read(core);
  assert.equal(first, second);
  await reached.promise;
  assert.equal(b.calls.filter(c => c[0] === 'create').length, 1);
  assert.equal(b.session[KEY].id, 10);
  assert.equal(b.alarms.has(core.CLEANUP_ALARM), true);
  gate.resolve(); await first;
  assert.equal(b.tabs.size, 0);
  assert.equal(b.session[KEY], undefined);
  assert.equal(b.alarms.size, 0);
});

test('a restarted worker reclaims its interrupted scan before creating another tab', async () => {
  const reached = deferred(), abandoned = deferred();
  let pause = true;
  const b = browser({ script: async () => { if (pause) { reached.resolve(); await abandoned.promise; } } });
  void read(b.load()).catch(() => {});
  await reached.promise;
  assert.equal(b.session[KEY].id, 10);
  b.stopWorker(); pause = false;
  const restarted = b.load();
  await read(restarted);
  assert.deepEqual(b.calls.filter(c => ['create', 'remove'].includes(c[0])), [['create', 10], ['remove', 10], ['create', 11], ['remove', 11]]);
  assert.equal(b.maxTabs(), 1);
  assert.equal(b.tabs.size, 0);
});

test('failed tab removal blocks additional tabs and retries after the API recovers', async () => {
  const b = browser({ failRemove: true }), core = b.load();
  await assert.rejects(read(core), /X_TAB_CLEANUP_FAILED/);
  await assert.rejects(read(core), /X_TAB_CLEANUP_FAILED/);
  assert.equal(b.calls.filter(c => c[0] === 'create').length, 1);
  assert.equal(b.session[KEY].id, 10);
  assert.equal(b.alarms.has(core.CLEANUP_ALARM), true);
  b.faults.failRemove = false;
  await read(core);
  assert.equal(b.maxTabs(), 1);
  assert.equal(b.tabs.size, 0);
});

test('expired scan ownership is cleaned independently without opening or reading X', async () => {
  const b = browser({ stored: lease({ expiresAt: Date.now() - 1 }), tab: { id: 7, url: 'https://x.com/home' } }), core = b.load();
  await core.cleanup();
  assert.deepEqual(b.calls, [['remove', 7]]);
  assert.equal(b.session[KEY], undefined);
});

test('unexpired ownership remains scheduled until the deadline unless the worker is recovering', async () => {
  const b = browser({ stored: lease(), tab: { id: 7, url: PAGE } }), core = b.load();
  assert.equal(await core.cleanup(), false);
  assert.equal(b.tabs.size, 1);
  assert.equal(b.alarms.has(core.CLEANUP_ALARM), true);
  await core.cleanup({ recover: true });
  assert.equal(b.tabs.size, 0);
});

test('a user selection followed by deselection permanently preserves the scan tab', async () => {
  const b = browser({ script: async id => {
    b.tabs.get(id).active = true;
    b.listeners.activate({ tabId: id });
    b.tabs.get(id).active = false;
  } }), core = b.load();
  await assert.rejects(read(core), /X_PAGE_UNAVAILABLE/);
  assert.equal(b.tabs.size, 1);
  assert.equal(b.calls.some(c => ['update', 'remove'].includes(c[0])), false);
  assert.equal(b.session[KEY], undefined);
});

test('selected, pinned, moved, claimed and privately navigated tabs are preserved during recovery', async () => {
  for (const patch of [{ active: true }, { pinned: true }, { windowId: 2 }, { claimed: true }, { url: 'https://x.com/i/chat' }, { url: 'https://example.com/' }]) {
    const b = browser({ stored: lease({ claimed: Boolean(patch.claimed) }), tab: { id: 7, url: PAGE, ...patch } });
    await b.load().cleanup({ recover: true });
    assert.equal(b.tabs.size, 1, JSON.stringify(patch));
    assert.equal(b.calls.length, 0);
    assert.equal(b.session[KEY], undefined);
  }
});

test('a temporary tab lookup failure retains ownership and prevents another scan tab', async () => {
  const b = browser({ stored: lease(), tab: { id: 7, url: PAGE }, failGet: true }), core = b.load();
  await assert.rejects(read(core), /X_TAB_CLEANUP_FAILED/);
  assert.equal(b.calls.length, 0);
  assert.equal(b.session[KEY].id, 7);
  b.faults.failGet = false;
  await read(core);
  assert.equal(b.maxTabs(), 1);
  assert.equal(b.tabs.size, 0);
});

test('already closed tabs and malformed ownership records do not target unrelated tabs', async () => {
  for (const stored of [lease(), lease({ id: -1 }), lease({ windowId: '1' }), lease({ urls: ['https://x.com/i/chat'] }), lease({ expiresAt: Date.now() + 86400000 }), lease({ urls: Array(13).fill(PAGE) }), { id: 7 }]) {
    const b = browser({ stored, tab: { id: 8, url: PAGE } });
    await b.load().cleanup({ recover: true });
    assert.equal(b.calls.length, 0);
    assert.equal(b.tabs.size, 1);
    assert.equal(b.session[KEY], undefined);
  }
});

test('a persistence failure cleans the just-created tab instead of leaving an orphan', async () => {
  const b = browser({ failSet: true });
  await assert.rejects(read(b.load()), /Storage failed/);
  assert.equal(b.tabs.size, 0);
  assert.deepEqual(b.calls.filter(c => ['create', 'remove'].includes(c[0])), [['create', 10], ['remove', 10]]);
});

test('a late tab creation after cancellation is still recorded and closed', async () => {
  const reached = deferred(), gate = deferred(), controller = new AbortController();
  const b = browser({ create: async () => { reached.resolve(); await gate.promise; } });
  const pending = b.load().read(controller.signal, { authors: ['thsottiaux'] });
  await reached.promise; controller.abort(); gate.resolve();
  await assert.rejects(pending);
  assert.equal(b.tabs.size, 0);
  assert.equal(b.calls.filter(c => c[0] === 'create').length, 1);
  assert.equal(b.calls.filter(c => c[0] === 'remove').length, 1);
  assert.equal(b.session[KEY], undefined);
});

test('activation after worker restart preserves the recorded tab even if it is no longer active', async () => {
  const b = browser({ stored: lease(), tab: { id: 7, url: PAGE } }), core = b.load();
  b.listeners.activate({ tabId: 7 });
  await core.cleanup({ recover: true });
  assert.equal(b.tabs.size, 1);
  assert.equal(b.calls.length, 0);
});

test('selection while ownership restoration is delayed is preserved after deselection', async () => {
  const reached = deferred(), gate = deferred();
  const b = browser({ stored: lease(), tab: { id: 7, url: PAGE }, getStored: async () => { reached.resolve(); await gate.promise; } });
  const pending = b.load().cleanup({ recover: true });
  await reached.promise;
  b.listeners.activate({ tabId: 7 });
  b.listeners.activate({ tabId: 8 });
  gate.resolve(); await pending;
  assert.equal(b.tabs.size, 1);
  assert.equal(b.calls.length, 0);
});

test('selection before tab creation returns is preserved after a quick deselection', async () => {
  const b = browser({ created: async id => {
    b.listeners.activate({ tabId: id });
    b.listeners.activate({ tabId: 8 });
  } });
  await assert.rejects(read(b.load()), /X_PAGE_UNAVAILABLE/);
  assert.equal(b.tabs.size, 1);
  assert.equal(b.calls.some(c => ['script', 'update', 'remove'].includes(c[0])), false);
});

test('deceptive redirect origins and unrelated public paths cannot authorize tab removal', async () => {
  for (const url of ['https://x.com.evil.test/home', 'https://x.com@evil.test/home', 'http://x.com/home', 'https://x.com/reach_vb', 'https://x.com/i/flow/login/other']) {
    const b = browser({ stored: lease(), tab: { id: 7, url } });
    await b.load().cleanup({ recover: true });
    assert.equal(b.tabs.size, 1, url);
    assert.equal(b.calls.length, 0);
  }
});

test('the background cleanup alarm reclaims persisted ownership without starting a feed scan', async () => {
  const w = makeWorker();
  w.session[KEY] = lease({ expiresAt: Date.now() - 1 });
  const removed = [];
  w.context.chrome.tabs.get = async id => ({ id, windowId: 1, active: false, url: 'https://x.com/i/timeline' });
  w.context.chrome.tabs.remove = async id => removed.push(id);
  await w.events.alarm({ name: w.context.RadarDirectX.CLEANUP_ALARM });
  assert.deepEqual(removed, [7]);
  assert.equal(w.tabs.length, 0);
  assert.equal(w.requests.length, 0);
  assert.equal(w.session[KEY], undefined);
});

test('clearing local data cannot erase ownership when tab cleanup fails', async () => {
  const w = makeWorker();
  w.session[KEY] = lease();
  w.context.chrome.tabs.get = async id => ({ id, windowId: 1, active: false, url: PAGE });
  w.context.chrome.tabs.remove = async () => { throw new Error('Temporary removal failure'); };
  const result = await w.send({ type: 'CLEAR_LOCAL_DATA' }, w.sender('options'));
  assert.equal(result.ok, false);
  assert.equal(w.session[KEY].id, 7);
  assert.ok(await w.context.chrome.alarms.get(w.context.RadarDirectX.CLEANUP_ALARM));
});
