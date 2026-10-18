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

function browser({ stored, tab, failRemove = false, failGet = false, failSet = false, failLocalSet = false, script, create, created, getStored, setStored } = {}) {
  const session = stored ? { [KEY]: structuredClone(stored) } : {};
  const local = {};
  const tabs = new Map(tab ? [[tab.id, { status: 'complete', active: false, pinned: false, windowId: 1, ...tab }]] : []);
  const alarms = new Map(), calls = [], listeners = {}, timers = new Set();
  let nextId = 10, maxTabs = tabs.size;
  const faults = { failRemove, failGet, failSet, failLocalSet };
  const chrome = {
    permissions: { contains: async () => faults.permission !== false },
    storage: { local: {
      get: async key => structuredClone({ [key]: local[key] }),
      set: async value => { if (faults.failLocalSet) throw new Error('Durable storage failed'); Object.assign(local, structuredClone(value)); },
      remove: async key => { delete local[key]; }
    }, session: {
      get: async key => { await getStored?.(); return structuredClone({ [key]: session[key] }); },
      set: async value => { if (faults.failSet) throw new Error('Storage failed'); await setStored?.(value); Object.assign(session, structuredClone(value)); },
      remove: async key => { delete session[key]; }
    } },
    alarms: { create: async (name, value) => alarms.set(name, value), clear: async name => alarms.delete(name) },
    tabs: {
      query: async options => {
        if (faults.failQuery) throw new Error('Temporary tab query failure');
        return [...tabs.values()].filter(tab => options.url.some(pattern => {
        const url = String(tab.url).split('#')[0];
        return pattern.endsWith('*') ? url.startsWith(pattern.slice(0, -1)) : url === pattern;
        })).map(tab => ({ ...tab }));
      },
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
    const context = vm.createContext({ chrome, URL, Date, crypto: require('node:crypto').webcrypto,
      setTimeout: (fn, delay) => { const timer = setTimeout(fn, delay); timer.unref(); timers.add(timer); return timer; },
      clearTimeout: timer => { clearTimeout(timer); timers.delete(timer); }
    });
    vm.runInContext(fs.readFileSync(require.resolve('../src/core/tab-owner'), 'utf8'), context);
    vm.runInContext(source, context);
    return context.RadarDirectX;
  }
  return { load, session, local, tabs, alarms, calls, faults, listeners, maxTabs: () => maxTabs,
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
  const result = await read(core);
  assert.equal(result.items.length, 1);
  assert.equal(result.diagnostics.cleanupError, 'tab-blocked');
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

test('selection followed by deselection stops reading but closes the owned X reader', async () => {
  const b = browser({ script: async id => {
    b.tabs.get(id).active = true;
    b.listeners.activate({ tabId: id });
    b.tabs.get(id).active = false;
  } }), core = b.load();
  for (let i = 0; i < 20; i++) {
    await assert.rejects(read(core), /X_PAGE_UNAVAILABLE/);
    assert.equal(b.tabs.size, 0);
    assert.equal(b.session[KEY], undefined);
    assert.equal(b.local[core.GUARD_KEY], undefined);
  }
  assert.equal(b.calls.some(c => c[0] === 'update'), false);
  assert.equal(b.calls.filter(c => c[0] === 'create').length, 20);
  assert.equal(b.calls.filter(c => c[0] === 'remove').length, 20);
  assert.equal(b.maxTabs(), 1);
});

test('selected, pinned, moved, claimed and privately navigated tabs are preserved during recovery', async () => {
  for (const patch of [{ active: true }, { pinned: true }, { windowId: 2 }, { claimed: true }, { url: 'https://x.com/i/chat' }, { url: 'https://example.com/' }]) {
    const b = browser({ stored: lease({ claimed: Boolean(patch.claimed) }), tab: { id: 7, url: PAGE, ...patch } });
    await b.load().cleanup({ recover: true });
    assert.equal(b.tabs.size, 1, JSON.stringify(patch));
    assert.equal(b.calls.length, 0);
    assert.equal(b.session[KEY].claimed, true);
    await assert.rejects(read(b.load()), /X_TAB_BLOCKED/);
    assert.equal(b.calls.length, 0);
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

test('closed tabs release ownership; malformed records block new tabs without targeting unrelated tabs', async () => {
  for (const stored of [lease(), lease({ id: -1 }), lease({ windowId: '1' }), lease({ urls: ['https://x.com/i/chat'] }), lease({ expiresAt: Date.now() + 86400000 }), lease({ urls: Array(13).fill(PAGE) }), { id: 7 }]) {
    const b = browser({ stored, tab: { id: 8, url: PAGE } });
    const core = b.load();
    const cleaned = await core.cleanup({ recover: true });
    assert.equal(b.calls.length, 0);
    assert.equal(b.tabs.size, 1);
    if (stored.id === 7 && stored.windowId === 1 && stored.urls[0] === PAGE && stored.urls.length === 1 && stored.expiresAt - stored.startedAt <= 300000) {
      assert.equal(cleaned, true);
      assert.equal(b.session[KEY], undefined);
    } else {
      assert.equal(cleaned, false);
      assert.equal(b.local[core.GUARD_KEY].blocked, true);
      await assert.rejects(read(core), /X_TAB_BLOCKED/);
      assert.equal(b.calls.length, 0);
    }
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

test('selection before tab creation returns still closes the confirmed reader on failure', async () => {
  const b = browser({ created: async id => {
    b.listeners.activate({ tabId: id });
    b.listeners.activate({ tabId: 8 });
  } });
  await assert.rejects(read(b.load()), /X_PAGE_UNAVAILABLE/);
  assert.equal(b.tabs.size, 0);
  assert.equal(b.calls.some(c => ['script', 'update'].includes(c[0])), false);
  assert.deepEqual(b.calls.filter(c => c[0] === 'remove'), [['remove', 10]]);
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

test('200 sequential scans with transient cleanup failures never accumulate owned tabs', async () => {
  const b = browser(), core = b.load();
  for (let i = 0; i < 200; i++) {
    if (i % 5 === 0) {
      b.faults.failRemove = true;
      assert.equal((await read(core)).diagnostics.cleanupError, 'tab-blocked');
      const created = b.calls.filter(c => c[0] === 'create').length;
      await assert.rejects(read(core), /X_TAB_CLEANUP_FAILED/);
      assert.equal(b.calls.filter(c => c[0] === 'create').length, created);
      b.faults.failRemove = false;
    }
    await read(core);
    assert.equal(b.tabs.size, 0);
    assert.equal(b.session[KEY], undefined);
    assert.equal(b.alarms.size, 0);
  }
  assert.equal(b.maxTabs(), 1);
  assert.equal(b.calls.filter(c => c[0] === 'create').length, 240);
});

test('cancellation while saving the next page prevents navigation and still removes the scan tab', async () => {
  const controller = new AbortController(); let writes = 0;
  const b = browser({ setStored: value => { if (value[KEY] && ++writes === 2) controller.abort(); } });
  await assert.rejects(b.load().read(controller.signal, { authors: ['thsottiaux'] }));
  assert.equal(b.calls.filter(c => c[0] === 'update').length, 0);
  assert.equal(b.tabs.size, 0);
  assert.equal(b.session[KEY], undefined);
});

test('an unreadable Chrome tab URL blocks repeated scans instead of orphaning each tab', async () => {
  const b = browser({ stored: lease(), tab: { id: 7 } }), core = b.load();
  for (let i = 0; i < 30; i++) await assert.rejects(read(core), /X_TAB_BLOCKED/);
  assert.equal(b.tabs.size, 1);
  assert.equal(b.calls.length, 0);
  assert.equal(b.session[KEY].id, 7);
  assert.equal(b.local[core.GUARD_KEY].blocked, true);
});

test('a temporarily missing tab URL does not become a permanent user claim across an update', async () => {
  const token = '00000000-0000-4000-8000-000000000081';
  const b = browser({ stored: lease({ token }), tab: { id: 7 } });
  const core = b.load();
  await assert.rejects(read(core), /X_TAB_BLOCKED/);
  assert.equal(b.session[KEY].claimed, false);
  b.tabs.get(7).url = PAGE + '#radar-x-reader=' + token;
  delete b.session[KEY];
  assert.equal((await read(b.load())).items.length, 1);
  assert.equal(b.tabs.size, 0);
  assert.equal(b.maxTabs(), 1);
});

test('a closed known reader does not strand update recovery behind an unrelated X timeline', async () => {
  const b = browser({ tab: { id: 8, url: 'https://x.com/i/timeline' } });
  const core = b.load();
  b.local[core.GUARD_KEY] = { blocked: true, reason: 'session-lost', lease: lease({
    token: '00000000-0000-4000-8000-000000000081' }) };
  assert.equal((await read(core)).items.length, 1);
  assert.equal(b.tabs.size, 1);
  assert.equal(b.tabs.get(8).url, 'https://x.com/i/timeline');
  assert.equal(b.calls.some(call => call[0] === 'remove' && call[1] === 8), false);
});

test('legacy ownerless update fences migrate without closing unrelated user X tabs', async () => {
  const b = browser({ tab: { id: 8, url: 'https://x.com/i/timeline' } });
  const core = b.load();
  b.local[core.GUARD_KEY] = { blocked: true, reason: 'session-lost' };
  assert.equal((await read(core)).items.length, 1);
  assert.equal(b.tabs.size, 1);
  assert.equal(b.calls.some(call => call[0] === 'remove' && call[1] === 8), false);
});

test('temporary permission and tab-query failures do not consume legacy fence recovery', async () => {
  for (const fault of ['permission', 'failQuery']) {
    const b = browser({ tab: { id: 8, url: 'https://x.com/i/timeline' } });
    b.local[KEY + 'GuardV1'] = { blocked: true, reason: 'session-lost' };
    b.faults[fault] = fault === 'permission' ? false : true;
    await b.load().cleanup({ recover: true }).catch(() => {});
    assert.equal(b.local[KEY + 'GuardV1'].version, undefined);
    assert.equal(b.calls.length, 0);
    b.faults[fault] = fault === 'permission' ? true : false;
    assert.equal((await read(b.load())).items.length, 1);
    assert.equal(b.tabs.size, 1);
    assert.equal(b.tabs.has(8), true);
  }
});

test('50 update cycles recover interrupted readers without accumulating tabs beside a user timeline', async () => {
  const b = browser({ tab: { id: 8, url: 'https://x.com/i/timeline', active: true } });
  for (let i = 0; i < 50; i++) {
    b.faults.failRemove = true;
    assert.equal((await read(b.load())).diagnostics.cleanupError, 'tab-blocked');
    b.faults.failRemove = false;
    const reader = b.tabs.get(b.session[KEY].id), markedUrl = reader.url;
    reader.url = undefined;
    delete b.session[KEY];
    await assert.rejects(read(b.load()), /X_TAB_BLOCKED/);
    assert.equal(b.tabs.size, 2);
    reader.url = markedUrl;
    delete b.session[KEY];
    assert.equal((await read(b.load())).items.length, 1);
    assert.equal(b.tabs.size, 1);
    assert.equal(b.tabs.has(8), true);
    assert.equal(b.local[KEY + 'GuardV1'], undefined);
  }
  assert.equal(b.maxTabs(), 2);
  assert.equal(b.calls.some(call => call[0] === 'remove' && call[1] === 8), false);
});

test('reload and browser restart losing session ownership cannot duplicate a pinned scan tab', async () => {
  const b = browser({ script: id => { b.tabs.get(id).pinned = true; b.listeners.activate({ tabId: id }); } });
  await assert.rejects(read(b.load()), /X_PAGE_UNAVAILABLE/);
  for (let i = 0; i < 20; i++) {
    delete b.session[KEY];
    await assert.rejects(read(b.load()), /X_TAB_BLOCKED/);
  }
  assert.equal(b.tabs.size, 1);
  assert.equal(b.calls.filter(c => c[0] === 'create').length, 1);
  assert.equal(b.calls.some(c => c[0] === 'remove'), false);
});

test('termination inside tabs.create recovers its durable marker before opening another reader', async () => {
  const reached = deferred(), abandoned = deferred();
  let pause = true;
  const b = browser({ created: async () => { if (pause) { reached.resolve(); await abandoned.promise; } } });
  void read(b.load()).catch(() => {});
  await reached.promise; b.stopWorker();
  assert.equal(b.session[KEY], undefined);
  assert.equal(b.tabs.size, 1);
  pause = false;
  const restarted = b.load();
  for (let i = 0; i < 20; i++) await read(restarted);
  assert.equal(b.maxTabs(), 1);
  assert.equal(b.tabs.size, 0);
  assert.equal(b.local[restarted.GUARD_KEY], undefined);
});

test('lost Chrome session recovers by marker even when tab IDs are reused', async () => {
  const reached = deferred(), abandoned = deferred();
  let pause = true;
  const b = browser({ script: async () => { if (pause) { reached.resolve(); await abandoned.promise; } } });
  void read(b.load()).catch(() => {});
  await reached.promise; b.stopWorker();
  const readerTab = b.tabs.get(10);
  b.tabs.set(99, { ...readerTab, id: 99, windowId: 7 });
  b.tabs.set(10, { id: 10, windowId: 1, active: false, status: 'complete', url: 'https://x.com/i/chat' });
  delete b.session[KEY]; pause = false;
  const result = await read(b.load());
  assert.equal(result.items.length, 1);
  assert.equal(b.tabs.has(99), false);
  assert.equal(b.tabs.get(10).url, 'https://x.com/i/chat');
  assert.equal(b.calls.some(call => call[0] === 'remove' && call[1] === 10), false);
});

test('versioned ownerless fences do not repeat the legacy migration with an open X tab', async () => {
  const b = browser();
  const core = b.load();
  b.local[core.GUARD_KEY] = { version: 2, blocked: true, reason: 'session-lost' };
  assert.equal((await read(core)).items.length, 1);
  const protectedBrowser = browser({ tab: { id: 7, url: PAGE } });
  const protectedCore = protectedBrowser.load();
  protectedBrowser.local[protectedCore.GUARD_KEY] = { version: 2, blocked: true, reason: 'session-lost' };
  await assert.rejects(read(protectedCore), /X_TAB_BLOCKED/);
  assert.equal(protectedBrowser.tabs.has(7), true);
  assert.equal(protectedBrowser.calls.some(call => call[0] === 'remove'), false);
});

test('missing URL plus lost session keeps one reader until its URL becomes available', async () => {
  const token = '00000000-0000-4000-8000-000000000081';
  const b = browser({ tab: { id: 7 } });
  b.local[KEY + 'GuardV1'] = { blocked: true, lease: lease({ token }) };
  for (let i = 0; i < 20; i++) {
    delete b.session[KEY];
    await assert.rejects(read(b.load()), /X_TAB_BLOCKED/);
  }
  assert.equal(b.calls.length, 0);
  assert.equal(b.tabs.size, 1);
  b.tabs.get(7).url = PAGE + '#radar-x-reader=' + token;
  assert.equal((await read(b.load())).items.length, 1);
  assert.equal(b.maxTabs(), 1);
  assert.equal(b.tabs.size, 0);
});

test('legacy migration refuses marked readers and malformed ownership records', async () => {
  const token = '00000000-0000-4000-8000-000000000081';
  for (const extra of [{ lease: null }, { pending: null }, { lease: { id: 7 } }]) {
    const b = browser({ tab: { id: 7, url: PAGE } });
    b.local[KEY + 'GuardV1'] = { blocked: true, reason: 'session-lost', ...extra };
    await assert.rejects(read(b.load()), /X_TAB_BLOCKED/);
    assert.equal(b.calls.length, 0);
  }
  const b = browser({ tab: { id: 7, url: PAGE + '#radar-x-reader=' + token } });
  b.local[KEY + 'GuardV1'] = { blocked: true, reason: 'session-lost' };
  await assert.rejects(read(b.load()), /X_TAB_BLOCKED/);
  assert.equal(b.calls.length, 0);
});

test('an active marked reader is closed after session loss before the next scan', async () => {
  const b = browser();
  const token = '00000000-0000-4000-8000-000000000079';
  const core = b.load();
  b.local[core.GUARD_KEY] = { blocked: true, reason: 'session-lost', lease: lease({ token }) };
  b.tabs.set(7, { id: 7, windowId: 1, active: true, url: PAGE + '#radar-x-reader=' + token });
  assert.equal((await read(core)).items.length, 1);
  assert.deepEqual(b.calls.filter(c => ['create', 'remove'].includes(c[0])), [['remove', 7], ['create', 10], ['remove', 10]]);
  assert.equal(b.tabs.size, 0);
  assert.equal(b.maxTabs(), 1);
});

test('an active reader closes on abort without touching the existing user X tab', async () => {
  const controller = new AbortController();
  const b = browser({ tab: { id: 7, url: PAGE }, script: async id => {
    b.tabs.get(id).active = true;
    b.listeners.activate({ tabId: id });
    controller.abort();
  } });
  await assert.rejects(b.load().read(controller.signal, { authors: ['thsottiaux'] }));
  assert.deepEqual([...b.tabs.keys()], [7]);
  assert.deepEqual(b.calls.filter(c => c[0] === 'remove'), [['remove', 10]]);
});

test('previously selected nonce-marked status readers close after an extension update', async () => {
  const token = '00000000-0000-4000-8000-000000000084';
  const status = 'https://x.com/OpenAI/status/2104993967985381673';
  for (const sessionLost of [false, true]) {
    const stored = lease({ token, claimed: true, urls: [PAGE, status] });
    const b = browser({ stored: sessionLost ? undefined : stored,
      tab: { id: 7, active: true, url: status + '#radar-x-reader=' + token } });
    const core = b.load();
    b.local[core.GUARD_KEY] = { version: 2, blocked: true, reason: 'tab-open', lease: stored };
    assert.equal(await core.cleanup({ recover: true }), true);
    assert.equal(b.tabs.size, 0);
    assert.equal(b.session[KEY], undefined);
    assert.equal(b.local[core.GUARD_KEY], undefined);
  }
});

test('selected reader removal failure keeps one fenced tab until cleanup retry succeeds', async () => {
  const b = browser({ failRemove: true, script: async id => {
    b.tabs.get(id).active = true;
    b.listeners.activate({ tabId: id });
  } }), core = b.load();
  await assert.rejects(read(core), /X_TAB_CLEANUP_FAILED/);
  await assert.rejects(read(core), /X_TAB_CLEANUP_FAILED/);
  assert.equal(b.calls.filter(c => c[0] === 'create').length, 1);
  assert.equal(b.alarms.has(core.CLEANUP_ALARM), true);
  b.faults.failRemove = false;
  assert.equal(await core.cleanup({ recover: true }), true);
  assert.equal(b.tabs.size, 0);
});

test('nonce-marked reader ownership never overrides pinning, moving or a pending user navigation', async () => {
  const token = '00000000-0000-4000-8000-000000000084';
  const url = PAGE + '#radar-x-reader=' + token;
  for (const patch of [{ pinned: true }, { windowId: 2 }, { url: 'https://x.com/i/chat' },
    { pendingUrl: 'https://example.com/' }, { pendingUrl: 'https://x.com/i/chat' }]) {
    const b = browser({ stored: lease({ token, claimed: true }), tab: { id: 7, active: true, url, ...patch } });
    assert.equal(await b.load().cleanup({ recover: true }), false, JSON.stringify(patch));
    assert.equal(b.calls.some(c => c[0] === 'remove'), false);
    // Explicit user changes remain protected, even if later changed back.
    Object.assign(b.tabs.get(7), { active: false, pinned: false, windowId: 1, url, pendingUrl: undefined });
    assert.equal(await b.load().cleanup({ recover: true }), false, JSON.stringify(patch));
    assert.equal(b.tabs.size, 1);
  }
});

test('selection cleanup requires the exact stored reader nonce and requested URL', async () => {
  const token = '00000000-0000-4000-8000-000000000084';
  for (const url of [PAGE, PAGE + '#radar-x-reader=00000000-0000-4000-8000-000000000099',
    'https://x.com/reach_vb#radar-x-reader=' + token, 'https://x.com/i/flow/login#radar-x-reader=' + token]) {
    const b = browser({ stored: lease({ token, claimed: true }), tab: { id: 7, active: true, url } });
    assert.equal(await b.load().cleanup({ recover: true }), false, url);
    assert.equal(b.calls.some(c => c[0] === 'remove'), false);
  }
});

test('canonical account casing and trailing slash do not strand a selected marked reader', async () => {
  const token = '00000000-0000-4000-8000-000000000085';
  const status = 'https://x.com/OpenAI/status/2104993967985381673';
  for (const pendingUrl of [undefined, 'https://x.com/openai/status/2104993967985381673/#radar-x-reader=' + token]) {
    const b = browser({ stored: lease({ token, claimed: true, urls: [status] }),
      tab: { id: 7, active: true, url: 'https://x.com/openai/status/2104993967985381673/#radar-x-reader=' + token, pendingUrl } });
    assert.equal(await b.load().cleanup({ recover: true }), true);
    assert.equal(b.tabs.size, 0);
    assert.equal(b.session[KEY], undefined);
  }
});

test('session-loss recovery checks the known reader nonce even when a canonical URL misses its query filter', async () => {
  const token = '00000000-0000-4000-8000-000000000085';
  const stored = lease({ token, claimed: true });
  const b = browser({ tab: { id: 7, active: true, url: 'https://x.com/ThSottiaux/#radar-x-reader=' + token } });
  const core = b.load();
  b.local[core.GUARD_KEY] = { version: 2, blocked: true, reason: 'tab-open', lease: stored };
  assert.equal(await core.cleanup({ recover: true }), true);
  assert.equal(b.tabs.size, 0);
});

test('pending user navigation protects even an inactive owned reader before its URL changes', async () => {
  const token = '00000000-0000-4000-8000-000000000084';
  const url = PAGE + '#radar-x-reader=' + token;
  for (const pendingUrl of ['https://x.com/i/chat', 'https://example.com/', PAGE]) {
    const b = browser({ stored: lease({ token }), tab: { id: 7, url, pendingUrl } });
    assert.equal(await b.load().cleanup({ recover: true }), false, pendingUrl);
    assert.equal(b.calls.some(c => c[0] === 'remove'), false);
    b.tabs.get(7).pendingUrl = undefined;
    assert.equal(await b.load().cleanup({ recover: true }), false);
  }
});

test('a pending user navigation during reading prevents further scan navigation or removal', async () => {
  const b = browser({ script: id => { b.tabs.get(id).pendingUrl = 'https://x.com/i/chat'; } });
  await assert.rejects(read(b.load()), /X_PAGE_UNAVAILABLE/);
  assert.equal(b.calls.filter(c => c[0] === 'script').length, 1);
  assert.equal(b.calls.some(c => ['update', 'remove'].includes(c[0])), false);
  assert.equal(b.tabs.size, 1);
});

test('session loss must not erase a known reader move to another window', async () => {
  const token = '00000000-0000-4000-8000-000000000084';
  const b = browser({ tab: { id: 7, windowId: 2, active: true, url: PAGE + '#radar-x-reader=' + token } });
  b.local[KEY + 'GuardV1'] = { version: 2, blocked: true, lease: lease({ token, claimed: true }) };
  assert.equal(await b.load().cleanup({ recover: true }), false);
  assert.equal(b.calls.some(c => c[0] === 'remove'), false);
  assert.equal(b.session[KEY].protected, true);
  assert.equal(b.local[KEY + 'GuardV1'].lease.protected, true);
});

test('session-loss recovery checks redirected readers before proving absence', async () => {
  const token = '00000000-0000-4000-8000-000000000079';
  for (const url of ['https://x.com/i/flow/login', 'https://x.com/home', 'https://x.com/i/timeline']) {
    const b = browser(), core = b.load();
    b.local[core.GUARD_KEY] = { blocked: true, lease: lease({ token }) };
    b.tabs.set(7, { id: 7, windowId: 1, active: false, url });
    await assert.rejects(read(core), /X_TAB_BLOCKED/);
    assert.equal(b.calls.some(call => call[0] === 'create'), false);
    b.tabs.get(7).url += '#radar-x-reader=' + token;
    assert.equal(await core.cleanup({ recover: true }), true);
    assert.equal(b.tabs.has(7), false);
  }
});

test('recovery refuses an open protected tab and only resumes after it has closed', async () => {
  const b = browser({ stored: lease({ claimed: true }), tab: { id: 7, url: PAGE } }), core = b.load();
  assert.equal(await core.cleanup({ recover: true }), false);
  assert.equal(await core.resume(), false);
  await assert.rejects(read(core), /X_TAB_BLOCKED/);
  b.tabs.delete(7);
  assert.equal(await core.resume(), true);
  await read(core);
  assert.equal(b.tabs.size, 0);
  assert.equal(b.local[core.GUARD_KEY], undefined);
});

test('lost-session recovery is restricted to explicit confirmation on the options page', async () => {
  const w = makeWorker({ stored: { directXScanTabV1GuardV1: { blocked: true, reason: 'session-lost' } } });
  for (const [message, sender] of [
    [{ type: 'RESUME_CHECK_TABS', confirmed: true }, w.sender('popup')],
    [{ type: 'RESUME_CHECK_TABS' }, w.sender('options')],
    [{ type: 'RESUME_CHECK_TABS', confirmed: false }, w.sender('options')],
    [{ type: 'RESUME_CHECK_TABS', confirmed: true, url: PAGE }, w.sender('options')],
    [{ type: 'RESUME_CHECK_TABS', confirmed: true }, { id: w.runtime.id, url: PAGE }]
  ]) {
    assert.equal((await w.send(message, sender)).ok, false);
    assert.ok(w.local.directXScanTabV1GuardV1);
  }
  assert.equal((await w.send({ type: 'RESUME_CHECK_TABS', confirmed: true }, w.sender('options'))).ok, true);
  assert.equal(w.local.directXScanTabV1GuardV1, undefined);
  assert.equal(w.tabs.length, 0);
});

test('durable-fence storage failure prevents any Chrome tab creation', async () => {
  const b = browser({ failLocalSet: true });
  const core = b.load();
  await assert.rejects(read(core), /Durable storage failed/);
  assert.equal(b.calls.filter(c => c[0] === 'create').length, 0);
  b.faults.failLocalSet = false;
  await read(core);
  assert.equal(b.tabs.size, 0);
});

test('clearing local history cannot erase a fence after session ownership is lost', async () => {
  const w = makeWorker({ stored: { directXScanTabV1GuardV1: { blocked: true, reason: 'session-lost' }, signalSnapshot: { saved: true } } });
  assert.equal((await w.send({ type: 'CLEAR_LOCAL_DATA' }, w.sender('options'))).ok, false);
  assert.equal(w.local.directXScanTabV1GuardV1.blocked, true);
  assert.equal(w.local.signalSnapshot.saved, true);
  assert.equal(w.tabs.length, 0);
});
