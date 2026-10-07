const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Settings = require('../src/core/settings');
const { makeWorker, json } = require('./helpers/worker');

test('new and legacy settings always include direct X without enabling other monitoring', () => {
  assert.equal(Settings.DEFAULTS.monitorDirectX, true);
  for (const input of [undefined, {}, { monitorDirectX: false }, { monitorDirectX: 'false' }]) {
    assert.equal(Settings.sanitize(input).monitorDirectX, true);
  }
  const settings = Settings.sanitize({ monitorDirectX: false, monitorSignals: false, monitorLeadSource: false });
  assert.equal(settings.monitorSignals, false);
  assert.equal(settings.monitorLeadSource, false);
  assert.equal(settings.monitorAccount, false);
  assert.equal(settings.monitorChat, false);
});

test('legacy OFF is persisted as ON and startup and wake both run fresh direct checks', async () => {
  const w = makeWorker({ stored: { settings: { monitorDirectX: false, monitorAccount: false,
    monitorStatusSource: false, monitorHistorySource: false, monitorCommunitySource: false } },
    fetcher: async () => json({ items: [] }) });
  let reads = 0;
  w.context.RadarDirectX = { ...w.context.RadarDirectX, read: async () => { reads++; return { items: [] }; } };
  await w.events.startup();
  assert.equal(w.local.settings.monitorDirectX, true);
  assert.ok(reads > 0);
  const beforeWake = reads;
  w.local.wakeCheckedAt = Date.now() - 10 * 60 * 1000;
  await w.events.alarm({ name: 'codex-reset-radar-wake-check' });
  assert.ok(reads > beforeWake);
  await w.context.saveSettings({ ...w.local.settings, monitorDirectX: false });
  assert.equal(w.local.settings.monitorDirectX, true);
});

test('always-on startup without an X grant does not open tabs or request permissions', async () => {
  const w = makeWorker({ stored: { settings: { monitorDirectX: false, monitorAccount: false } },
    fetcher: async () => json({ items: [] }) });
  let prompts = 0;
  w.context.chrome.permissions.request = async () => { prompts++; return true; };
  await w.events.startup();
  assert.equal(prompts, 0);
  assert.equal(w.tabs.length, 0);
  assert.equal(w.local.signalSnapshot.leadStatus.directError, 'permission');
  assert.equal(w.local.signalSnapshot.leadStatus.directEnabled, true);
});

const optionsSource = fs.readFileSync(require.resolve('../src/options/options.js'), 'utf8');
const checkSource = optionsSource.slice(optionsSource.indexOf('async function checkPublicConnection()'),
  optionsSource.indexOf('control("checkPublic").addEventListener("click", checkPublicConnection)'));
function optionCheck({ granted = true, monitoring = true, draft = false, saved = true } = {}) {
  const calls = [];
  const controls = { checkPublic: { disabled: false }, publicConnectionState: { textContent: '' },
    monitorSignals: { checked: monitoring }, monitorLeadSource: { checked: true } };
  const context = vm.createContext({ control: id => controls[id], saveTimer: draft ? 42 : null,
    clearTimeout: () => calls.push('cancel-draft'), save: async () => { calls.push('save'); return saved; },
    renderPublicConnection: async () => calls.push('status'), chrome: {
      permissions: { request: async access => { calls.push({ access }); return granted; } },
      runtime: { sendMessage: async message => calls.push(message.type) } } });
  vm.runInContext(checkSource, context);
  return { calls, controls, run: () => context.checkPublicConnection() };
}

test('connecting X asks only for the existing optional access and scans after it is granted', async () => {
  const h = optionCheck({ draft: true });
  await h.run();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [
    { access: { permissions: ['scripting'], origins: ['https://x.com/*'] } },
    'cancel-draft', 'save', 'REFRESH_SIGNALS', 'status']);
  assert.equal(h.controls.checkPublic.disabled, false);
});

test('denied X access or failed draft save cannot trigger a direct refresh', async () => {
  for (const options of [{ granted: false }, { draft: true, saved: false }]) {
    const h = optionCheck(options);
    await h.run();
    assert.ok(!h.calls.includes('REFRESH_SIGNALS'));
    assert.equal(h.controls.checkPublic.disabled, false);
    if (!options.granted && !options.draft) assert.match(h.controls.publicConnectionState.textContent, /연결 대기/);
  }
});

test('public monitoring OFF neither requests X access nor scans', async () => {
  const h = optionCheck({ monitoring: false, draft: true });
  await h.run();
  assert.deepEqual(h.calls, ['cancel-draft', 'save', 'status']);
});

test('always-on control is checked and disabled and revoked access overrides cached success', async () => {
  const html = fs.readFileSync(require.resolve('../src/options/options.html'), 'utf8');
  assert.match(html, /id="monitorDirectX"[^>]*checked disabled/);
  assert.doesNotMatch(optionsSource, /changeDirectX\(/);
  const render = optionsSource.slice(optionsSource.indexOf('async function renderPublicConnection()'),
    optionsSource.indexOf('chrome.storage.onChanged.addListener', optionsSource.indexOf('async function renderPublicConnection()')));
  const controls = { checkTabRecovery: {}, checkPublic: {}, publicConnectionState: {} };
  const context = vm.createContext({ RadarSettings: Settings, control: id => controls[id], chrome: {
    storage: { local: { get: async () => ({ settings: { monitorDirectX: false },
      signalSnapshot: { leadStatus: { directOk: true } } }) } },
    permissions: { contains: async () => false } } });
  vm.runInContext(render, context);
  await context.renderPublicConnection();
  assert.equal(controls.checkPublic.textContent, 'X 접근 허용·확인');
  assert.match(controls.publicConnectionState.textContent, /처음 한 번 권한/);
  assert.doesNotMatch(controls.publicConnectionState.textContent, /최근 확인/);
});
