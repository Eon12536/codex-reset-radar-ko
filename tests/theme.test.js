const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Settings = require('../src/core/settings.js');
const { makeWorker, RAW_USAGE, json } = require('./helpers/worker.js');
const source = fs.readFileSync(path.join(__dirname, '../src/core/theme.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function page({ theme = 'system', appearanceTheme, dark = false, read, write } = {}) {
  const attributes = {};
  const data = { settings: { theme, monitorAccount: false }, appearanceTheme };
  const writes = [];
  const media = { matches: dark, addEventListener(_name, listener) { media.changed = listener; } };
  let storageChanged;
  const context = vm.createContext({
    document: { documentElement: { setAttribute(name, value) { attributes[name] = value; } } },
    matchMedia: () => media,
    chrome: { runtime: { sendMessage() { throw new Error('Background unavailable'); } }, storage: {
      local: {
        get: read || (async () => structuredClone(data)),
        set: async value => {
          if (write) await write(value);
          const changes = Object.fromEntries(Object.entries(value).map(([key,newValue]) => [key,{oldValue:data[key],newValue}]));
          writes.push(structuredClone(value));
          Object.assign(data,structuredClone(value));
          storageChanged(changes,'local');
        }
      },
      onChanged: { addListener(listener) { storageChanged = listener; } }
    } }
  });
  vm.runInContext(source, context);
  return { attributes, context, data, writes, os(dark) { media.matches = dark; media.changed(); },
    appearance(theme) { data.appearanceTheme = theme; storageChanged({appearanceTheme:{newValue:theme}},'local'); },
    storage(theme, area = 'local') { storageChanged({ settings: { newValue: { theme } } }, area); } };
}

test('theme preferences accept only the three supported modes and migrate existing settings safely', () => {
  for (const theme of ['light', 'dark', 'system']) assert.equal(Settings.sanitize({ theme }).theme, theme);
  for (const theme of ['', 'auto', 'url(evil)', null, {}, 1]) assert.equal(Settings.sanitize({ theme }).theme, 'system');
  const migrated = Settings.sanitize({ monitorAccount: true, notifyHints: true });
  assert.equal(migrated.theme, 'system');
  assert.equal(migrated.monitorAccount, true);
  assert.equal(migrated.notifyHints, true);
});

test('stored explicit themes override the OS and persist across opening another page', async () => {
  for (const theme of ['light', 'dark']) {
    const first = page({ theme, dark: theme === 'light' });
    await settle();
    assert.equal(first.attributes['data-theme'], theme);
    first.os(false); first.os(true);
    assert.equal(first.attributes['data-theme'], theme);
    const reopened = page({ theme, dark: theme === 'light' });
    await settle();
    assert.equal(reopened.attributes['data-theme'], theme);
  }
});

test('system mode follows OS changes and local storage updates synchronize an open page', async () => {
  const p = page({ dark: false });
  await settle();
  assert.equal(p.attributes['data-theme'], 'light');
  p.os(true);
  assert.equal(p.attributes['data-theme'], 'dark');
  p.storage('light', 'session');
  assert.equal(p.attributes['data-theme'], 'dark');
  p.storage('light');
  assert.equal(p.attributes['data-theme'], 'light');
  p.storage('system');
  assert.equal(p.attributes['data-theme'], 'dark');
  p.os(false);
  assert.equal(p.attributes['data-theme'], 'light');
});

test('a delayed initial read cannot overwrite a newer theme choice', async () => {
  let finishRead;
  const read = () => new Promise(resolve => { finishRead = resolve; });
  const p = page({ read });
  p.storage('dark');
  finishRead({ settings: { theme: 'light' } });
  await settle();
  assert.equal(p.attributes['data-theme'], 'dark');
});

test('storage failure keeps a usable system theme and does not reject page initialization', async () => {
  const p = page({ dark: true, read: async () => { throw new Error('Unavailable'); } });
  await settle();
  assert.equal(p.attributes['data-theme'], 'dark');
  p.os(false);
  assert.equal(p.attributes['data-theme'], 'light');
});

test('an OS change during loading cannot discard an explicitly saved theme', async () => {
  let finishRead;
  const p = page({ read: () => new Promise(resolve => { finishRead = resolve; }) });
  p.os(true);
  finishRead({ settings: { theme: 'light' } });
  await settle();
  assert.equal(p.attributes['data-theme'], 'light');
  p.os(false); p.os(true);
  assert.equal(p.attributes['data-theme'], 'light');
});

test('authorized settings save and local-data clearing preserve the theme and account consent', async () => {
  const w = makeWorker();
  await w.context.ensureSecurity();
  const result = await w.send({ type: 'SAVE_SETTINGS', settings: { ...w.local.settings, theme: 'dark' } }, w.sender('options'));
  assert.equal(result.ok, true);
  assert.equal(w.local.settings.theme, 'dark');
  assert.equal(w.local.settings.monitorAccount, true);
  await w.context.clearLocalData();
  assert.equal(w.local.settings.theme, 'dark');
  assert.equal(w.local.settings.monitorAccount, true);
  assert.equal(w.requests.length, 0);
});

test('popup saves only appearance without changing consent, alarms or cached usage', async () => {
  const w = makeWorker({ stored: {settings: {monitorAccount: true, notifyHints: true, pollMinutes: 120}} });
  await w.context.ensureSecurity();
  const before = structuredClone(w.local.settings);
  w.local.accountSnapshot = {fetchedAt: 123, usage: { windows: [] }};
  let alarmWrites = 0;
  w.context.chrome.alarms.clear = async () => { alarmWrites++; };
  w.context.chrome.alarms.create = async () => { alarmWrites++; };
  for (const theme of ['light', 'dark', 'system']) {
    const result = await w.send({type: 'SAVE_THEME', theme}, w.sender('popup'));
    assert.equal(result.ok, true);
    assert.deepEqual(w.local.settings, {...before, theme});
    assert.equal(w.local.accountSnapshot.fetchedAt, 123);
  }
  assert.equal(alarmWrites, 0);
  assert.equal(w.requests.length, 0);
});

test('popup theme messages reject other pages, fields and unsupported values', async () => {
  const w = makeWorker();
  await w.context.ensureSecurity();
  const before = structuredClone(w.local.settings);
  for (const theme of ['auto', '', null, {}, 1, undefined]) {
    assert.equal((await w.send({type: 'SAVE_THEME', theme}, w.sender('popup'))).ok, false);
  }
  for (const sender of [w.sender('options'), w.sender('welcome'), {...w.sender('popup'),id:'other'}, {...w.sender('popup'),frameId:1}]) {
    assert.equal((await w.send({type: 'SAVE_THEME', theme:'dark'}, sender)).ok, false);
  }
  assert.equal((await w.send({type:'SAVE_THEME',theme:'dark',settings:{monitorAccount:true}},w.sender('popup'))).ok,false);
  assert.equal((await w.send({type:'SAVE_SETTINGS',settings:{theme:'dark'}},w.sender('popup'))).ok,false);
  assert.deepEqual(w.local.settings,before);
});

test('theme patch reads the latest queued settings and leaves an in-flight account request running', async () => {
  let releaseFetch, startFetch;
  const started = new Promise(resolve => { startFetch = resolve; });
  const w = makeWorker({fetcher: async (url, options) => {
    if (url.endsWith('/auth/session')) {
      startFetch(options.signal);
      await new Promise(resolve => { releaseFetch = resolve; });
      return new Response(JSON.stringify({accessToken:'THEME_TEST_ONLY_FAKE_TOKEN'}),{headers:{'content-type':'application/json'}});
    }
    return json(url.endsWith('/usage') ? RAW_USAGE : {});
  }});
  await w.context.ensureSecurity();
  await Promise.all([
    w.send({type:'SAVE_SETTINGS',settings:{...w.local.settings,pollMinutes:120,notifyHints:true}},w.sender('options')),
    w.send({type:'SAVE_THEME',theme:'dark'},w.sender('popup'))
  ]);
  assert.equal(w.local.settings.pollMinutes,120);
  assert.equal(w.local.settings.notifyHints,true);
  assert.equal(w.local.settings.theme,'dark');
  const accountJob = w.context.refreshAccount();
  const signal = await started;
  await w.send({type:'SAVE_THEME',theme:'light'},w.sender('popup'));
  assert.equal(signal.aborted,false);
  releaseFetch();
  assert.equal((await accountJob).ok,true);
});

test('UI saves and reopens appearance with an unavailable background worker and no settings overwrite', async () => {
  const p = page({theme:'dark'});
  await p.context.RadarTheme.ready;
  for (const theme of ['light','dark','system']) {
    assert.equal(await p.context.RadarTheme.save(theme),theme);
    assert.equal(p.context.RadarTheme.current(),theme);
    assert.equal(p.data.appearanceTheme,theme);
  }
  assert.deepEqual(p.writes,[{appearanceTheme:'light'},{appearanceTheme:'dark'},{appearanceTheme:'system'}]);
  assert.deepEqual(p.data.settings,{theme:'dark',monitorAccount:false});
  const reopened = page({theme:'dark',appearanceTheme:p.data.appearanceTheme,dark:false});
  await reopened.context.RadarTheme.ready;
  assert.equal(reopened.context.RadarTheme.current(),'system');
  assert.equal(reopened.attributes['data-theme'],'light');
});

test('appearance key takes precedence over legacy worker writes and synchronizes controls', async () => {
  const p = page({appearanceTheme:'light',theme:'dark'});
  await p.context.RadarTheme.ready;
  const seen=[];
  const stop = p.context.RadarTheme.subscribe(value=>seen.push(value));
  p.storage('system');
  assert.equal(p.attributes['data-theme'],'light');
  p.appearance('dark');
  assert.equal(p.attributes['data-theme'],'dark');
  assert.equal(seen.at(-1),'dark');
  stop();
  p.appearance('light');
  assert.equal(seen.at(-1),'dark');
});

test('a settings event during initial loading cannot discard the separately saved theme', async () => {
  let finishRead;
  const p = page({read:()=>new Promise(resolve=>{finishRead=resolve;})});
  p.storage('system');
  finishRead({appearanceTheme:'light',settings:{theme:'dark'}});
  await p.context.RadarTheme.ready;
  assert.equal(p.context.RadarTheme.current(),'light');
  p.storage('dark');
  assert.equal(p.attributes['data-theme'],'light');
});

test('storage failures reject the write and leave the persisted choice available for recovery', async () => {
  const p = page({appearanceTheme:'dark',write:async()=>{throw new Error('storage full');}});
  await p.context.RadarTheme.ready;
  p.context.RadarTheme.apply('light');
  await assert.rejects(p.context.RadarTheme.save('light'),/storage full/);
  p.context.RadarTheme.apply(await p.context.RadarTheme.read());
  assert.equal(p.attributes['data-theme'],'dark');
  assert.equal(p.data.appearanceTheme,'dark');
  assert.equal(p.writes.length,0);
});

test('direct theme persistence rejects unsupported values before writing', async () => {
  const p = page();
  await p.context.RadarTheme.ready;
  for (const invalid of ['auto','',null,{},1]) await assert.rejects(p.context.RadarTheme.save(invalid),/Unsupported theme/);
  assert.equal(p.writes.length,0);
});

test('clearing local data preserves the independent theme alongside existing settings', async () => {
  const w = makeWorker({stored:{appearanceTheme:'light',accountError:'old',extraCache:'delete'}});
  await w.context.clearLocalData();
  assert.equal(w.local.appearanceTheme,'light');
  assert.equal(w.local.settings.monitorAccount,true);
  assert.equal(w.local.accountError,undefined);
  assert.equal(w.local.extraCache,undefined);
});
